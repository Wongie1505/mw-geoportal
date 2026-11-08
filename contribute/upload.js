import { supabase } from '../shared/js/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../shared/js/config.js';

// Sends the file to the datasets bucket and reports progress as a number from 0 to 1.
// The direct request below can report how many bytes have been sent. If the
// server refuses it for any reason, the standard upload is used instead,
// which works but cannot report progress.
export async function uploadFile(path, blob, onProgress) {
    try {
        await sendWithProgress(path, blob, onProgress);
    } catch (error) {
        console.error('Direct upload failed, using the standard upload.', error);

        const { error: fallbackError } = await supabase.storage
            .from('datasets')
            .upload(path, blob, { contentType: blob.type });

        if (fallbackError) throw fallbackError;
        onProgress(1);
    }
}

// Same request the Supabase library makes, sent by hand so progress events are available
async function sendWithProgress(path, blob, onProgress) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('You are not logged in.');

    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', `${SUPABASE_URL}/storage/v1/object/datasets/${path}`);
        request.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        request.setRequestHeader('apikey', SUPABASE_KEY);
        request.setRequestHeader('x-upsert', 'false');

        request.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };

        request.onload = () => {
            if (request.status >= 200 && request.status < 300) {
                resolve();
            } else {
                reject(new Error(`The server answered ${request.status}: ${request.responseText}`));
            }
        };
        request.onerror = () => reject(new Error('The connection failed.'));

        const body = new FormData();
        body.append('cacheControl', '3600');
        body.append('', blob);
        request.send(body);
    });
}