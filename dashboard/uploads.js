import { supabase } from '../shared/js/supabase.js';
import { canDelete, createDeleteButton } from '../shared/js/datasets.js';
import {
    accessBadge, createElement, createEmptyNote, createTable, formatDate, statusBadge
} from '../shared/js/ui.js';

// Fills the "My uploads" section with everything this person has contributed
export async function loadUploads(user, container, actions) {
    const { data, error } = await supabase
        .from('datasets')
        .select(`id, title, status, access_level, review_note, created_at, file_path,
                 preview_path, department_id, contributed_by, departments ( name )`)
        .eq('contributed_by', user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('Your uploads could not be loaded. Please refresh the page.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote('You have not contributed any datasets yet.'));
        return;
    }

    // Only add the actions column when at least one upload can be deleted
    const showActions = data.some(dataset => canDelete(user, dataset));
    const headers = ['Title', 'Department', 'Access', 'Status', 'Added'];
    if (showActions) headers.push('');

    const rows = data.map(dataset => {
        const cells = [
            createTitleCell(dataset),
            dataset.departments?.name,
            accessBadge(dataset.access_level),
            statusBadge(dataset.status),
            formatDate(dataset.created_at)
        ];
        if (showActions) {
            cells.push(canDelete(user, dataset) ? createDeleteButton(dataset, actions) : '');
        }
        return cells;
    });

    container.replaceChildren(createTable(headers, rows));
}

// The title links to the dataset page. A reviewer's note shows underneath.
function createTitleCell(dataset) {
    const cell = createElement('div');

    const link = createElement('a', '', dataset.title);
    link.href = `../dataset/dataset.html?id=${encodeURIComponent(dataset.id)}`;
    cell.append(link);

    if (dataset.review_note) {
        cell.append(createElement('div', 'table-note', `Reviewer's note: ${dataset.review_note}`));
    }
    return cell;
}