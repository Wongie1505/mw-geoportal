import { renderNav } from '../shared/js/nav.js';
import { signUp, getCurrentUser } from '../shared/js/auth.js';
import { showMessage } from '../shared/js/ui.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '../shared/js/site.js';

const form = document.getElementById('register-form');
const message = document.getElementById('message');
const submitButton = form.querySelector('button[type="submit"]');
const termsBox = document.getElementById('accept-terms');
const privacyBox = document.getElementById('accept-privacy');

renderNav();

// Someone already signed in has no reason to be here
getCurrentUser().then(user => {
    if (user) location.replace('../catalog/catalog.html');
});

// The register button only works once both boxes are ticked
function updateSubmitState() {
    submitButton.disabled = !(termsBox.checked && privacyBox.checked);
}

termsBox.addEventListener('change', updateSubmitState);
privacyBox.addEventListener('change', updateSubmitState);
updateSubmitState();

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(message, '');

    const fullName = form.elements.fullName.value.trim();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    // Checked again here in case the button was enabled some other way
    if (!termsBox.checked || !privacyBox.checked) {
        showMessage(message, 'Tick both boxes to agree to the Terms of Use and the Privacy Notice.');
        return;
    }

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
        // The versions are saved with the account, so each acceptance points to the exact text agreed to
        const { needsConfirmation } = await signUp({
            fullName,
            email,
            password,
            termsVersion: TERMS_VERSION,
            privacyVersion: PRIVACY_VERSION
        });

        if (needsConfirmation) {
            form.hidden = true;
            showMessage(message, 'Account created. Check your email for a confirmation link, then log in.', 'success');
        } else {
            location.href = '../catalog/catalog.html';
        }
    } catch (error) {
        showMessage(message, error.message);
        updateSubmitState();
    }
});