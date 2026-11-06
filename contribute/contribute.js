import { renderNav } from '../shared/js/nav.js';
import { supabase } from '../shared/js/supabase.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { createElement, showMessage } from '../shared/js/ui.js';
import { readGeoData, boundsToWkt } from './geodata.js';

const form = document.getElementById('contribute-form');
const message = document.getElementById('message');
const resultActions = document.getElementById('result-actions');
const loginNotice = document.getElementById('login-notice');
const departmentSelect = form.elements.department;
const departmentHint = document.getElementById('department-hint');
const submitButton = form.querySelector('button[type="submit"]');

let user = null;

renderNav();
start();

departmentSelect.addEventListener('change', updateDepartmentHint);
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

async function handleSubmit(event) {
    event.preventDefault();
    showMessage(message, '');
    submitButton.disabled = true;

    try {
        const result = await uploadDataset();
        showResult(result);
    } catch (error) {
        console.error(error);
        showMessage(message, error.message);
        submitButton.disabled = false;
        submitButton.textContent = 'Upload dataset';
    }
}

// Creates the draft row, uploads the file, then submits. If any step after
// the draft fails, the draft and any uploaded file are removed again.
async function uploadDataset() {
    const fields = form.elements;

    submitButton.textContent = 'Reading file...';
    let geo;
    try {
        geo = await readGeoData(fields.file.files[0]);
    } catch (error) {
        console.error(error);
        throw new Error('That file could not be read. Upload a GeoJSON file or a zipped shapefile.');
    }

    submitButton.textContent = 'Saving details...';
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
        submitButton.textContent = 'Uploading file...';
        const { error: uploadError } = await supabase.storage
            .from('datasets')
            .upload(path, geo.blob, { contentType: 'application/geo+json' });
        if (uploadError) throw uploadError;

        const { error: updateError } = await supabase
            .from('datasets')
            .update({ file_path: path, file_size_bytes: geo.blob.size })
            .eq('id', dataset.id);
        if (updateError) throw updateError;

        submitButton.textContent = 'Submitting...';
        const { data: status, error: submitError } = await supabase
            .rpc('submit_dataset', { p_id: dataset.id });
        if (submitError) throw submitError;

        return { id: dataset.id, status, department: selectedDepartmentName() };
    } catch (error) {
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