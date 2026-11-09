// Turns a GeoJSON collection into a zipped shapefile in the browser.
// The shapefile writer is loaded only when someone asks for this format.

const WRITER_URL = 'https://cdn.jsdelivr.net/npm/@mapbox/shp-write@0.4.3/shpwrite.js';

let loading = null;

function loadWriter() {
    if (window.shpwrite) return Promise.resolve(window.shpwrite);

    if (!loading) {
        loading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = WRITER_URL;
            script.onload = () => resolve(window.shpwrite);
            script.onerror = () => {
                loading = null;
                reject(new Error('The shapefile converter could not be loaded. Check your connection and try again.'));
            };
            document.head.append(script);
        });
    }
    return loading;
}

// Builds the zip. baseName is used for the folder and the file names inside it.
// Returns the zip as a blob and how many features had no geometry to write.
export async function createShapefileZip(collection, baseName, writer) {
    const shpwrite = writer ?? await loadWriter();
    const { features, skipped } = prepareFeatures(collection);

    if (features.length === 0) {
        throw new Error('There are no features with geometry to put in a shapefile.');
    }

    const blob = await shpwrite.zip(
        { type: 'FeatureCollection', features },
        {
            outputType: 'blob',
            compression: 'DEFLATE',
            folder: baseName,
            types: {
                point: `${baseName}_points`,
                polyline: `${baseName}_lines`,
                polygon: `${baseName}_polygons`
            }
        }
    );
    return { blob, skipped };
}

// The writer silently drops multipoints and lets a Polygon file overwrite a
// MultiPolygon file (and the same for lines). To lose nothing, every shape is
// first reduced to Point, MultiLineString or MultiPolygon.
function explodeGeometry(geometry) {
    if (!geometry) return [];

    switch (geometry.type) {
        case 'Point':
            return [geometry];
        case 'MultiPoint':
            return geometry.coordinates.map(coordinates => ({ type: 'Point', coordinates }));
        case 'LineString':
            return [{ type: 'MultiLineString', coordinates: [geometry.coordinates] }];
        case 'MultiLineString':
            return geometry.coordinates.length ? [geometry] : [];
        case 'Polygon':
            return [{ type: 'MultiPolygon', coordinates: [geometry.coordinates] }];
        case 'MultiPolygon':
            return geometry.coordinates.length ? [geometry] : [];
        case 'GeometryCollection':
            return geometry.geometries.flatMap(explodeGeometry);
        default:
            return [];
    }
}

export function prepareFeatures(collection) {
    const flat = [];
    let skipped = 0;

    collection.features.forEach(feature => {
        const geometries = explodeGeometry(feature.geometry);

        if (geometries.length === 0) {
            skipped++;
            return;
        }
        geometries.forEach(geometry => flat.push({ properties: feature.properties ?? {}, geometry }));
    });

    const properties = cleanProperties(flat.map(item => item.properties));

    return {
        features: flat.map((item, index) => ({
            type: 'Feature',
            properties: properties[index],
            geometry: item.geometry
        })),
        skipped
    };
}

// Shapefile column names are limited to 10 letters, numbers and underscores,
// and must be different from each other
function shortNames(keys) {
    const used = new Set();

    return keys.map(key => {
        const base = key.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'field';
        let name = base;

        for (let count = 1; used.has(name.toLowerCase()); count++) {
            const suffix = String(count);
            name = base.slice(0, 10 - suffix.length) + suffix;
        }
        used.add(name.toLowerCase());
        return name;
    });
}

// Gives every feature the same columns, each holding one kind of value.
// A column is a number or a yes/no only when every feature has a value.
// Anything else becomes text, so no gaps are filled with made-up numbers.
function cleanProperties(rows) {
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];

    // A layer with no attributes still needs one column to be a valid shapefile
    if (keys.length === 0) {
        return rows.map((row, index) => ({ fid: index + 1 }));
    }

    const names = shortNames(keys);

    const types = keys.map(key => {
        const values = rows.map(row => row[key]);
        const present = values.filter(value => value !== null && value !== undefined);
        const complete = present.length === values.length;

        if (complete && present.every(value => typeof value === 'number' && Number.isFinite(value))) return 'number';
        if (complete && present.every(value => typeof value === 'boolean')) return 'boolean';
        return 'text';
    });

    return rows.map(row => {
        const clean = {};

        keys.forEach((key, index) => {
            const value = row[key];

            if (types[index] !== 'text') {
                clean[names[index]] = value;
            } else if (value === null || value === undefined) {
                clean[names[index]] = '';
            } else {
                clean[names[index]] = typeof value === 'object' ? JSON.stringify(value) : String(value);
            }
        });
        return clean;
    });
}