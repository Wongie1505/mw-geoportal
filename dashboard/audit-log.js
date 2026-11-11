import { supabase } from '../shared/js/supabase.js';
import {
    createElement, createEmptyNote, createField, createTable, formatDateTime, showMessage
} from '../shared/js/ui.js';

const PAGE_SIZE = 50;

// The export gets the matching entries in chunks, up to this many
const EXPORT_CHUNK = 1000;
const EXPORT_LIMIT = 10000;

const COLUMNS = 'id, created_at, actor_email, actor_department, action, dataset_title, details';

// What each choice in the filter asks the database for
const FILTERS = [
    { label: 'All activity' },
    { label: 'Datasets', like: 'dataset_%' },
    { label: 'Downloads', equals: 'dataset_downloaded' },
    { label: 'Access requests', like: 'access_%' },
    { label: 'Membership', like: 'membership_%' },
    { label: 'Role changes', equals: 'role_changed' }
];

// "dataset_downloaded" becomes "Dataset downloaded"
function describeAction(action) {
    const text = action.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function hasDetails(details) {
    return details && Object.keys(details).length > 0;
}

// The extra facts of an entry, kept closed until someone wants to read them
function createDetails(details) {
    if (!hasDetails(details)) return '';

    const wrapper = createElement('details', 'audit-details');
    wrapper.append(
        createElement('summary', '', 'View'),
        createElement('pre', '', JSON.stringify(details, null, 2))
    );
    return wrapper;
}

// One cell of the CSV file, always in quotes. A cell that starts with one of
// these characters would be run as a formula by Excel, so it gets a ' in front.
function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(entries) {
    const header = ['Time', 'Person', 'Department', 'Action', 'Dataset', 'Details'];

    const lines = [header, ...entries.map(entry => [
        entry.created_at,
        entry.actor_email,
        entry.actor_department,
        entry.action,
        entry.dataset_title,
        hasDetails(entry.details) ? JSON.stringify(entry.details) : ''
    ])].map(row => row.map(csvCell).join(','));

    // The mark at the start tells Excel the file is UTF-8
    const file = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// Builds the filter bar and the list, then loads the newest entries. Apply
// loads the list again, so it also works as a refresh. The export button goes
// into actions, which sits in the title row of the section.
export function loadAuditLog(container, actions) {
    const select = createElement('select');
    select.id = 'audit-filter';
    FILTERS.forEach((filter, index) => {
        const option = createElement('option', '', filter.label);
        option.value = String(index);
        select.append(option);
    });

    const search = createElement('input');
    search.id = 'audit-search';
    search.type = 'search';
    search.placeholder = 'Search by email';

    const apply = createElement('button', 'button', 'Apply');
    apply.type = 'button';

    const toolbar = createElement('div', 'audit-filters');
    toolbar.append(createField('Show', select), createField('Person', search), apply);

    const feedback = createElement('div', 'message');
    const results = createElement('div');

    const more = createElement('button', 'button button-outline', 'Load more');
    more.type = 'button';
    more.hidden = true;

    const exportButton = createElement('button', 'button button-outline', 'Export CSV');
    exportButton.type = 'button';
    actions.replaceChildren(exportButton);

    let entries = [];
    let applied;

    // Characters that mean something in a filter are dropped from the search text
    function readControls() {
        return {
            filter: FILTERS[Number(select.value)],
            person: search.value.trim().replace(/[%,()]/g, '')
        };
    }

    // Load more and the export keep to what Apply last asked for, even if the
    // controls were changed since
    function buildQuery() {
        let query = supabase
            .from('audit_log')
            .select(COLUMNS)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });

        if (applied.filter.like) query = query.like('action', applied.filter.like);
        if (applied.filter.equals) query = query.eq('action', applied.filter.equals);
        if (applied.person) query = query.ilike('actor_email', `%${applied.person}%`);
        return query;
    }

    async function load(reset) {
        if (reset) {
            entries = [];
            applied = readControls();
        }

        showMessage(feedback, '');
        [apply, more].forEach(button => { button.disabled = true; });

        const { data, error } = await buildQuery().range(entries.length, entries.length + PAGE_SIZE - 1);
        [apply, more].forEach(button => { button.disabled = false; });

        if (error) {
            console.error(error);
            showMessage(feedback, 'The audit log could not be loaded.');
            return;
        }

        entries = entries.concat(data);
        more.hidden = data.length < PAGE_SIZE;
        show();
    }

    function show() {
        if (entries.length === 0) {
            results.replaceChildren(createEmptyNote('No entries match.'));
            return;
        }

        const rows = entries.map(entry => [
            formatDateTime(entry.created_at),
            entry.actor_email ?? 'System',
            entry.actor_department ?? '',
            describeAction(entry.action),
            entry.dataset_title ?? '',
            createDetails(entry.details)
        ]);

        results.replaceChildren(createTable(
            ['Time', 'Person', 'Department', 'Action', 'Dataset', 'Details'],
            rows
        ));
    }

    async function exportAll() {
        showMessage(feedback, '');
        exportButton.disabled = true;
        exportButton.textContent = 'Preparing...';

        const all = [];

        while (all.length < EXPORT_LIMIT) {
            const { data, error } = await buildQuery().range(all.length, all.length + EXPORT_CHUNK - 1);

            if (error) {
                console.error(error);
                showMessage(feedback, 'The export failed. Please try again.');
                exportButton.disabled = false;
                exportButton.textContent = 'Export CSV';
                return;
            }

            all.push(...data);
            if (data.length < EXPORT_CHUNK) break;
        }

        downloadCsv(all);

        if (all.length >= EXPORT_LIMIT) {
            showMessage(feedback, `Exported the newest ${EXPORT_LIMIT} entries. Narrow the filter to reach older ones.`, 'success');
        }
        exportButton.disabled = false;
        exportButton.textContent = 'Export CSV';
    }

    apply.addEventListener('click', () => load(true));
    more.addEventListener('click', () => load(false));
    exportButton.addEventListener('click', exportAll);
    search.addEventListener('keydown', event => {
        if (event.key === 'Enter') load(true);
    });

    const footer = createElement('div', 'review-actions');
    footer.append(more);

    container.replaceChildren(toolbar, feedback, results, footer);
    load(true);
}