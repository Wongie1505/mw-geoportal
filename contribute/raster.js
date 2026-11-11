import { FileProblem, formatSize, MAX_BYTES } from './geodata.js';

// The most cells a raster may have. A bigger one should be clipped or
// resampled first, because the browser has to read it to build the preview.
const MAX_CELLS = 50_000_000;
const LARGE_CELLS = 25_000_000;

// A raster with more distinct whole values than this is treated as continuous
const MAX_CLASSES = 30;

// Cells read at a time, and how many cells are kept to work out the stretch
const READ_CELLS = 4_000_000;
const SAMPLE_SIZE = 200_000;

export function isRasterFile(file) {
    return /\.tiff?$/i.test(file.name);
}

// Checks a GeoTIFF and reads what the upload and the preview need to know
// about it. Nothing is uploaded. It throws a FileProblem when the raster is
// not acceptable, with a message that says what to fix.
export async function readRaster(file) {
    if (file.size > MAX_BYTES) {
        throw new FileProblem(`The file is ${formatSize(file.size)}, over the 50 MB limit.`);
    }

    let image;
    try {
        const tiff = await GeoTIFF.fromBlob(file);
        image = await tiff.getImage();
    } catch (error) {
        console.error(error);
        throw new FileProblem('That file could not be read as a GeoTIFF.');
    }

    const width = image.getWidth();
    const height = image.getHeight();

    if (image.getSamplesPerPixel() !== 1) {
        throw new FileProblem(`Only single band rasters are accepted. This one has ${image.getSamplesPerPixel()} bands.`);
    }
    if (width * height > MAX_CELLS) {
        throw new FileProblem(`The raster has ${(width * height / 1e6).toFixed(0)} million cells, over the limit of ${MAX_CELLS / 1e6} million. Clip it or resample it to a coarser cell size first.`);
    }

    const bounds = readBounds(image);
    checkCoordinateSystem(image);
    checkBounds(bounds);

    const dataType = readDataType(image);
    const noData = image.getGDALNoData();

    const stats = await readValues(image, width, height, noData);
    if (stats.valid === 0) {
        throw new FileProblem('The raster has no valid cells, every cell is empty.');
    }

    const warnings = [];
    if (width * height > LARGE_CELLS) {
        warnings.push('This is a large raster. Building the preview may take a while.');
    }

    const [resolutionX, resolutionY] = image.getResolution();
    const middleLatitude = (bounds[1] + bounds[3]) / 2;

    const raster = {
        width,
        height,
        bounds,
        dataType,
        noData,
        min: stats.min,
        max: stats.max,
        // Rough cell size in metres at the middle of the raster
        cellMetres: Math.round(Math.abs(resolutionX) * 111320 * Math.cos(middleLatitude * Math.PI / 180)),
        warnings
    };

    if (stats.classes) {
        raster.valueType = 'classes';
        raster.classes = addPaletteColours(image, stats.classes);
    } else {
        raster.valueType = 'continuous';
        raster.stretch = stats.stretch;
    }
    return raster;
}

function readBounds(image) {
    let bounds;
    try {
        bounds = image.getBoundingBox();
    } catch (error) {
        throw new FileProblem('The raster has no location information. Save it as a georeferenced GeoTIFF in EPSG:4326.');
    }

    // A rotated raster does not fit in a simple extent
    const transform = image.fileDirectory.ModelTransformation;
    if (transform && (transform[1] !== 0 || transform[4] !== 0)) {
        throw new FileProblem('The raster is rotated. Warp it to EPSG:4326 in QGIS so that north is up, then upload it again.');
    }

    return bounds;
}

// Only WGS 84 is accepted for now
function checkCoordinateSystem(image) {
    const keys = image.getGeoKeys() ?? {};
    const code = keys.GeographicTypeGeoKey ?? keys.ProjectedCSTypeGeoKey;

    if (code === 4326 && !keys.ProjectedCSTypeGeoKey) return;

    const found = code && code !== 32767 ? `EPSG:${code}` : 'a coordinate system that could not be identified';
    throw new FileProblem(`The raster is in ${found}. Rasters must be in WGS 84 (EPSG:4326). In QGIS use Raster, Projections, Warp (Reproject), then upload the result.`);
}

// The coordinates must be possible longitudes and latitudes
function checkBounds([minX, minY, maxX, maxY]) {
    if (minX < -180 || maxX > 180 || minY < -90 || maxY > 90) {
        throw new FileProblem('The raster runs outside the world\'s longitude and latitude range. Check its georeferencing, or reproject it to EPSG:4326 and upload it again.');
    }
}

function readDataType(image) {
    const bits = image.getBitsPerSample();
    const format = image.getSampleFormat();

    if (![1, 2, 3].includes(format) || (bits === 64 && format !== 3)) {
        throw new FileProblem('The cell values use a number type that is not supported. Convert the raster to Float32 or a 32 bit integer type.');
    }
    if (format === 3) return `Float${bits}`;
    return `${format === 2 ? 'Int' : 'UInt'}${bits}`;
}

// Goes through every cell once, in blocks so that the browser does not have
// to hold the whole raster. Finds the lowest and highest value, whether the
// values are a few whole numbers (classes), and the range that holds 96% of
// the cells, which is what the preview colours are stretched over.
async function readValues(image, width, height, noData) {
    const blockHeight = image.getTileHeight();
    const rows = Math.min(height, Math.max(blockHeight, Math.floor(READ_CELLS / width / blockHeight) * blockHeight));
    const keep = Math.max(1, Math.ceil(width * height / SAMPLE_SIZE));

    let min = Infinity;
    let max = -Infinity;
    let valid = 0;
    let sample = [];

    // Counts per value, until it is clear that the raster is not classes
    let counts = new Map();
    let run = { value: null, count: 0 };

    function flushRun() {
        if (run.count && counts) {
            counts.set(run.value, (counts.get(run.value) ?? 0) + run.count);
            if (counts.size > MAX_CLASSES) counts = null;
        }
        run = { value: null, count: 0 };
    }

    for (let top = 0; top < height; top += rows) {
        const window = [0, top, width, Math.min(top + rows, height)];
        const [band] = await image.readRasters({ window, samples: [0] });

        for (let i = 0; i < band.length; i++) {
            const value = band[i];
            if (value === noData || !Number.isFinite(value)) continue;

            valid++;
            if (value < min) min = value;
            if (value > max) max = value;
            if (valid % keep === 0) sample.push(value);

            if (counts) {
                if (!Number.isInteger(value)) {
                    counts = null;
                } else if (value === run.value) {
                    run.count++;
                } else {
                    flushRun();
                    run = { value, count: 1 };
                }
            }
        }
    }
    flushRun();

    const result = { valid, min, max };

    if (counts && counts.size > 0) {
        result.classes = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
    } else if (valid > 0) {
        sample = Float64Array.from(sample).sort();
        const at = share => sample[Math.floor(share * (sample.length - 1))];
        result.stretch = { min: at(0.02), max: at(0.98) };
    }
    return result;
}

// A palette inside the file gives the classes their colours. Black is skipped,
// because files fill the classes they do not use with black, so it cannot be
// told apart from a class that was never given a colour.
function addPaletteColours(image, classes) {
    const palette = image.fileDirectory.ColorMap;
    if (!palette) return classes;

    const size = palette.length / 3;
    const hex = number => (number >> 8).toString(16).padStart(2, '0');

    return classes.map(entry => {
        if (entry.value < 0 || entry.value >= size) return entry;
        const colour = `#${hex(palette[entry.value])}${hex(palette[size + entry.value])}${hex(palette[2 * size + entry.value])}`;
        return colour === '#000000' ? entry : { ...entry, color: colour };
    });
}