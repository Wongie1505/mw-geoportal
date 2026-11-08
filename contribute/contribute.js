import { renderNav } from '../shared/js/nav.js';
import { supabase } from '../shared/js/supabase.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { createElement, showMessage } from '../shared/js/ui.js';
import { readGeoData, boundsToWkt, formatSize, FileProblem } from './geodata.js';
import { showMapPreview, showAttributePreview } from './preview.js';
import { createProgress } from './progress.js';

const form = document.getElementById('contribute-form');
const message = document.getElementById('message');
const resultActions = document.getElementById('result-actions');
const loginNotice = document.getElementById('login-notice');
const departmentSelect = form.elements.department;
const departmentHint = document.getElementById('department-hint');
const fileInput = form.elements.file;
const fileFeedback = document.getElementById('file-feedback');
const previewSection = document.getElementById('preview-section');
const summary = document.getElementById('summary');
const previewMap = document.getElementById('preview-map');
const previewNote = document.getElementById('preview-note');
const attributePreview = document.getElementById('attribute-preview');
const submitButton = form.querySelector('button[type="submit"]');
const progress = createProgress(document.getElementById('progress'));

let user = null;

// The checked file, ready to upload. Empty until a file passes the checks.
let prepared = null;

// Lets a slow check for an old file be ignored once another file is chosen
let readCount = 0;

renderNav();
start();

departmentSelect.addEventListener('change', updateDepartmentHint);
fileInput.addEventListener('change', handleFileChange);
form.addEventListener('submit', handleSubmit);

async function start() {
    user = await getCurrentUser();

    if (!user) {
        form.hidden = true;
        loginNotice.hidden = false;
        return;
    }

    const { data: departments, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

    if (error) {
        console.error(error);
        showMessage(message, 'The departments could not be loaded. Please refresh the page.');
        return;
    }

    departments.forEach(department => {
        const option = createElement('option', '', department.name);
        option.value = department.id;
        // Staff usually upload to their own department
        option.selected = department.name === user.department;
        departmentSelect.append(option);
    });

    updateDepartmentHint();
}

function selectedDepartmentName() {
    return departmentSelect.selectedOptions[0]?.textContent ?? '';
}

// Tells the person what will happen to their upload before they send it
function updateDepartmentHint() {
    const name = selectedDepartmentName();

    if (!departmentSelect.value) {
        departmentHint.textContent = '';
        return;
    }

    const isStaff = ['member', 'manager'].includes(user.role) && user.department === name;
    departmentHint.textContent = isStaff
        ? 'Your upload will be published straight away.'
        : `Your upload will be sent to the ${name} department for review.`;
}

function createMessage(text, type) {
    return createElement('div', `message message-${type}`, text);
}

// Checks the chosen file as soon as it is picked and shows what it holds
async function handleFileChange() {
    const thisRead = ++readCount;

    prepared = null;
    submitButton.disabled = true;
    previewSection.hidden = true;
    fileFeedback.replaceChildren();

    const file = fileInput.files[0];
    if (!file) return;

    fileFeedback.append(createElement('p', 'field-hint', 'Reading and checking the file...'));

    try {
        const result = await readGeoData(file);
        if (thisRead !== readCount) return;

        prepared = result;
        fileFeedback.replaceChildren(...result.warnings.map(text => createMessage(text, 'warning')));
        showSummary(result);
        submitButton.disabled = false;
    } catch (error) {
        if (thisRead !== readCount) return;

        console.error(error);
        const text = error instanceof FileProblem ? error.message : 'That file could not be read.';
        fileFeedback.replaceChildren(createMessage(text, 'error'));
    }
}

function addSummaryRow(label, value) {
    summary.append(createElement('dt', '', label), createElement('dd', '', value));
}

function describeTypes(types) {
    return Object.entries(types)
        .map(([type, count]) => `${type} (${count.toLocaleString('en-GB')})`)
        .join(', ');
}

function describeBounds([minX, minY, maxX, maxY]) {
    return `Longitude ${minX.toFixed(2)} to ${maxX.toFixed(2)}, latitude ${minY.toFixed(2)} to ${maxY.toFixed(2)}`;
}

function showSummary(result) {
    summary.replaceChildren();
    addSummaryRow('Features', result.featureCount.toLocaleString('en-GB'));
    addSummaryRow('Geometry', describeTypes(result.geometryTypes));
    addSummaryRow('Area covered', describeBounds(result.bounds));
    addSummaryRow('Attributes', `${result.attributes.length} columns`);
    addSummaryRow('Size after processing', formatSize(result.blob.size));

    // Show the section first so the map can measure its container
    previewSection.hidden = false;

    const { shown, total } = showMapPreview(previewMap, result.collection);
    previewNote.textContent = shown < total
        ? `The map shows a sample of ${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} features.`
        : '';

    showAttributePreview(attributePreview, result.collection, result.attributes);
}

async function handleSubmit(event) {
    event.preventDefault();
    if (!prepared) return;

    showMessage(message, '');
    submitButton.disabled = true;
    progress.set(0, 'Starting.');
    progress.show();

    try {
        const result = await uploadDataset(prepared);
        progress.hide();
        showResult(result);
    } catch (error) {
        console.error(error);
        progress.hide();
        showMessage(message, error.message);
        submitButton.disabled = false;
    }
}

// Creates the draft row, uploads the file, then submits. If any step after
// the draft fails, the draft and any uploaded file are removed again.
// The bar moves in steps. The file transfer is one request, so the bar waits
// at its step, with a moving stripe, until the transfer finishes.
async function uploadDataset(geo) {
    const fields = form.elements;

    progress.set(10, 'Saving details.');
    const { data: dataset, error: insertError } = await supabase
        .from('datasets')
        .insert({
            title: fields.title.value.trim(),
            abstract: fields.abstract.value.trim(),
            department_id: fields.department.value,
            license: fields.license.value.trim(),
            access_level: fields.access.value,
            keywords: fields.keywords.value.split(',').map(word => word.trim()).filter(Boolean),
            kind: 'vector',
            epsg: 4326,
            file_format: 'geojson',
            extent: boundsToWkt(geo.bounds)
        })
        .select('id')
        .single();

    if (insertError) throw new Error(`Could not save the dataset: ${insertError.message}`);

    const path = `${dataset.id}/data.geojson`;

    try {
        progress.set(30, `Uploading file (${formatSize(geo.blob.size)}). This can take a while on a slow connection.`);
        progress.working(true);
        const { error: uploadError } = await supabase.storage
            .from('datasets')
            .upload(path, geo.blob, { contentType: 'application/geo+json' });
        progress.working(false);
        if (uploadError) throw uploadError;

        progress.set(90, 'Saving file details.');
        const { error: updateError } = await supabase
            .from('datasets')
            .update({ file_path: path, file_size_bytes: geo.blob.size })
            .eq('id', dataset.id);
        if (updateError) throw updateError;

        progress.set(95, 'Submitting.');
        const { data: status, error: submitError } = await supabase
            .rpc('submit_dataset', { p_id: dataset.id });
        if (submitError) throw submitError;

        progress.set(100, 'Done.');
        return { id: dataset.id, status, department: selectedDepartmentName() };
    } catch (error) {
        progress.working(false);
        await discard(dataset.id, path);
        throw new Error(`Could not upload the dataset: ${error.message}`);
    }
}

// Best effort clean-up after a failed upload
async function discard(id, path) {
    await supabase.storage.from('datasets').remove([path]);
    await supabase.from('datasets').delete().eq('id', id);
}

function showResult({ id, status, department }) {
    form.hidden = true;

    const links = [];

    if (status === 'published') {
        showMessage(message, 'Your dataset is published.', 'success');
        links.push(createButtonLink('View dataset', `../dataset/dataset.html?id=${encodeURIComponent(id)}`));
    } else {
        showMessage(message, `Your dataset was sent to the ${department} department for review.`, 'success');
    }

    links.push(createButtonLink('Contribute another', 'contribute.html', true));
    resultActions.replaceChildren(...links);
}

function createButtonLink(text, href, outline = false) {
    const link = createElement('a', outline ? 'button button-outline' : 'button', text);
    link.href = href;
    return link;
}