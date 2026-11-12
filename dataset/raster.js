import { createElement } from '../shared/js/ui.js';

function formatNumber(number) {
    return number.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

// Facts about the raster, as label and value pairs for the details list
export function describeRaster(info) {
    return [
        ['Size', `${info.width.toLocaleString('en-GB')} by ${info.height.toLocaleString('en-GB')} cells`],
        ['Cell size', `About ${info.cell_metres.toLocaleString('en-GB')} m`],
        ['Number type', info.data_type],
        ['Empty cells', info.nodata === null || info.nodata === undefined ? 'No empty value is set' : `Value ${info.nodata}`]
    ];
}

// How coarse the preview picture is. It is the original cell size times the
// number of original cells that went into each cell of the picture.
export function previewCellMetres(info) {
    return Math.round(info.cell_metres * info.width / info.preview.width);
}

// The legend saved with the raster: a swatch for each named class, or a
// colour bar with the two ends of the stretch
export function showLegend(container, info) {
    if (info.type === 'classes') {
        container.replaceChildren(...info.classes.map(entry => {
            const item = createElement('div', 'legend-item');
            const swatch = createElement('span', 'swatch');
            swatch.style.backgroundColor = entry.color;

            item.append(swatch, createElement('span', '', entry.label));
            return item;
        }));
        return;
    }

    const bar = createElement('div', 'legend-bar');
    bar.style.background = `linear-gradient(to right, ${info.ramp.join(', ')})`;

    const scale = createElement('div', 'legend-scale');
    scale.append(
        createElement('span', '', formatNumber(info.stretch.min)),
        createElement('span', '', formatNumber(info.stretch.max))
    );

    container.replaceChildren(bar, scale);

    // The colours stop at the 2nd and 98th percentile, so say where the data really ends
    if (info.min < info.stretch.min || info.max > info.stretch.max) {
        container.append(createElement('p', 'field-hint',
            `The colours run from the 2nd to the 98th percentile of the values. The data itself runs from ${formatNumber(info.min)} to ${formatNumber(info.max)}.`));
    }
}

// Draws the preview picture over the base map, placed by the raster's bounds
export function drawRasterMap({ target, url, info, opacityInput, status }) {
    const source = new ol.source.ImageStatic({
        url,
        imageExtent: info.bounds,
        projection: 'EPSG:4326',
        // Classes must keep hard edges, and smoothing would invent colours between them
        interpolate: info.type !== 'classes'
    });

    const layer = new ol.layer.Image({ source, opacity: Number(opacityInput.value) / 100 });

    const map = new ol.Map({
        target,
        layers: [new ol.layer.Tile({ source: new ol.source.OSM() }), layer],
        view: new ol.View({ center: ol.proj.fromLonLat([34.3, -13.25]), zoom: 6 })
    });

    map.getView().fit(
        ol.proj.transformExtent(info.bounds, 'EPSG:4326', 'EPSG:3857'),
        { padding: [30, 30, 30, 30], maxZoom: 14 }
    );

    opacityInput.addEventListener('input', () => {
        layer.setOpacity(Number(opacityInput.value) / 100);
    });

    source.on('imageloaderror', () => {
        status.textContent = 'The preview could not be loaded. Please try again later.';
    });
    return map;
}