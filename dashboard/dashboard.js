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
import { loadSystem } from './system.js';
import { loadAuditLog } from './audit-log.js';
import { setupDepartmentForm } from './add-department.js';
import { setupSidebar } from './sidebar.js';
import { loadPendingCounts } from './badges.js';

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

    let sidebar;

    // Views that were opened since the last change. A view loads when it is
    // opened for the first time, and again after something has changed.
    const opened = new Set();

    const actions = {
        onDeleted: title => {
            showMessage(message, `${title} was deleted.`, 'success');
            refresh();
        },
        onError: text => showMessage(message, text)
    };

    function handleDecision(text) {
        showMessage(message, text, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        refresh();
    }

    // Each view is one menu link. It owns one or more sections, and each
    // section comes with the function that fills it.
    const views = [];

    function addView(id, label, group, sections, bottom = false) {
        views.push({ id, label, group, sections, bottom });
    }

    const work = isAdmin ? 'System' : 'Department';
    const mine = 'My activity';

    if (isUser) {
        addView('join', 'Join a department', mine, [
            ['join-section', () => loadJoin(byId('join-list'))]
        ]);
    }
    if (isManager) {
        addView('summary', 'Overview', work, [
            ['overview-section', () => loadOverview(user, byId('overview'))]
        ]);
    }
    if (isAdmin) {
        addView('system', 'System overview', work, [
            ['system-section', () => loadSystem(byId('system-tiles'), byId('system-downloads'))]
        ]);
        addView('departments', 'Departments', work, [
            ['departments-section', () => loadAllDepartments(byId('departments-list'))]
        ]);
    }
    if (isManager || isAdmin) {
        addView('review', 'Review queue', work, [
            ['review-section', () => loadReviewQueue(user, byId('review-list'), handleDecision)],
            ['history-section', () => loadHistory(user, byId('history-stats'), byId('history-list'))]
        ]);
        addView('membership', 'Membership requests', work, [
            ['membership-section', () => loadMembershipRequests(user, byId('membership-list'), handleDecision)]
        ]);
        addView('access', 'Access requests', work, [
            ['access-section', () => loadAccessQueue(user, byId('access-list'), handleDecision)],
            ['access-history-section', () => loadAccessHistory(user, byId('access-history-stats'), byId('access-history-list'))]
        ]);
        addView('members', 'Members', work, [
            ['members-section', () => loadMembers(user, byId('members-list'), handleDecision)]
        ]);
    }
    if (isManager || isMember) {
        addView('datasets', 'Department datasets', work, [
            ['department-section', () => loadDepartmentDatasets(user, byId('department-list'), actions)]
        ]);
    }
    addView('uploads', 'My uploads', mine, [
        ['uploads-section', () => loadUploads(user, byId('uploads-list'), actions)]
    ]);
    addView('requests', 'My access requests', mine, [
        ['requests-section', () => loadMyRequests(user, byId('requests-list'))]
    ]);
    addView('downloads', 'My downloads', mine, [
        ['downloads-section', () => loadMyDownloads(user, byId('downloads-list'))]
    ]);
    if (isAdmin) {
        addView('audit', 'Audit log', null, [
            ['audit-section', () => loadAuditLog(byId('audit-list'), byId('audit-actions'))]
        ], true);
    }

    function openView(id) {
        const view = views.find(item => item.id === id);

        views.forEach(item => item.sections.forEach(([sectionId]) => {
            byId(sectionId).hidden = item !== view;
        }));

        if (opened.has(id)) return;
        opened.add(id);
        view.sections.forEach(([, load]) => load());
    }

    // After a change only the open view is reloaded, so the others do not
    // ask the database for numbers nobody is looking at
    function refresh() {
        opened.clear();
        openView(sidebar.currentView());
        updateBadges();
    }

    async function updateBadges() {
        if (!isManager && !isAdmin) return;

        const counts = await loadPendingCounts(user);
        Object.entries(counts).forEach(([id, number]) => sidebar.setBadge(id, number));
    }

    sidebar = setupSidebar(views, openView);

    // Built once, so reloading the departments list does not clear the form
    if (isAdmin) setupDepartmentForm(byId('department-form'), handleDecision);

    updateBadges();
}

function byId(id) {
    return document.getElementById(id);
}