export const ACCESS_LABELS = {
    public: 'Public',
    restricted: 'Restricted',
    internal: 'Internal'
};

const ROLE_LABELS = {
    user: 'User',
    member: 'Member',
    manager: 'Manager',
    admin: 'Admin'
};

const STATUS_LABELS = {
    draft: 'Draft',
    pending: 'Pending review',
    changes_requested: 'Changes requested',
    published: 'Published',
    rejected: 'Rejected'
};

// Builds an element. Text is set with textContent, so anything a user typed
// is never read as HTML.
export function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

// Shows text in a .message element. Pass an empty string to clear it.
export function showMessage(element, text, type = 'error') {
    element.textContent = text;
    element.className = text ? `message message-${type}` : 'message';
}

// The coloured pill that says Public, Restricted or Internal
export function accessBadge(level) {
    return createElement('span', `badge badge-${level}`, ACCESS_LABELS[level]);
}

// The pill that shows where a dataset is in the review process
export function statusBadge(status) {
    return createElement('span', `badge badge-status-${status}`, STATUS_LABELS[status]);
}

// "Manager, Health" for staff, just "User" for everyone else
export function describeRole(user) {
    const role = ROLE_LABELS[user.role];
    return user.department ? `${role}, ${user.department}` : role;
}

export function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A short grey line used when a list is empty or could not be loaded
export function createEmptyNote(text) {
    return createElement('p', 'empty-note', text);
}

// Builds a table. Each row is a list of cells, and a cell is a string or an element.
export function createTable(headers, rows) {
    const headRow = createElement('tr');
    headers.forEach(label => headRow.append(createElement('th', '', label)));

    const head = createElement('thead');
    head.append(headRow);

    const body = createElement('tbody');
    rows.forEach(cells => {
        const row = createElement('tr');
        cells.forEach(cell => {
            const td = createElement('td');
            td.append(cell ?? '');
            row.append(td);
        });
        body.append(row);
    });

    const table = createElement('table', 'table');
    table.append(head, body);

    const wrapper = createElement('div', 'table-wrap');
    wrapper.append(table);
    return wrapper;
}

// A number with a label, used for the counts at the top of a section
export function createTile(label, value) {
    const tile = createElement('div', 'tile');
    tile.append(
        createElement('div', 'tile-value', String(value)),
        createElement('div', 'tile-label', label)
    );
    return tile;
}