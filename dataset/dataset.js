import { renderNav } from '../shared/js/nav.js';
import { supabase } from '../shared/js/supabase.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { getSignedUrl } from '../shared/js/storage.js';
import { accessBadge, createElement, showMessage } from '../shared/js/ui.js';

const message = document.getElementById('message');
const article = document.getElementById('dataset');
const mapElement = document.getElementById('map');
const mapStatus = document.getElementById('map-status');
const statusNotice = document.getElementById('status-notice');
const details = document.getElementById('details');
const featureInfo = document.getElementById('feature-info');

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
                 status, review_note, published_at, departments ( name )`)
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
    addDetail('Keywords', dataset.keywords.join(', '));
    addDetail('Published', dataset.published_at
        ? new Date(dataset.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : '');

    showStatusNotice(dataset);
    article.hidden = false;
}

async function showMap(dataset) {
    if (dataset.kind !== 'vector') {
        mapElement.hidden = true;
        mapStatus.textContent = 'Raster preview is coming in a later update.';
        return;
    }

    // The database decides whether this person may open the file. If it
    // says no, there is nothing to draw.
    const url = await getSignedUrl(dataset.file_path);
    if (!url) {
        await showNoAccess(dataset);
        return;
    }

    drawVectorMap(url);
}

async function showNoAccess(dataset) {
    mapElement.hidden = true;

    if (dataset.access_level === 'restricted') {
        const user = await getCurrentUser();
        mapStatus.textContent = user
            ? 'This dataset is restricted. Requesting access will be available soon.'
            : 'This dataset is restricted. Log in to request access.';
    } else if (dataset.access_level === 'internal') {
        mapStatus.textContent = 'This dataset is only available to staff of the owning department.';
    } else {
        mapStatus.textContent = 'The data file could not be loaded. Please try again later.';
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