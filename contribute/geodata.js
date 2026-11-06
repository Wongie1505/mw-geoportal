// Turns an uploaded file into GeoJSON and finds the area it covers.
// shp is the shapefile reader loaded by a script tag on the page.

export async function readGeoData(file) {
    let data;

    if (file.name.toLowerCase().endsWith('.zip')) {
        data = await shp(await file.arrayBuffer());

        // A zip holding several layers comes back as a list. Take the first.
        if (Array.isArray(data)) data = data[0];
    } else {
        data = JSON.parse(await file.text());
    }

    const bounds = findBounds(data);
    if (!Number.isFinite(bounds[0])) {
        throw new Error('The file has no coordinates');
    }

    return {
        blob: new Blob([JSON.stringify(data)], { type: 'application/geo+json' }),
        bounds
    };
}

// Bounds are [minX, minY, maxX, maxY]
function findBounds(data) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    visit(data, bounds);
    return bounds;
}

// Walks a FeatureCollection, Feature or bare geometry down to its coordinates
function visit(node, bounds) {
    if (!node) return;

    if (node.type === 'FeatureCollection') {
        node.features.forEach(feature => visit(feature, bounds));
    } else if (node.type === 'Feature') {
        visit(node.geometry, bounds);
    } else if (node.type === 'GeometryCollection') {
        node.geometries.forEach(geometry => visit(geometry, bounds));
    } else {
        addCoordinates(node.coordinates, bounds);
    }
}

// Coordinates are nested to different depths depending on the geometry type.
// A pair of numbers is a position, anything else is a list to go through.
function addCoordinates(coordinates, bounds) {
    if (typeof coordinates[0] === 'number') {
        bounds[0] = Math.min(bounds[0], coordinates[0]);
        bounds[1] = Math.min(bounds[1], coordinates[1]);
        bounds[2] = Math.max(bounds[2], coordinates[0]);
        bounds[3] = Math.max(bounds[3], coordinates[1]);
        return;
    }
    coordinates.forEach(item => addCoordinates(item, bounds));
}

// The text form of a rectangle that the database accepts for a geometry column
export function boundsToWkt([minX, minY, maxX, maxY]) {
    return `SRID=4326;POLYGON((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`;
}