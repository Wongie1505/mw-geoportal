import { supabase } from '../shared/js/supabase.js';
import {
    createElement, createEmptyNote, createTable, formatDate, statusBadge
} from '../shared/js/ui.js';

// Every request for restricted data this person has made, and what became of it
export async function loadMyRequests(user, container) {
    const { data, error } = await supabase
        .from('access_requests')
        .select('id, status, decision_note, created_at, decided_at, datasets ( id, title, departments ( name ) )')
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('Your access requests could not be loaded.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote('You have not asked for access to any restricted dataset.'));
        return;
    }

    const rows = data.map(request => {
        // The dataset may have been removed or hidden since the request
        let title = 'Dataset no longer available';
        if (request.datasets) {
            title = createElement('a', '', request.datasets.title);
            title.href = `../dataset/dataset.html?id=${encodeURIComponent(request.datasets.id)}`;
        }

        return [
            title,
            request.datasets?.departments?.name,
            statusBadge(request.status),
            formatDate(request.created_at),
            formatDate(request.decided_at),
            request.decision_note ?? ''
        ];
    });

    container.replaceChildren(
        createTable(['Dataset', 'Department', 'Status', 'Requested', 'Decided', 'Note'], rows)
    );
}