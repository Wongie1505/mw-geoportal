import { createElement } from '../shared/js/ui.js';

// Builds a progress bar inside the given element and returns controls for it
export function createProgress(container) {
    const track = createElement('div', 'progress-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');

    const bar = createElement('div', 'progress-bar');
    track.append(bar);

    const label = createElement('p', 'progress-label');
    container.replaceChildren(track, label);

    return {
        show() {
            container.hidden = false;
        },

        hide() {
            container.hidden = true;
        },

        // A moving stripe on the bar shows the page is busy while the percentage waits
        working(isWorking) {
            track.classList.toggle('progress-working', isWorking);
        },

        // percent is 0 to 100. The text says what is happening.
        set(percent, text) {
            const value = Math.round(Math.min(100, Math.max(0, percent)));
            bar.style.width = `${value}%`;
            track.setAttribute('aria-valuenow', String(value));
            label.textContent = `${value}% ${text}`;
        }
    };
}