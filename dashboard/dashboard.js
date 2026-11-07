import { renderNav } from '../shared/js/nav.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { createElement, describeRole, showMessage } from '../shared/js/ui.js';
import { loadUploads } from './uploads.js';
import { loadReviewQueue } from './review.js';
import { loadOverview, loadDepartmentDatasets } from './department.js';

const loginNotice = document.getElementById('login-notice');
const welcome = document.getElementById('welcome');
const message = document.getElementById('message');

renderNav();
start();

async function start() {
    const user = await getCurrentUser();

    if (!user) {
        loginNotice.hidden = false;
        document.querySelector('.dashboard-header').hidden = true;
        return;
    }

    welcome.append(
        `Welcome, ${user.fullName || user.email}`,
        createElement('span', 'badge badge-neutral', describeRole(user))
    );

    // Every role builds on the one below it, so each adds sections to the same page
    const isManager = user.role === 'manager';
    const isMember = user.role === 'member';

    if (isManager) show('overview-section', () => loadOverview(user, byId('overview')));

    if (isManager || user.role === 'admin') {
        show('review-section', () => loadReviewQueue(user, byId('review-list'), handleDecision));
    }

    show('uploads-section', () => loadUploads(user, byId('uploads-list')));

    if (isManager || isMember) {
        show('department-section', () => loadDepartmentDatasets(user, byId('department-list')));
    }

    // After a review, the manager's numbers and department list have changed
    function handleDecision(text) {
        showMessage(message, text, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (isManager) {
            loadOverview(user, byId('overview'));
            loadDepartmentDatasets(user, byId('department-list'));
        }
    }
}

function byId(id) {
    return document.getElementById(id);
}

// Reveals a section and fills it
function show(sectionId, load) {
    byId(sectionId).hidden = false;
    load();
}