// Reads an uploaded file, checks it, and describes what it holds.
// shp is the shapefile reader loaded by a script tag on the page.

export const MAX_BYTES = 50 * 1024 * 1024;
const LARGE_LAYER = 50000;

// Rough bounding box of Malawi as [minX, minY, maxX, maxY]
const MALAWI = [32.6, -17.2, 36.0, -9.3];

const GEOMETRY_TYPES = [
    'Point', 'MultiPoint', 'LineString', 'MultiLineString',
    'Polygon', 'MultiPolygon', 'GeometryCollection'
];

// A problem the person can fix, with a message written for them
export class FileProblem extends Error {}

export function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function readGeoData(file) {
    if (file.size > MAX_BYTES) {
        throw new FileProblem(`The file is ${formatSize(file.size)}, over the 50 MB limit.`);
    }

    const data = await parseFile(file);
    checkDeclaredCrs(data);

    try {
        return analyse(readFeatures(data));
    } catch (error) {
        if (error instanceof FileProblem) throw error;
        console.error(error);
        throw new FileProblem('The geometry in that file looks malformed and could not be read.');
    }
}

async function parseFile(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.zip')) {
        let layers;
        try {
            layers = await shp(await file.arrayBuffer());
        } catch (error) {
            console.error(error);
            throw new FileProblem('That zip could not be read as a shapefile. It needs the .shp, .dbf and .prj files.');
        }

        if (!Array.isArray(layers)) return layers;
        if (layers.length === 0) throw new FileProblem('The zip holds no shapefile layers.');
        if (layers.length === 1) return layers[0];

        const names = layers.map(layer => layer.fileName).filter(Boolean).join(', ');
        throw new FileProblem(`The zip holds ${layers.length} layers${names ? ` (${names})` : ''}. Upload one layer at a time.`);
    }

    if (name.endsWith('.geojson') || name.endsWith('.json')) {
        try {
            return JSON.parse(await file.text());
        } catch {
            throw new FileProblem('That file is not valid JSON.');
        }
    }

    throw new FileProblem('Upload a GeoJSON file or a zipped shapefile.');
}

// Older GeoJSON files can name their coordinate system. Only WGS 84 is accepted.
function checkDeclaredCrs(data) {
    const crs = data?.crs?.properties?.name;
    if (crs && !/4326|CRS84/i.test(crs)) {
        throw new FileProblem(`The file declares the coordinate system ${crs}. Reproject it to WGS 84 (EPSG:4326) and try again.`);
    }
}

// Accepts a FeatureCollection, a single Feature or a bare geometry
function readFeatures(data) {
    if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) return data.features;
    if (data?.type === 'Feature') return [data];
    if (GEOMETRY_TYPES.includes(data?.type)) return [{ type: 'Feature', properties: {}, geometry: data }];

    throw new FileProblem('That file is not GeoJSON. It should hold a FeatureCollection.');
}

function analyse(inputFeatures) {
    if (inputFeatures.length === 0) throw new FileProblem('The file contains no features.');

    const stats = { bounds: [Infinity, Infinity, -Infinity, -Infinity], invalid: 0, types: {}, noGeometry: 0 };
    const attributes = new Set();

    // Rebuild every feature with clean geometry and only the parts the site uses
    const features = inputFeatures.map(feature => {
        const properties = feature?.properties ?? {};
        Object.keys(properties).forEach(key => attributes.add(key));

        const geometry = cleanGeometry(feature?.geometry, stats);
        if (geometry) {
            stats.types[geometry.type] = (stats.types[geometry.type] ?? 0) + 1;
        } else {
            stats.noGeometry++;
        }
        return { type: 'Feature', properties, geometry };
    });

    if (stats.invalid > 0) {
        throw new FileProblem(
            `${stats.invalid.toLocaleString('en-GB')} coordinates are not valid longitude and latitude values. ` +
            'The data is probably in a projected coordinate system. For a shapefile, include the .prj file. ' +
            'For GeoJSON, reproject it to WGS 84 (EPSG:4326).'
        );
    }

    if (!Number.isFinite(stats.bounds[0])) {
        throw new FileProblem('The file has no usable geometry.');
    }

    const collection = { type: 'FeatureCollection', features };
    const blob = new Blob([JSON.stringify(collection)], { type: 'application/geo+json' });

    if (blob.size > MAX_BYTES) {
        throw new FileProblem(`After processing, the file is ${formatSize(blob.size)}, over the 50 MB limit.`);
    }

    return {
        collection,
        blob,
        bounds: stats.bounds,
        featureCount: features.length,
        geometryTypes: stats.types,
        attributes: [...attributes],
        warnings: findWarnings(features.length, attributes.size, stats)
    };
}

// Things worth a look that should not stop the upload
function findWarnings(featureCount, attributeCount, stats) {
    const warnings = [];

    if (stats.noGeometry > 0) {
        warnings.push(`${stats.noGeometry.toLocaleString('en-GB')} of ${featureCount.toLocaleString('en-GB')} features have no geometry. They are kept but will not appear on the map.`);
    }
    if (attributeCount === 0) {
        warnings.push('The features have no attributes, so clicking a feature will show nothing.');
    }

    const position = locateInMalawi(stats.bounds);
    if (position === 'outside') {
        warnings.push('None of the data lies inside Malawi. Check that the coordinates are right.');
    } else if (position === 'partly') {
        warnings.push('Some of the data lies outside Malawi.');
    }

    if (featureCount > LARGE_LAYER) {
        warnings.push(`This is a large layer with ${featureCount.toLocaleString('en-GB')} features. The map may be slow for viewers.`);
    }
    return warnings;
}

function locateInMalawi([minX, minY, maxX, maxY]) {
    const [mMinX, mMinY, mMaxX, mMaxY] = MALAWI;

    if (minX > mMaxX || maxX < mMinX || minY > mMaxY || maxY < mMinY) return 'outside';
    if (minX >= mMinX && minY >= mMinY && maxX <= mMaxX && maxY <= mMaxY) return 'inside';
    return 'partly';
}

// Returns a copy of the geometry with rounded coordinates, or null if there is none
function cleanGeometry(geometry, stats) {
    if (!geometry || !GEOMETRY_TYPES.includes(geometry.type)) return null;

    if (geometry.type === 'GeometryCollection') {
        const parts = (geometry.geometries ?? []).map(part => cleanGeometry(part, stats)).filter(Boolean);
        return parts.length ? { type: geometry.type, geometries: parts } : null;
    }

    if (!Array.isArray(geometry.coordinates)) return null;
    return { type: geometry.type, coordinates: cleanCoordinates(geometry.coordinates, stats) };
}

// Coordinates are nested to different depths depending on the geometry type.
// A pair of numbers is a position, anything else is a list to go through.
// Positions are rounded to 6 decimals (about 10 cm), which shrinks the file,
// and any height value is dropped.
function cleanCoordinates(coordinates, stats) {
    if (typeof coordinates[0] === 'number') {
        const [x, y] = coordinates;

        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) {
            stats.invalid++;
            return coordinates;
        }

        const bounds = stats.bounds;
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
        return [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];
    }
    return coordinates.map(item => cleanCoordinates(item, stats));
}

// The text form of a rectangle that the database accepts for a geometry column
export function boundsToWkt([minX, minY, maxX, maxY]) {
    return `SRID=4326;POLYGON((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`;
}