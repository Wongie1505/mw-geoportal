import { supabase } from './supabase.js';
import { createElement } from './ui.js';

// Whether the Delete button should be offered. This only decides what to show.
// The database makes the real decision when the delete is sent.
// Only admins, and managers for their own department, delete datasets. The
// database enforces the same rule, this only decides whether to show the button.
export function canDelete(user, dataset) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.role === 'manager' && user.departmentId === dataset.department_id;
}

// Deletes the files, then the dataset row. The files go first because the
// storage rules look the row up to decide who may delete. A raster has a
// preview picture beside its data file, and both are removed. If a file is
// already gone, removing it simply does nothing and the row is still cleared.
// Whatever page calls this has to load preview_path along with file_path.
export async function deleteDataset(dataset) {
    const paths = [dataset.file_path, dataset.preview_path].filter(Boolean);

    if (paths.length) {
        // Storage only removes files that this person is allowed to read, and
        // files that are not open data need a ticket from the database for that.
        // Without one the removal does nothing, without any error.
        const { error: ticketError } = await supabase.rpc('open_dataset_file', {
            p_dataset: dataset.id,
            p_purpose: 'view'
        });
        if (ticketError) console.error(ticketError);

        const { error } = await supabase.storage.from('datasets').remove(paths);
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