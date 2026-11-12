import { renderNav } from '../shared/js/nav.js';
import { supabase } from '../shared/js/supabase.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { createElement, showMessage } from '../shared/js/ui.js';
import { readGeoData, boundsToWkt, formatSize, FileProblem } from './geodata.js';
import { readRaster } from './raster.js';
import { buildPreview, previewToBlob, buildRasterInfo } from './raster-preview.js';
import { createRasterPanel } from './raster-legend.js';
import { showMapPreview, showAttributePreview } from './preview.js';
import { createProgress } from './progress.js';

const form = document.getElementById('contribute-form');
const message = document.getElementById('message');
const resultActions = document.getElementById('result-actions');
const loginNotice = document.getElementById('login-notice');
const departmentSelect = form.elements.department;
const departmentHint = document.getElementById('department-hint');
const dataTypeSelect = form.elements.dataType;
const fileInput = form.elements.file;
const fileHint = document.getElementById('file-hint');
const fileFeedback = document.getElementById('file-feedback');
const previewSection = document.getElementById('preview-section');
const summary = document.getElementById('summary');
const vectorPreview = document.getElementById('vector-preview');
const rasterPanel = createRasterPanel(document.getElementById('raster-preview'), updateSubmitState);
const previewMap = document.getElementById('preview-map');
const previewNote = document.getElementById('preview-note');
const attributePreview = document.getElementById('attribute-preview');
const submitButton = form.querySelector('button[type="submit"]');
const progress = createProgress(document.getElementById('progress'));

let user = null;

// What each choice of data type accepts
const DATA_TYPES = {
    geojson: {
        label: 'GeoJSON',
        accept: '.geojson,.json',
        pattern: /\.(geo)?json$/i,
        hint: 'GeoJSON in WGS 84 (EPSG:4326). Up to 50 MB.'
    },
    shapefile: {
        label: 'zipped Shapefile',
        accept: '.zip',
        pattern: /\.zip$/i,
        hint: 'A zip holding the shapefile with its .shp, .dbf and .prj files. Up to 50 MB.'
    },
    raster: {
        label: 'GeoTIFF',
        accept: '.tif,.tiff',
        pattern: /\.tiff?$/i,
        hint: 'A single band GeoTIFF in WGS 84 (EPSG:4326). Up to 50 MB.'
    }
};

// The checked file, ready to upload. Empty until a file passes the checks.
// It holds the kind of data, the file to send, and for a raster its preview.
let prepared = null;

// Lets a slow check for an old file be ignored once another file is chosen
let readCount = 0;

renderNav();
start();

departmentSelect.addEventListener('change', updateDepartmentHint);
dataTypeSelect.addEventListener('change', handleDataTypeChange);
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
function handleDataTypeChange() {
    const type = DATA_TYPES[dataTypeSelect.value];

    fileInput.accept = type.accept;
    fileInput.disabled = false;
    fileHint.textContent = type.hint;

    // A file picked for another data type no longer counts
    fileInput.value = '';
    handleFileChange();
}

// The submit button waits for a checked file and, for a class raster, a name for every class
function updateSubmitState() {
    const waitingForNames = prepared?.kind === 'raster' && !rasterPanel.isComplete();
    submitButton.disabled = !prepared || waitingForNames;
}

async function handleFileChange() {
    const thisRead = ++readCount;

    prepared = null;
    updateSubmitState();
    previewSection.hidden = true;
    rasterPanel.hide();
    fileFeedback.replaceChildren();

    const file = fileInput.files[0];
    if (!file) return;

    const type = DATA_TYPES[dataTypeSelect.value];
    if (!type.pattern.test(file.name)) {
        fileFeedback.replaceChildren(createMessage(`You chose ${type.label} as the data type, but this file does not look like one. Pick a ${type.accept.replace(/,/g, ' or ')} file, or change the data type.`, 'error'));
        return;
    }

    fileFeedback.append(createElement('p', 'field-hint', 'Reading and checking the file...'));

    try {
        if (dataTypeSelect.value === 'raster') {
            await prepareRaster(file, thisRead);
        } else {
            await prepareVector(file, thisRead);
        }
    } catch (error) {
        if (thisRead !== readCount) return;

        console.error(error);
        const text = error instanceof FileProblem ? error.message : 'That file could not be read.';
        fileFeedback.replaceChildren(createMessage(text, 'error'));
    }
}

async function prepareVector(file, thisRead) {
    const result = await readGeoData(file);
    if (thisRead !== readCount) return;

    // Both GeoJSON and shapefiles are saved as GeoJSON
    prepared = {
        kind: 'vector',
        fileFormat: 'geojson',
        fileName: 'data.geojson',
        contentType: 'application/geo+json',
        blob: result.blob,
        bounds: result.bounds
    };
    fileFeedback.replaceChildren(...result.warnings.map(text => createMessage(text, 'warning')));
    showSummary(result);
    updateSubmitState();
}

async function prepareRaster(file, thisRead) {
    const raster = await readRaster(file);
    if (thisRead !== readCount) return;

    fileFeedback.replaceChildren(...raster.warnings.map(text => createMessage(text, 'warning')));
    showRasterSummary(raster);

    // The picture takes a second pass over the cells, so it comes after the summary
    const preview = await buildPreview(raster);
    const previewBlob = await previewToBlob(preview);
    if (thisRead !== readCount) return;

    // The original file is uploaded as it is, next to the small preview picture
    prepared = {
        kind: 'raster',
        fileFormat: 'tif',
        fileName: 'data.tif',
        contentType: 'image/tiff',
        blob: file,
        bounds: raster.bounds,
        raster,
        preview,
        previewBlob
    };
    rasterPanel.show(raster, preview, previewBlob);
    updateSubmitState();
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
    vectorPreview.hidden = false;
    previewSection.hidden = false;

    const { shown, total } = showMapPreview(previewMap, result.collection);
    previewNote.textContent = shown < total
        ? `The map shows a sample of ${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} features.`
        : '';

    showAttributePreview(attributePreview, result.collection, result.attributes);
}

function describeValues(raster) {
    if (raster.valueType === 'classes') {
        const values = raster.classes.map(entry => entry.value).join(', ');
        return `${raster.classes.length} classes (${values})`;
    }

    const format = number => number.toLocaleString('en-GB', { maximumFractionDigits: 2 });
    return `Continuous, from ${format(raster.min)} to ${format(raster.max)}`;
}

function showRasterSummary(raster) {
    summary.replaceChildren();
    addSummaryRow('Size', `${raster.width.toLocaleString('en-GB')} by ${raster.height.toLocaleString('en-GB')} cells`);
    addSummaryRow('Cell size', `About ${raster.cellMetres.toLocaleString('en-GB')} m`);
    addSummaryRow('Area covered', describeBounds(raster.bounds));
    addSummaryRow('Values', describeValues(raster));
    addSummaryRow('Number type', raster.dataType);
    addSummaryRow('Empty cells', raster.noData === null ? 'No empty value is set' : `Value ${raster.noData}`);

    // A raster has no attribute table or vector map to show
    vectorPreview.hidden = true;
    previewSection.hidden = false;
}

async function handleSubmit(event) {
    event.preventDefault();
    if (!prepared) return;

    if (prepared.kind === 'raster' && !rasterPanel.isComplete()) {
        showMessage(message, 'Name every class before uploading.');
        return;
    }

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
async function uploadDataset(upload) {
    const fields = form.elements;
    const isRaster = upload.kind === 'raster';

    const row = {
        title: fields.title.value.trim(),
        abstract: fields.abstract.value.trim(),
        department_id: fields.department.value,
        license: fields.license.value.trim(),
        access_level: fields.access.value,
        keywords: fields.keywords.value.split(',').map(word => word.trim()).filter(Boolean),
        kind: upload.kind,
        epsg: 4326,
        file_format: upload.fileFormat,
        extent: boundsToWkt(upload.bounds)
    };
    if (isRaster) row.raster_info = buildRasterInfo(upload.raster, upload.preview, rasterPanel.labels());

    progress.set(10, 'Saving details.');
    const { data: dataset, error: insertError } = await supabase
        .from('datasets')
        .insert(row)
        .select('id')
        .single();

    if (insertError) throw new Error(`Could not save the dataset: ${insertError.message}`);

    const paths = [`${dataset.id}/${upload.fileName}`];

    try {
        progress.set(30, `Uploading file (${formatSize(upload.blob.size)}). This can take a while on a slow connection.`);
        await uploadFile(paths[0], upload.blob, upload.contentType);

        // The row needs the paths of the files that are now in storage
        const changes = { file_path: paths[0], file_size_bytes: upload.blob.size };

        if (isRaster) {
            progress.set(80, 'Uploading the preview picture.');
            paths.push(`${dataset.id}/preview.png`);
            await uploadFile(paths[1], upload.previewBlob, 'image/png');
            changes.preview_path = paths[1];
        }

        progress.set(90, 'Saving file details.');
        const { error: updateError } = await supabase
            .from('datasets')
            .update(changes)
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
        await discard(dataset.id, paths);
        throw new Error(`Could not upload the dataset: ${error.message}`);
    }
}

// One file transfer is a single request, so the bar waits with a moving stripe
async function uploadFile(path, blob, contentType) {
    progress.working(true);
    const { error } = await supabase.storage.from('datasets').upload(path, blob, { contentType });
    progress.working(false);

    if (error) throw error;
}

// Best effort clean-up after a failed upload. Storage only removes files the
// person may read, which needs a ticket, so one is requested first. Contributors
// cannot delete datasets, but they can discard their own unsent draft this way.
async function discard(id, paths) {
    await supabase.rpc('open_dataset_file', { p_dataset: id, p_purpose: 'view' });
    await supabase.storage.from('datasets').remove(paths);
    await supabase.rpc('discard_draft', { p_id: id });
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