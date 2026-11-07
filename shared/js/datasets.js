import { supabase } from './supabase.js';
import { createElement } from './ui.js';

// Whether the Delete button should be offered. This only decides what to show.
// The database makes the real decision when the delete is sent.
export function canDelete(user, dataset) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'manager' && user.departmentId === dataset.department_id) return true;

    // Contributors can remove their own dataset until it has been submitted
    return dataset.contributed_by === user.id
        && ['draft', 'changes_requested'].includes(dataset.status);
}

// Deletes the file, then the dataset row. The file goes first because the
// storage rules look the row up to decide who may delete. If the file is
// already gone, removing it simply does nothing and the row is still cleared.
export async function deleteDataset(dataset) {
    if (dataset.file_path) {
        const { error } = await supabase.storage.from('datasets').remove([dataset.file_path]);
        if (error) console.error(error);
    }

    const { data, error } = await supabase
        .from('datasets')
        .delete()
        .eq('id', dataset.id)
        .select('id');

    if (error) throw new Error(error.message);
    if (data.length === 0) throw new Error('You are not allowed to delete this dataset.');
}

// A Delete button that asks first. onDeleted and onError tell the page what happened.
export function createDeleteButton(dataset, { onDeleted, onError }) {
    const button = createElement('button', 'button button-danger button-small', 'Delete');
    button.type = 'button';

    button.addEventListener('click', async () => {
        if (!window.confirm(`Delete "${dataset.title}"? This cannot be undone.`)) return;

        button.disabled = true;
        try {
            await deleteDataset(dataset);
            onDeleted(dataset.title);
        } catch (error) {
            console.error(error);
            onError(error.message);
            button.disabled = false;
        }
    });
    return button;
}