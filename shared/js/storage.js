import { supabase } from './supabase.js';

// Returns a temporary link to a dataset file, or null when the database
// refuses access or the file is missing. The link stops working after the
// given number of seconds. Pass downloadName to make the browser save the
// file under that name instead of opening it.
export async function getSignedUrl(path, seconds = 120, downloadName) {
    const { data, error } = await supabase.storage
        .from('datasets')
        .createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined);

    if (error) {
        console.error(error);
        return null;
    }
    return data.signedUrl;
}

// Gets a link to a dataset's file for viewing or downloading.
// Open public data needs nothing special. For anything else, and for every
// download by a signed-in person, the request goes through the database
// first, which checks the person's rights and records it. Storage will not
// release a restricted file without that step.
// purpose is 'view' or 'download'. Returns null when access is refused.
export async function getFileUrl(dataset, purpose = 'view', downloadName) {
    const { data: { session } } = await supabase.auth.getSession();
    const isOpen = dataset.status === 'published' && dataset.access_level === 'public';

    if (!isOpen && !session) return null;

    if (session && (!isOpen || purpose === 'download')) {
        const { error } = await supabase.rpc('open_dataset_file', {
            p_dataset: dataset.id,
            p_purpose: purpose
        });

        if (error) {
            console.error(error);
            if (!isOpen) return null;
        }
    }

    return getSignedUrl(dataset.file_path, 120, downloadName);
}