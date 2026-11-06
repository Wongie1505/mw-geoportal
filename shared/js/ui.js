const ACCESS_LABELS = {
    public: 'Public',
    restricted: 'Restricted',
    internal: 'Internal'
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