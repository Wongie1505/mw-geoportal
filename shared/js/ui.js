// Shows text in a .message element. Pass an empty string to clear it.
// textContent is used so nothing typed by a user is ever read as HTML.
export function showMessage(element, text, type = 'error') {
    element.textContent = text;
    element.className = text ? `message message-${type}` : 'message';
}