import { readBlocks } from './raster.js';

// The preview is deliberately coarse. It is never larger than this on its
// longest side, and its cells are never finer than this, so it is good for
// browsing and no use for analysis. The real file stays behind the request flow.
const PREVIEW_SIDE = 600;
const MIN_CELL_METRES = 250;

// Colours for continuous values, from low to high
export const RAMP = ['#440154', '#3b528b', '#21908d', '#5dc863', '#fde725'];

const CLASS_COLOURS = [
    '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e',
    '#e6ab02', '#a6761d', '#1f78b4', '#b2df8a', '#fb9a99'
];

function hexToRgb(hex) {
    return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
}

function rgbToHex(rgb) {
    return `#${rgb.map(part => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
}

function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const a = s * Math.min(l, 1 - l);
    const channel = n => {
        const k = (n + hue / 30) % 12;
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return rgbToHex([channel(0) * 255, channel(8) * 255, channel(4) * 255]);
}

// Classes without a colour of their own get one from this list, then from
// evenly spread hues once the list runs out
function defaultColour(index) {
    return index < CLASS_COLOURS.length ? CLASS_COLOURS[index] : hslToHex((index * 137.5) % 360, 65, 50);
}

// 256 colours along the ramp, so each cell only needs a lookup
function buildRampTable() {
    const stops = RAMP.map(hexToRgb);

    return Array.from({ length: 256 }, (unused, step) => {
        const position = (step / 255) * (stops.length - 1);
        const from = Math.min(Math.floor(position), stops.length - 2);
        const share = position - from;
        return stops[from].map((part, i) => part + (stops[from + 1][i] - part) * share);
    });
}

// Averages blocks of cells into a small picture of the raster. Cells without
// data stay transparent. Continuous rasters get the mean of each block,
// coloured along the ramp, and class rasters get the most common class.
export async function buildPreview(raster) {
    const { image, width, height, noData } = raster;

    const factor = Math.max(
        1,
        Math.ceil(Math.max(width, height) / PREVIEW_SIDE),
        Math.ceil(MIN_CELL_METRES / Math.max(raster.cellMetres, 1))
    );
    const outWidth = Math.ceil(width / factor);
    const outHeight = Math.ceil(height / factor);
    const pixels = new Uint8ClampedArray(outWidth * outHeight * 4);

    // Calls add for every cell that holds data, with the cell's place in the picture
    async function eachCell(add) {
        await readBlocks(image, width, height, (band, top, rows) => {
            for (let row = 0; row < rows; row++) {
                const rowStart = Math.floor((top + row) / factor) * outWidth;

                for (let x = 0; x < width; x++) {
                    const value = band[row * width + x];
                    if (value === noData || !Number.isFinite(value)) continue;
                    add(rowStart + Math.floor(x / factor), value);
                }
            }
        });
    }

    const preview = { width: outWidth, height: outHeight, factor, pixels };

    if (raster.valueType === 'classes') {
        preview.colors = await paintClasses(raster, eachCell, pixels);
    } else {
        await paintContinuous(raster, eachCell, pixels);
        preview.colors = RAMP;
    }
    return preview;
}

async function paintContinuous(raster, eachCell, pixels) {
    const total = pixels.length / 4;
    const sums = new Float64Array(total);
    const counts = new Uint32Array(total);

    await eachCell((place, value) => {
        sums[place] += value;
        counts[place]++;
    });

    const table = buildRampTable();
    const { min, max } = raster.stretch;

    for (let place = 0; place < total; place++) {
        if (counts[place] === 0) continue;

        const mean = sums[place] / counts[place];
        const share = max > min ? (mean - min) / (max - min) : 0.5;
        const colour = table[Math.round(Math.min(1, Math.max(0, share)) * 255)];

        pixels.set([colour[0], colour[1], colour[2], 255], place * 4);
    }
}

async function paintClasses(raster, eachCell, pixels) {
    const classes = raster.classes;
    const colors = classes.map((entry, index) => entry.color ?? defaultColour(index));
    const total = pixels.length / 4;

    // Finds the position of a class from its value. Classes are whole numbers,
    // so a plain table works unless the values are spread very wide.
    const first = classes[0].value;
    const span = classes[classes.length - 1].value - first + 1;
    const table = span <= 1_000_000 ? new Int16Array(span).fill(-1) : null;
    const lookup = new Map();

    classes.forEach((entry, index) => {
        if (table) table[entry.value - first] = index;
        else lookup.set(entry.value, index);
    });

    const votes = new Uint32Array(total * classes.length);

    await eachCell((place, value) => {
        const index = table ? table[value - first] : lookup.get(value);
        votes[place * classes.length + index]++;
    });

    for (let place = 0; place < total; place++) {
        let best = -1;
        let most = 0;

        for (let index = 0; index < classes.length; index++) {
            const count = votes[place * classes.length + index];
            if (count > most) {
                most = count;
                best = index;
            }
        }
        if (best === -1) continue;

        pixels.set([...hexToRgb(colors[best]), 255], place * 4);
    }
    return colors;
}

export function previewToBlob(preview) {
    const canvas = document.createElement('canvas');
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.getContext('2d').putImageData(new ImageData(preview.pixels, preview.width, preview.height), 0, 0);

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('The preview picture could not be made.'));
        }, 'image/png');
    });
}

// What is saved with the dataset in raster_info: everything the dataset page
// needs to draw the legend, and the figures people want to know about the file
export function buildRasterInfo(raster, preview, labels) {
    const info = {
        type: raster.valueType,
        width: raster.width,
        height: raster.height,
        cell_metres: raster.cellMetres,
        data_type: raster.dataType,
        nodata: Number.isFinite(raster.noData) ? raster.noData : null,
        min: raster.min,
        max: raster.max,
        preview: { width: preview.width, height: preview.height }
    };

    if (raster.valueType === 'classes') {
        info.classes = raster.classes.map((entry, index) => ({
            value: entry.value,
            label: labels[index],
            color: preview.colors[index]
        }));
    } else {
        info.stretch = raster.stretch;
        info.ramp = RAMP;
    }
    return info;
}