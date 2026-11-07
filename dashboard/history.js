import { supabase } from '../shared/js/supabase.js';
import {
    accessBadge, createElement, createEmptyNote, createTable, createTile, formatDate, statusBadge
} from '../shared/js/ui.js';

// What has been decided so far: counts at the top, then every decision.
// A manager sees their own department, an admin sees all of them.
export async function loadHistory(user, statsContainer, listContainer) {
    let query = supabase
        .from('datasets')
        .select(`id, title, status, access_level, contributor_name, review_note, reviewed_at,
                 departments ( name ), reviewer:profiles!reviewed_by ( full_name )`)
        .not('reviewed_by', 'is', null)
        .in('status', ['published', 'changes_requested', 'rejected'])
        .order('reviewed_at', { ascending: false });

    if (user.role === 'manager') query = query.eq('department_id', user.departmentId);

    const { data, error } = await query;

    if (error) {
        console.error(error);
        statsContainer.replaceChildren();
        listContainer.replaceChildren(createEmptyNote('The review history could not be loaded.'));
        return;
    }

    const count = status => data.filter(row => row.status === status).length;
    statsContainer.replaceChildren(
        createTile('Approved', count('published')),
        createTile('Sent back for changes', count('changes_requested')),
        createTile('Rejected', count('rejected')),
        createTile('Total decisions', data.length)
    );

    if (data.length === 0) {
        listContainer.replaceChildren(createEmptyNote('No decisions have been made yet.'));
        return;
    }

    const isAdmin = user.role === 'admin';
    const headers = ['Title', 'Decision', 'Access', 'Contributed by', 'Decided by', 'Date'];
    if (isAdmin) headers.splice(1, 0, 'Department');

    const rows = data.map(dataset => {
        const title = createElement('div');
        const link = createElement('a', '', dataset.title);
        link.href = `../dataset/dataset.html?id=${encodeURIComponent(dataset.id)}`;
        title.append(link);
        if (dataset.review_note) {
            title.append(createElement('div', 'table-note', `Note: ${dataset.review_note}`));
        }

        // Approved datasets show as published, so say what the decision was
        const decision = statusBadge(dataset.status);
        if (dataset.status === 'published') decision.textContent = 'Approved';

        const cells = [
            title,
            decision,
            accessBadge(dataset.access_level),
            dataset.contributor_name,
            dataset.reviewer?.full_name ?? '',
            formatDate(dataset.reviewed_at)
        ];
        if (isAdmin) cells.splice(1, 0, dataset.departments?.name);
        return cells;
    });

    listContainer.replaceChildren(createTable(headers, rows));
}