import { SUPABASE_URL, SUPABASE_KEY } from '../shared/js/config.js';

const results = document.getElementById('results');

// Adds a line to the list and returns it so the result can be filled in later
function addResult(label) {
    const item = document.createElement('li');
    item.className = 'pending';
    item.textContent = label;
    results.appendChild(item);
    return item;
}

function setResult(item, ok, message) {
    item.className = ok ? 'ok' : 'error';
    item.textContent = message;
}

async function run() {
    // Step 1: the settings file must be filled in
    const configCheck = addResult('Checking config...');
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        setResult(configCheck, false, 'Config missing. Fill in shared/js/config.js');
        return;
    }
    setResult(configCheck, true, 'Config found');

    // Step 2: ask the auth service if it is up and accepts the key
    const reachCheck = addResult('Reaching Supabase...');
    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
            headers: { apikey: SUPABASE_KEY }
        });
        const message = response.ok
            ? 'Supabase reachable, key accepted'
            : `Supabase answered with status ${response.status}`;
        setResult(reachCheck, response.ok, message);
    } catch (error) {
        setResult(reachCheck, false, 'Could not reach Supabase. Check the project URL.');
        return;
    }

    // Step 3: load the shared client the rest of the site will use.
    // Imported here so a missing config cannot break the checks above.
    const clientCheck = addResult('Loading client...');
    try {
        const { supabase } = await import('../shared/js/supabase.js');
        const { error } = await supabase.auth.getSession();
        setResult(clientCheck, !error, error ? error.message : 'Client ready');
    } catch (error) {
        setResult(clientCheck, false, `Client failed to load: ${error.message}`);
    }
}

run();