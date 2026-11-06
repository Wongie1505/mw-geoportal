import { supabase } from './supabase.js';

// Returns a temporary link to a dataset file, or null when the database
// refuses access or the file is missing. The link stops working after
// the given number of seconds.
export async function getSignedUrl(path, seconds = 120) {
    const { data, error } = await supabase.storage
        .from('datasets')
        .createSignedUrl(path, seconds);

    if (error) {
        console.error(error);
        return null;
    }
    return data.signedUrl;
}