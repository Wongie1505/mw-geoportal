import { supabase } from '../shared/js/supabase.js';
import {
    createElement, createEmptyNote, createField, createTable, formatDateTime, showMessage
} from '../shared/js/ui.js';

const PAGE_SIZE = 50;

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

// The extra facts of an entry, kept closed until someone wants to read them
function createDetails(details) {
    if (!details || Object.keys(details).length === 0) return '';

    const wrapper = createElement('details', 'audit-details');
    wrapper.append(
        createElement('summary', '', 'View'),
        createElement('pre', '', JSON.stringify(details, null, 2))
    );
    return wrapper;
}

// Builds the filter bar and the list, then loads the newest entries.
// Apply loads the list again, so it also works as a refresh.
export function loadAuditLog(container) {
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

    let entries = [];

    async function load(reset) {
        if (reset) entries = [];

        showMessage(feedback, '');
        [apply, more].forEach(button => { button.disabled = true; });

        const filter = FILTERS[Number(select.value)];

        let query = supabase
            .from('audit_log')
            .select('id, created_at, actor_email, actor_department, action, dataset_title, details')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(entries.length, entries.length + PAGE_SIZE - 1);

        if (filter.like) query = query.like('action', filter.like);
        if (filter.equals) query = query.eq('action', filter.equals);

        // Characters that mean something in a filter are dropped from the search text
        const person = search.value.trim().replace(/[%,()]/g, '');
        if (person) query = query.ilike('actor_email', `%${person}%`);

        const { data, error } = await query;
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

    apply.addEventListener('click', () => load(true));
    more.addEventListener('click', () => load(false));
    search.addEventListener('keydown', event => {
        if (event.key === 'Enter') load(true);
    });

    const footer = createElement('div', 'review-actions');
    footer.append(more);

    container.replaceChildren(toolbar, feedback, results, footer);
    load(true);
}