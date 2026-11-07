import { renderNav } from '../shared/js/nav.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { createElement, describeRole, showMessage } from '../shared/js/ui.js';
import { loadUploads } from './uploads.js';
import { loadReviewQueue } from './review.js';
import { loadHistory } from './history.js';
import { loadAllDepartments } from './departments.js';
import { loadOverview, loadMembers, loadDepartmentDatasets } from './department.js';

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

    const isManager = user.role === 'manager';
    const isAdmin = user.role === 'admin';
    const isMember = user.role === 'member';

    let loadAll;

    // What the page does when a dataset is deleted or a decision is made.
    // Every section is reloaded because the numbers in several of them change.
    const actions = {
        onDeleted: title => {
            showMessage(message, `${title} was deleted.`, 'success');
            loadAll();
        },
        onError: text => showMessage(message, text)
    };

    function handleDecision(text) {
        showMessage(message, text, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        loadAll();
    }

    // Every role builds on the one below it, so each adds sections to the same
    // page. Each entry is a section id and the function that fills it.
    const sections = [];

    if (isManager) {
        sections.push(['overview-section', () => loadOverview(user, byId('overview'))]);
    }
    if (isAdmin) {
        sections.push(['departments-section', () => loadAllDepartments(byId('departments-list'))]);
    }
    if (isManager || isAdmin) {
        sections.push(['review-section', () => loadReviewQueue(user, byId('review-list'), handleDecision)]);
        sections.push(['history-section', () => loadHistory(user, byId('history-stats'), byId('history-list'))]);
    }
    if (isManager) {
        sections.push(['members-section', () => loadMembers(user, byId('members-list'))]);
    }
    sections.push(['uploads-section', () => loadUploads(user, byId('uploads-list'), actions)]);
    if (isManager || isMember) {
        sections.push(['department-section', () => loadDepartmentDatasets(user, byId('department-list'), actions)]);
    }

    sections.forEach(([id]) => { byId(id).hidden = false; });
    loadAll = () => sections.forEach(([, load]) => load());
    loadAll();
}

function byId(id) {
    return document.getElementById(id);
}