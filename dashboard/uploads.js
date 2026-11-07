import { supabase } from '../shared/js/supabase.js';
import {
    accessBadge, createElement, createEmptyNote, createTable, formatDate, statusBadge
} from '../shared/js/ui.js';

// Fills the "My uploads" section with everything this person has contributed
export async function loadUploads(user, container) {
    const { data, error } = await supabase
        .from('datasets')
        .select('id, title, status, access_level, review_note, created_at, departments ( name )')
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

    const rows = data.map(dataset => [
        createTitleCell(dataset),
        dataset.departments?.name,
        accessBadge(dataset.access_level),
        statusBadge(dataset.status),
        formatDate(dataset.created_at)
    ]);

    container.replaceChildren(
        createTable(['Title', 'Department', 'Access', 'Status', 'Added'], rows)
    );
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