import { renderNav } from '../shared/js/nav.js';
import { signUp, getCurrentUser } from '../shared/js/auth.js';
import { showMessage } from '../shared/js/ui.js';

const form = document.getElementById('register-form');
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

    const fullName = form.elements.fullName.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    // Checked here for a quick answer. Supabase enforces its own rules too.
    if (!fullName) {
        showMessage(message, 'Enter your full name.');
        return;
    }
    if (password.length < 8) {
        showMessage(message, 'Use a password of at least 8 characters.');
        return;
    }
    if (password !== form.elements.confirmPassword.value) {
        showMessage(message, 'The two passwords do not match.');
        return;
    }

    submitButton.disabled = true;

    try {
        const { needsConfirmation } = await signUp({ fullName, email, password });

        if (needsConfirmation) {
            form.hidden = true;
            showMessage(message, 'Account created. Check your email for a confirmation link, then log in.', 'success');
        } else {
            location.href = '../catalog/catalog.html';
        }
    } catch (error) {
        showMessage(message, error.message);
        submitButton.disabled = false;
    }
});