import { supabase } from '../shared/js/supabase.js';
import { canDelete, createDeleteButton } from '../shared/js/datasets.js';
import {
    accessBadge, createElement, createEmptyNote, createTable, createTile, formatDate, statusBadge
} from '../shared/js/ui.js';

// The numbers a manager sees at the top: members and datasets by status
export async function loadOverview(user, container) {
    const [datasets, members] = await Promise.all([
        supabase.from('datasets').select('status').eq('department_id', user.departmentId),
        supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('department_id', user.departmentId)
    ]);

    if (datasets.error || members.error) {
        console.error(datasets.error || members.error);
        container.replaceChildren(createEmptyNote('The overview could not be loaded.'));
        return;
    }

    const counts = { published: 0, pending: 0, changes_requested: 0, rejected: 0 };
    datasets.data.forEach(row => {
        if (row.status in counts) counts[row.status]++;
    });

    container.replaceChildren(
        createTile('Members', members.count),
        createTile('Published', counts.published),
        createTile('Pending review', counts.pending),
        createTile('Changes requested', counts.changes_requested),
        createTile('Rejected', counts.rejected)
    );
}

// Everything the department owns. Members see what is published, managers
// also see datasets that are pending or were sent back, and can delete them.
export async function loadDepartmentDatasets(user, container, actions) {
    const isManager = user.role === 'manager';

    let query = supabase
        .from('datasets')
        .select(`id, title, status, access_level, contributor_name, contributed_by,
                 department_id, file_path, preview_path, published_at, created_at`)
        .eq('department_id', user.departmentId)
        .order('title');

    if (!isManager) query = query.eq('status', 'published');

    const { data, error } = await query;

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The department datasets could not be loaded.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote('The department has no datasets yet.'));
        return;
    }

    const headers = ['Title', 'Access', 'Contributed by', 'Date'];
    if (isManager) headers.splice(2, 0, 'Status');
    if (isManager) headers.push('');

    const rows = data.map(dataset => {
        const title = createElement('a', '', dataset.title);
        title.href = `../dataset/dataset.html?id=${encodeURIComponent(dataset.id)}`;

        const cells = [
            title,
            accessBadge(dataset.access_level),
            dataset.contributor_name,
            formatDate(dataset.published_at ?? dataset.created_at)
        ];

        if (isManager) {
            cells.splice(2, 0, statusBadge(dataset.status));
            cells.push(canDelete(user, dataset) ? createDeleteButton(dataset, actions) : '');
        }
        return cells;
    });

    container.replaceChildren(createTable(headers, rows));
}