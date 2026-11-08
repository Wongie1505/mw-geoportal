import { createElement, createTable } from '../shared/js/ui.js';

// A very large layer would freeze the page, so the preview draws a sample
const MAX_MAP_FEATURES = 5000;
const MAX_ROWS = 5;
const MAX_COLUMNS = 8;
const MAX_CELL_LENGTH = 60;

let map = null;
let source = null;

// Reads a colour from the stylesheet so the map matches the site theme
function themeColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The map is created on first use, once its container is visible
function createMap(container) {
    source = new ol.source.Vector();

    const style = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: themeColor('--brand-dark'), width: 2 }),
        fill: new ol.style.Fill({ color: `${themeColor('--brand')}40` }),
        image: new ol.style.Circle({
            radius: 4,
            fill: new ol.style.Fill({ color: themeColor('--accent') }),
            stroke: new ol.style.Stroke({ color: '#ffffff', width: 1 })
        })
    });

    map = new ol.Map({
        target: container,
        layers: [
            new ol.layer.Tile({ source: new ol.source.OSM() }),
            new ol.layer.VectorImage({ source, style })
        ],
        view: new ol.View({ center: ol.proj.fromLonLat([34.3, -13.25]), zoom: 6 })
    });
}

// Draws the data on a small map. Returns how many features were drawn out of how many have geometry.
export function showMapPreview(container, collection) {
    const features = collection.features.filter(feature => feature.geometry);
    const step = Math.ceil(features.length / MAX_MAP_FEATURES);
    const sample = step > 1 ? features.filter((feature, index) => index % step === 0) : features;

    if (!map) createMap(container);

    source.clear();
    source.addFeatures(
        new ol.format.GeoJSON().readFeatures(
            { type: 'FeatureCollection', features: sample },
            { featureProjection: 'EPSG:3857' }
        )
    );

    // The container was hidden until now, so the map must measure it again
    map.updateSize();
    map.getView().fit(source.getExtent(), { padding: [20, 20, 20, 20], maxZoom: 14 });

    return { shown: sample.length, total: features.length };
}

function cellText(value) {
    if (value === null || value === undefined) return '';

    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}...` : text;
}

// The first few rows of the attribute table, so the person can see what the columns hold
export function showAttributePreview(container, collection, attributes) {
    if (attributes.length === 0) {
        container.replaceChildren(createElement('p', 'field-hint', 'This file has no attribute columns.'));
        return;
    }

    const columns = attributes.slice(0, MAX_COLUMNS);
    const rows = collection.features
        .slice(0, MAX_ROWS)
        .map(feature => columns.map(column => cellText(feature.properties?.[column])));

    container.replaceChildren(createTable(columns, rows));

    if (attributes.length > columns.length) {
        const hidden = attributes.length - columns.length;
        container.append(createElement('p', 'field-hint', `${hidden} more columns are not shown.`));
    }
}