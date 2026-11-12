import { renderNav } from '../shared/js/nav.js';
import { supabase } from '../shared/js/supabase.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { getFileUrl, getSignedUrl } from '../shared/js/storage.js';
import { showAccessPanel } from './access.js';
import { createShapefileZip } from './shapefile.js';
import { describeRaster, previewCellMetres, showLegend, drawRasterMap } from './raster.js';
import { canDelete, createDeleteButton } from '../shared/js/datasets.js';
import { accessBadge, createElement, showMessage } from '../shared/js/ui.js';

const message = document.getElementById('message');
const article = document.getElementById('dataset');
const mapElement = document.getElementById('map');
const mapStatus = document.getElementById('map-status');
const accessPanel = document.getElementById('access-panel');
const statusNotice = document.getElementById('status-notice');
const datasetActions = document.getElementById('dataset-actions');
const downloadBox = document.getElementById('download-box');
const downloadFormat = document.getElementById('download-format');
const downloadButton = document.getElementById('download-button');
const downloadHint = document.getElementById('download-hint');
const details = document.getElementById('details');
const featureInfo = document.getElementById('feature-info');
const featureSection = document.getElementById('feature-section');
const rasterSection = document.getElementById('raster-section');
const rasterControls = document.getElementById('raster-controls');
const opacityInput = document.getElementById('opacity');
const legend = document.getElementById('legend');

renderNav();
loadDataset();

async function loadDataset() {
    const id = new URLSearchParams(location.search).get('id');

    // Opened without choosing a dataset, for example by typing the address
    if (!id) {
        showMessage(message, 'No dataset selected. Choose one from the datasets page.');
        return;
    }

    const { data: dataset, error } = await supabase
        .from('datasets')
        .select(`id, title, abstract, access_level, kind, epsg, license, keywords,
                 file_path, file_format, file_size_bytes, contributor_name,
                 preview_path, raster_info,
                 status, review_note, published_at, contributed_by, department_id,
                 departments ( name )`)
        .eq('id', id)
        .maybeSingle();

    // A bad id, a missing dataset and a dataset this person may not see all
    // end up here, so the page never reveals which one it was.
    if (error || !dataset) {
        if (error) console.error(error);
        showNotFound();
        return;
    }

    showDetails(dataset);
    showMap(dataset);
}

function showNotFound() {
    showMessage(message, 'This dataset could not be found.');
}

function addDetail(label, value) {
    if (!value) return;
    details.append(createElement('dt', '', label), createElement('dd', '', value));
}

function formatSize(bytes) {
    if (!bytes) return '';
    return bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Explains why a dataset is not public yet. Only people the database lets
// see it (the contributor and the owning department's managers) get this far.
function showStatusNotice(dataset) {
    const department = dataset.departments?.name;
    const notices = {
        draft: 'This dataset is a draft and has not been submitted.',
        pending: `This dataset is waiting for review by the ${department} department.`,
        changes_requested: `The ${department} department asked for changes: ${dataset.review_note}`,
        rejected: `This dataset was rejected: ${dataset.review_note}`
    };

    const text = notices[dataset.status];
    if (!text) return;

    statusNotice.textContent = text;
    statusNotice.hidden = false;
}

// Offers Delete to the people the database will let delete this dataset
async function showActions(dataset) {
    const user = await getCurrentUser();
    if (!canDelete(user, dataset)) return;

    datasetActions.append(createDeleteButton(dataset, {
        onDeleted: () => { location.href = '../dashboard/dashboard.html'; },
        onError: text => showMessage(message, text)
    }));
}

function showDetails(dataset) {
    document.title = `${dataset.title} | Malawi Geoportal`;
    document.getElementById('title').textContent = dataset.title;
    document.getElementById('abstract').textContent = dataset.abstract;

    document.getElementById('badges').append(
        accessBadge(dataset.access_level),
        createElement('span', 'badge badge-neutral', dataset.kind === 'raster' ? 'Raster' : 'Vector')
    );

    addDetail('Department', dataset.departments?.name);
    addDetail('Contributed by', dataset.contributor_name);
    addDetail('License', dataset.license);
    addDetail('Format', dataset.file_format?.toUpperCase());
    addDetail('Coordinate system', `EPSG:${dataset.epsg}`);
    addDetail('File size', formatSize(dataset.file_size_bytes));

    if (dataset.kind === 'raster' && dataset.raster_info) {
        describeRaster(dataset.raster_info).forEach(([label, value]) => addDetail(label, value));
    }
    addDetail('Keywords', dataset.keywords.join(', '));
    addDetail('Published', dataset.published_at
        ? new Date(dataset.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : '');

    showStatusNotice(dataset);
    showActions(dataset);
    article.hidden = false;
}

async function showMap(dataset) {
    if (dataset.kind === 'raster') {
        await showRasterMap(dataset);
        return;
    }

    // The database decides whether this person may open the file, and records
    // it when the data is not open to everyone. If it says no, there is nothing to draw.
    const url = await getFileUrl(dataset, 'view');
    if (!url) {
        await showNoAccess(dataset);
        return;
    }

    showDownloadControls(dataset);
    drawVectorMap(url);
}

// The title with only letters, numbers and dashes, used to name downloaded files
function downloadBase(dataset) {
    const base = dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return base || 'dataset';
}

const FORMAT_HINTS = {
    geojson: '',
    shapefile: 'Column names are shortened to 10 characters. Points, lines and polygons are saved as separate files in the zip.'
};

// A raster is shown as a coarse preview picture. The picture of a published
// public or restricted dataset is open to everyone, which is what lets people
// decide whether to ask for the real data. For anything else the database has
// to give this person a ticket first, the same as for a vector file.
async function showRasterMap(dataset) {
    const info = dataset.raster_info;
    featureSection.hidden = true;

    const previewIsOpen = dataset.status === 'published'
        && ['public', 'restricted'].includes(dataset.access_level);

    let previewUrl = null;
    let hasAccess;

    if (previewIsOpen) {
        if (dataset.preview_path) previewUrl = await getSignedUrl(dataset.preview_path, 600);
        hasAccess = dataset.access_level === 'public' || Boolean(await getFileUrl(dataset, 'view'));
    } else {
        hasAccess = Boolean(await getFileUrl(dataset, 'view'));
        if (hasAccess && dataset.preview_path) previewUrl = await getSignedUrl(dataset.preview_path, 600);
    }

    if (previewUrl && info?.bounds) {
        rasterSection.hidden = false;
        rasterControls.hidden = false;
        showLegend(legend, info);

        mapStatus.textContent = `A coarse preview, about ${previewCellMetres(info).toLocaleString('en-GB')} m per cell.`
            + (hasAccess ? ' Download the file for the full resolution.' : '');

        drawRasterMap({ target: mapElement, url: previewUrl, info, opacityInput, status: mapStatus });
    } else {
        mapElement.hidden = true;
        mapStatus.textContent = 'No preview is available for this raster.';
    }

    if (hasAccess) {
        showDownloadControls(dataset);
    } else {
        await showRasterAccess(dataset);
    }
}

// Someone who may see the preview but not the data can ask for access
async function showRasterAccess(dataset) {
    if (dataset.access_level !== 'restricted') return;

    const user = await getCurrentUser();

    if (user) {
        await showAccessPanel(accessPanel, dataset, user);
    } else {
        mapStatus.textContent += ' Log in to request the full data.';
    }
}

// Shows the format picker and Download button once the file is known to be open to this person
function showDownloadControls(dataset) {
    downloadBox.hidden = false;

    // A raster is only offered as the file that was uploaded
    if (dataset.kind === 'raster') {
        const option = createElement('option', '', 'GeoTIFF');
        option.value = 'tif';

        downloadFormat.replaceChildren(option);
        downloadFormat.disabled = true;
        downloadHint.textContent = 'The original file, at full resolution and exactly as it was uploaded.';
    }

    downloadFormat.addEventListener('change', () => {
        downloadHint.textContent = FORMAT_HINTS[downloadFormat.value];
    });

    downloadButton.addEventListener('click', async () => {
        showMessage(message, '');
        downloadButton.disabled = true;
        downloadButton.textContent = 'Preparing...';

        try {
            if (dataset.kind === 'raster') {
                await downloadGeoTiff(dataset);
            } else if (downloadFormat.value === 'shapefile') {
                await downloadShapefile(dataset);
            } else {
                await downloadGeoJson(dataset);
            }
        } catch (error) {
            console.error(error);
            showMessage(message, error.message);
        }

        downloadButton.disabled = false;
        downloadButton.textContent = 'Download';
    });
}

async function downloadGeoTiff(dataset) {
    const url = await getFileUrl(dataset, 'download', `${downloadBase(dataset)}.tif`);
    if (!url) throw new Error('The file could not be prepared for download. Please try again.');

    location.assign(url);
}

async function downloadGeoJson(dataset) {
    const url = await getFileUrl(dataset, 'download', `${downloadBase(dataset)}.geojson`);
    if (!url) throw new Error('The file could not be prepared for download. Please try again.');

    location.assign(url);
}

// The stored file is GeoJSON, so a shapefile is built from it here in the browser
async function downloadShapefile(dataset) {
    const url = await getFileUrl(dataset, 'download');
    if (!url) throw new Error('The file could not be prepared for download. Please try again.');

    let collection;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        collection = await response.json();
    } catch (error) {
        console.error(error);
        throw new Error('The data file could not be read. Check your connection and try again.');
    }

    const base = downloadBase(dataset);
    const { blob, skipped } = await createShapefileZip(collection, base);
    saveBlob(blob, `${base}-shapefile.zip`);

    if (skipped > 0) {
        const text = skipped === 1
            ? '1 feature without geometry was left out of the shapefile.'
            : `${skipped.toLocaleString('en-GB')} features without geometry were left out of the shapefile.`;
        showMessage(message, text, 'warning');
    }
}

// Saves a file made in the browser, using a temporary link
function saveBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = createElement('a');
    link.href = url;
    link.download = fileName;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function showNoAccess(dataset) {
    mapElement.hidden = true;

    if (dataset.access_level === 'restricted') {
        const user = await getCurrentUser();

        if (user) {
            mapStatus.textContent = 'This dataset is restricted. Request access to open it.';
            await showAccessPanel(accessPanel, dataset, user);
        } else {
            mapStatus.textContent = 'This dataset is restricted. Log in to request access.';
        }
    } else if (dataset.access_level === 'internal') {
        mapStatus.textContent = 'This dataset is only available to staff of the owning department.';
    } else {
        mapStatus.textContent = 'The data file is missing or could not be loaded.';
    }
}

// Reads a colour from the stylesheet so the map matches the site theme
function themeColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function createStyle(strokeColor, fillColor, pointColor, width) {
    return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: strokeColor, width }),
        fill: new ol.style.Fill({ color: fillColor }),
        image: new ol.style.Circle({
            radius: 5,
            fill: new ol.style.Fill({ color: pointColor }),
            stroke: new ol.style.Stroke({ color: '#ffffff', width: 1.5 })
        })
    });
}

function drawVectorMap(url) {
    const brand = themeColor('--brand');
    const accent = themeColor('--accent');

    // One style covers lines, polygons and points. The 40 added to the
    // brand colour makes the polygon fill see-through.
    const baseStyle = createStyle(themeColor('--brand-dark'), `${brand}40`, accent, 2);
    const selectedStyle = createStyle(accent, `${accent}66`, accent, 4);

    // GeoJSON is read as EPSG:4326 and converted to the map's projection
    const source = new ol.source.Vector({ url, format: new ol.format.GeoJSON() });

    // VectorImage redraws as a picture while panning, which keeps big layers smooth
    const dataLayer = new ol.layer.VectorImage({ source, style: baseStyle });

    const map = new ol.Map({
        target: mapElement,
        layers: [new ol.layer.Tile({ source: new ol.source.OSM() }), dataLayer],
        view: new ol.View({ center: ol.proj.fromLonLat([34.3, -13.25]), zoom: 6 })
    });

    mapStatus.textContent = 'Loading data...';

    source.once('featuresloadend', () => {
        mapStatus.textContent = '';
        const extent = source.getExtent();
        if (!ol.extent.isEmpty(extent)) {
            map.getView().fit(extent, { padding: [30, 30, 30, 30], maxZoom: 14 });
        }
    });

    source.once('featuresloaderror', () => {
        mapStatus.textContent = 'The data could not be loaded. Please try again later.';
    });

    // Only look at the data layer, and allow a few pixels of slack for thin lines
    const hitOptions = { layerFilter: layer => layer === dataLayer, hitTolerance: 5 };
    let selected = null;

    map.on('singleclick', event => {
        if (selected) selected.setStyle(undefined);

        selected = map.forEachFeatureAtPixel(event.pixel, feature => feature, hitOptions);
        if (selected) selected.setStyle(selectedStyle);

        showFeatureInfo(selected);
    });

    map.on('pointermove', event => {
        if (event.dragging) return;
        map.getTargetElement().style.cursor =
            map.hasFeatureAtPixel(event.pixel, hitOptions) ? 'pointer' : '';
    });
}

// Lists the attributes of the clicked feature, or the hint when nothing was hit
function showFeatureInfo(feature) {
    if (!feature) {
        featureInfo.replaceChildren(
            createElement('p', 'hint', 'Click a feature on the map to see its attributes.')
        );
        return;
    }

    const properties = feature.getProperties();
    delete properties[feature.getGeometryName()];

    const rows = Object.entries(properties).map(([key, value]) => {
        const row = createElement('tr');
        row.append(createElement('th', '', key), createElement('td', '', value == null ? '' : String(value)));
        return row;
    });

    if (rows.length === 0) {
        featureInfo.replaceChildren(createElement('p', 'hint', 'This feature has no attributes.'));
        return;
    }

    const table = createElement('table');
    table.append(...rows);
    featureInfo.replaceChildren(table);
}