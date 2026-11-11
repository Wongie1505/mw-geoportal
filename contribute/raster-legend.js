import { createElement, createField } from '../shared/js/ui.js';

const MAX_NAME_LENGTH = 40;

function formatNumber(number) {
    return number.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

// The picture, the legend and, for class rasters, the form where every class
// must be given a name. onChange, if given, runs when a name is typed.
export function createRasterPanel(container, onChange) {
    const image = createElement('img', 'raster-image');
    image.alt = 'Preview of the raster';

    const note = createElement('p', 'field-hint');
    const legend = createElement('div', 'legend');
    const names = createElement('div', 'class-names');

    const figure = createElement('div', 'raster-figure');
    figure.append(image, note);

    const side = createElement('div', 'raster-side');
    side.append(createElement('h3', '', 'Legend'), legend, names);

    container.replaceChildren(figure, side);

    let current = null;
    let imageUrl = null;
    let inputs = [];

    function labels() {
        return inputs.map(input => input.value.trim());
    }

    function showClassLegend() {
        const typed = labels();

        legend.replaceChildren(...current.raster.classes.map((entry, index) => {
            const item = createElement('div', 'legend-item');
            const swatch = createElement('span', 'swatch');
            swatch.style.backgroundColor = current.preview.colors[index];

            item.append(swatch, createElement('span', '', typed[index] || `Class ${entry.value}`));
            return item;
        }));
    }

    function showContinuousLegend() {
        const { raster, preview } = current;

        const bar = createElement('div', 'legend-bar');
        bar.style.background = `linear-gradient(to right, ${preview.colors.join(', ')})`;

        const scale = createElement('div', 'legend-scale');
        scale.append(
            createElement('span', '', formatNumber(raster.stretch.min)),
            createElement('span', '', formatNumber(raster.stretch.max))
        );

        legend.replaceChildren(bar, scale);

        // The colours stop at the 2nd and 98th percentile, so say where the data really ends
        if (raster.min < raster.stretch.min || raster.max > raster.stretch.max) {
            legend.append(createElement('p', 'field-hint',
                `The colours run from the 2nd to the 98th percentile of the values. The data itself runs from ${formatNumber(raster.min)} to ${formatNumber(raster.max)}.`));
        }
    }

    // One required name for every class
    function showNameFields() {
        const count = createElement('p', 'field-hint');

        inputs = current.raster.classes.map((entry, index) => {
            const input = createElement('input');
            input.type = 'text';
            input.id = `class-name-${index}`;
            input.maxLength = MAX_NAME_LENGTH;
            input.required = true;
            input.placeholder = `What is value ${entry.value}?`;

            input.addEventListener('input', () => {
                showClassLegend();
                showCount(count);
                if (onChange) onChange();
            });
            return input;
        });

        names.replaceChildren(
            createElement('h3', '', 'Name the classes'),
            createElement('p', 'field-hint', 'Every class needs a name. People read the map through this legend.'),
            ...inputs.map((input, index) => createField(`Value ${current.raster.classes[index].value}`, input)),
            count
        );
        showCount(count);
    }

    function showCount(count) {
        const done = labels().filter(Boolean).length;
        count.textContent = `${done} of ${inputs.length} classes named.`;
    }

    return {
        show(raster, preview, blob) {
            this.hide();
            current = { raster, preview };
            imageUrl = URL.createObjectURL(blob);

            image.src = imageUrl;
            note.textContent = `A coarse picture of ${preview.width} by ${preview.height} cells, about ${raster.cellMetres * preview.factor} m each. The real data stays behind the request flow.`;

            if (raster.valueType === 'classes') {
                showNameFields();
                showClassLegend();
            } else {
                showContinuousLegend();
            }
            container.hidden = false;
        },

        hide() {
            if (imageUrl) URL.revokeObjectURL(imageUrl);
            imageUrl = null;
            current = null;
            inputs = [];
            container.hidden = true;
            names.replaceChildren();
        },

        // True once there is nothing left to name
        isComplete() {
            return current !== null && labels().every(Boolean);
        },

        labels
    };
}