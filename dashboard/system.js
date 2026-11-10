import { supabase } from '../shared/js/supabase.js';
import { createEmptyNote, createElement, createTable, createTile } from '../shared/js/ui.js';

// The server returns at most this many rows per request, so the per dataset
// download count is built from the latest downloads up to this number
const DOWNLOAD_LIMIT = 1000;
const TOP_DATASETS = 15;

function count(table) {
    return supabase.from(table).select('id', { count: 'exact', head: true });
}

// The admin's numbers for the whole system, and how often each dataset was downloaded
export async function loadSystem(tiles, downloads) {
    const [users, departments, published, pending, total, log] = await Promise.all([
        count('profiles'),
        count('departments'),
        count('datasets').eq('status', 'published'),
        count('datasets').eq('status', 'pending'),
        count('audit_log').eq('action', 'dataset_downloaded'),
        supabase
            .from('audit_log')
            .select('dataset_id, dataset_title')
            .eq('action', 'dataset_downloaded')
            .order('created_at', { ascending: false })
            .limit(DOWNLOAD_LIMIT)
    ]);

    const failed = [users, departments, published, pending, total, log].find(result => result.error);

    if (failed) {
        console.error(failed.error);
        tiles.replaceChildren(createEmptyNote('The system numbers could not be loaded.'));
        downloads.replaceChildren();
        return;
    }

    tiles.replaceChildren(
        createTile('Users', users.count),
        createTile('Departments', departments.count),
        createTile('Published datasets', published.count),
        createTile('Pending review', pending.count),
        createTile('Downloads', total.count)
    );

    // Count by dataset id, so a renamed dataset stays one row
    const byDataset = new Map();
    log.data.forEach(row => {
        const key = row.dataset_id ?? row.dataset_title;
        const entry = byDataset.get(key) ?? { title: row.dataset_title, count: 0 };
        entry.count++;
        byDataset.set(key, entry);
    });

    if (byDataset.size === 0) {
        downloads.replaceChildren(createEmptyNote('Nothing has been downloaded yet.'));
        return;
    }

    const rows = [...byDataset.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_DATASETS)
        .map(entry => [entry.title ?? 'Deleted dataset', String(entry.count)]);

    downloads.replaceChildren(createTable(['Dataset', 'Downloads'], rows));

    if (total.count > DOWNLOAD_LIMIT) {
        downloads.append(createElement('p', 'panel-hint', `Counted from the latest ${DOWNLOAD_LIMIT} downloads.`));
    }
}