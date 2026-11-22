import { renderNav } from '../shared/js/nav.js';
import { SUPPORT_EMAIL } from '../shared/js/site.js';

renderNav();

// Point the contact link at the address set in site.js
const contact = document.getElementById('contact-email');
if (SUPPORT_EMAIL) {
    contact.href = `mailto:${SUPPORT_EMAIL}`;
    contact.textContent = SUPPORT_EMAIL;
} else {
    contact.replaceWith('the project team');
}