import { renderNav } from '../shared/js/nav.js';
import { signIn, getCurrentUser } from '../shared/js/auth.js';
import { showMessage } from '../shared/js/ui.js';

const form = document.getElementById('login-form');
const message = document.getElementById('message');
const submitButton = form.querySelector('button[type="submit"]');

renderNav();

// Someone already signed in has no reason to be here
getCurrentUser().then(user => {
    if (user) location.replace('../catalog/catalog.html');
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(message, '');
    submitButton.disabled = true;

    try {
        await signIn(form.elements.email.value.trim(), form.elements.password.value);
        location.href = '../catalog/catalog.html';
    } catch (error) {
        showMessage(message, error.message);
        submitButton.disabled = false;
    }
});

