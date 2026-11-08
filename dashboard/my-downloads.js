import { supabase } from '../shared/js/supabase.js';
import { createEmptyNote, createTable, formatDateTime } from '../shared/js/ui.js';

const LIMIT = 50;

// The datasets this person has downloaded, newest first. The record comes
// from the audit log, where every download is written by the database.
export async function loadMyDownloads(user, container) {
    const { data, error } = await supabase
        .from('audit_log')
        .select('id, created_at, dataset_title')
        .eq('action', 'dataset_downloaded')
        .eq('actor_id', user.id)
        .order('created_at', { ascending: false })
        .limit(LIMIT);

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('Your downloads could not be loaded.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote('You have not downloaded any datasets while logged in.'));
        return;
    }

    const rows = data.map(entry => [
        entry.dataset_title ?? 'Deleted dataset',
        formatDateTime(entry.created_at)
    ]);

    container.replaceChildren(createTable(['Dataset', 'Downloaded'], rows));
}