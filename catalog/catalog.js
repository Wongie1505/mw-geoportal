import { renderNav } from '../shared/js/nav.js';
import { supabase } from '../shared/js/supabase.js';
import { accessBadge, createElement, showMessage } from '../shared/js/ui.js';

const searchInput = document.getElementById('search');
const departmentSelect = document.getElementById('department');
const accessSelect = document.getElementById('access');
const grid = document.getElementById('dataset-grid');
const resultCount = document.getElementById('result-count');
const message = document.getElementById('message');

let datasets = [];

renderNav();
loadCatalog();

[searchInput, departmentSelect, accessSelect].forEach(control => {
    control.addEventListener('input', render);
});

// The catalog is small, so everything is fetched once and filtered in the
// browser. The database still decides which datasets this person may see.
async function loadCatalog() {
    const [datasetResult, departmentResult] = await Promise.all([
        supabase
            .from('datasets')
            .select('id, title, abstract, access_level, kind, keywords, departments ( name )')
            .eq('status', 'published')
            .order('title'),
        supabase.from('departments').select('name').order('name')
    ]);

    const error = datasetResult.error || departmentResult.error;
    if (error) {
        console.error(error);
        showMessage(message, 'The datasets could not be loaded. Please try again.');
        return;
    }

    datasets = datasetResult.data;
    departmentResult.data.forEach(department => {
        const option = createElement('option', '', department.name);
        option.value = department.name;
        departmentSelect.append(option);
    });

    render();
}

function matchesFilters(dataset) {
    const query = searchInput.value.trim().toLowerCase();

    if (departmentSelect.value && dataset.departments?.name !== departmentSelect.value) {
        return false;
    }
    if (accessSelect.value && dataset.access_level !== accessSelect.value) {
        return false;
    }
    if (!query) return true;

    const text = [dataset.title, dataset.abstract, ...dataset.keywords].join(' ');
    return text.toLowerCase().includes(query);
}

function createCard(dataset) {
    const card = createElement('article', 'card');

    const title = createElement('h2');
    const link = createElement('a', '', dataset.title);
    link.href = `../dataset/dataset.html?id=${encodeURIComponent(dataset.id)}`;
    title.append(link);

    const badges = createElement('div', 'badges');
    badges.append(
        accessBadge(dataset.access_level),
        createElement('span', 'badge badge-neutral', dataset.kind === 'raster' ? 'Raster' : 'Vector')
    );

    card.append(
        title,
        badges,
        createElement('p', 'department', dataset.departments?.name ?? ''),
        createElement('p', 'abstract', dataset.abstract)
    );
    return card;
}

function render() {
    const visible = datasets.filter(matchesFilters);

    resultCount.textContent = `${visible.length} of ${datasets.length} datasets`;

    if (visible.length === 0) {
        const text = datasets.length === 0
            ? 'No datasets have been published yet.'
            : 'No datasets match your search.';
        grid.replaceChildren(createElement('p', 'empty', text));
        return;
    }

    grid.replaceChildren(...visible.map(createCard));
}