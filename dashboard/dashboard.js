import { renderNav } from '../shared/js/nav.js';
import { getCurrentUser } from '../shared/js/auth.js';
import { createElement, describeRole, showMessage } from '../shared/js/ui.js';
import { loadUploads } from './uploads.js';
import { loadReviewQueue } from './review.js';
import { loadHistory } from './history.js';
import { loadAccessQueue } from './access-queue.js';
import { loadAccessHistory } from './access-history.js';
import { loadMyRequests } from './my-requests.js';
import { loadMyDownloads } from './my-downloads.js';
import { loadAllDepartments } from './departments.js';
import { loadOverview, loadDepartmentDatasets } from './department.js';
import { loadJoin } from './join.js';
import { loadMembershipRequests } from './membership-requests.js';
import { loadMembers, setupLeaveButton } from './members.js';

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
    const isUser = user.role === 'user';

    setupLeaveButton(user, byId('leave-button'), text => showMessage(message, text));

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

    if (isUser) {
        sections.push(['join-section', () => loadJoin(byId('join-list'))]);
    }
    if (isManager) {
        sections.push(['overview-section', () => loadOverview(user, byId('overview'))]);
    }
    if (isAdmin) {
        sections.push(['departments-section', () => loadAllDepartments(byId('departments-list'))]);
    }
    if (isManager || isAdmin) {
        sections.push(['review-section', () => loadReviewQueue(user, byId('review-list'), handleDecision)]);
        sections.push(['membership-section', () => loadMembershipRequests(user, byId('membership-list'), handleDecision)]);
        sections.push(['access-section', () => loadAccessQueue(user, byId('access-list'), handleDecision)]);
        sections.push(['history-section', () => loadHistory(user, byId('history-stats'), byId('history-list'))]);
        sections.push(['access-history-section', () => loadAccessHistory(user, byId('access-history-stats'), byId('access-history-list'))]);
    }
    if (isManager || isAdmin) {
        sections.push(['members-section', () => loadMembers(user, byId('members-list'), handleDecision)]);
    }
    sections.push(['uploads-section', () => loadUploads(user, byId('uploads-list'), actions)]);
    sections.push(['requests-section', () => loadMyRequests(user, byId('requests-list'))]);
    sections.push(['downloads-section', () => loadMyDownloads(user, byId('downloads-list'))]);
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