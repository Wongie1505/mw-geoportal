import { supabase } from '../shared/js/supabase.js';
import {
    createElement, createEmptyNote, createTable, createTile, formatDate, statusBadge
} from '../shared/js/ui.js';

// Every decision on a request for restricted data, with counts on top.
// A manager sees their own department's, an admin sees all of them.
export async function loadAccessHistory(user, statsContainer, listContainer) {
    const { data, error } = await supabase
        .from('access_requests')
        .select(`id, status, decision_note, decided_at, requester_id, requester_name, requester_email,
                 datasets ( id, title, department_id, departments ( name ) ),
                 decider:profiles!decided_by ( full_name )`)
        .in('status', ['approved', 'rejected'])
        .order('decided_at', { ascending: false });

    if (error) {
        console.error(error);
        statsContainer.replaceChildren();
        listContainer.replaceChildren(createEmptyNote('The access history could not be loaded.'));
        return;
    }

    const decisions = data.filter(request =>
        request.requester_id !== user.id
        && (user.role === 'admin' || request.datasets?.department_id === user.departmentId)
    );

    const count = status => decisions.filter(request => request.status === status).length;
    statsContainer.replaceChildren(
        createTile('Approved', count('approved')),
        createTile('Rejected', count('rejected')),
        createTile('Total decisions', decisions.length)
    );

    if (decisions.length === 0) {
        listContainer.replaceChildren(createEmptyNote('No access requests have been decided yet.'));
        return;
    }

    const isAdmin = user.role === 'admin';
    const headers = ['Dataset', 'Requester', 'Decision', 'Decided by', 'Date'];
    if (isAdmin) headers.splice(1, 0, 'Department');

    const rows = decisions.map(request => {
        const dataset = createElement('div');
        const link = createElement('a', '', request.datasets?.title ?? 'Dataset');
        link.href = `../dataset/dataset.html?id=${encodeURIComponent(request.datasets?.id)}`;
        dataset.append(link);
        if (request.decision_note) {
            dataset.append(createElement('div', 'table-note', `Note: ${request.decision_note}`));
        }

        const cells = [
            dataset,
            request.requester_name,
            statusBadge(request.status),
            request.decider?.full_name ?? '',
            formatDate(request.decided_at)
        ];
        if (isAdmin) cells.splice(1, 0, request.datasets?.departments?.name);
        return cells;
    });

    listContainer.replaceChildren(createTable(headers, rows));
}