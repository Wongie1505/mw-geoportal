import { supabase } from '../shared/js/supabase.js';
import {
    createElement, createEmptyNote, createField, formatDate, showMessage
} from '../shared/js/ui.js';

const EMPTY_TEXT = 'No access requests are waiting.';

// Lists the pending requests for restricted data this person may decide on.
// A manager sees their department's datasets, an admin sees every department's.
export async function loadAccessQueue(user, container, onDecision) {
    const { data, error } = await supabase
        .from('access_requests')
        .select(`id, justification, contact_phone, created_at, requester_id, requester_name,
                 requester_email, datasets ( id, title, department_id, departments ( name ) )`)
        .eq('status', 'pending')
        .order('created_at');

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The access requests could not be loaded.'));
        return;
    }

    // People never decide on their own requests, and a manager only on their own department's
    const requests = data.filter(request =>
        request.requester_id !== user.id
        && (user.role === 'admin' || request.datasets?.department_id === user.departmentId)
    );

    if (requests.length === 0) {
        container.replaceChildren(createEmptyNote(EMPTY_TEXT));
        return;
    }

    container.replaceChildren(...requests.map(request =>
        createRequestCard(request, user, container, onDecision)
    ));
}

function createRequestCard(request, user, container, onDecision) {
    const card = createElement('article', 'review-card');

    const title = createElement('h3');
    const link = createElement('a', '', request.datasets?.title ?? 'Dataset');
    link.href = `../dataset/dataset.html?id=${encodeURIComponent(request.datasets?.id)}`;
    title.append(link);

    // Contact details the person gave. The phone number was checked by the database.
    const phone = createElement('a', '', request.contact_phone);
    phone.href = `tel:${request.contact_phone}`;

    const who = createElement('div', 'review-meta');
    who.append(`${request.requester_name}, ${request.requester_email}, `, phone);

    let when = `Requested on ${formatDate(request.created_at)}`;
    if (user.role === 'admin') when += `, for ${request.datasets?.departments?.name}`;

    const noteInput = createElement('textarea');
    noteInput.id = `request-note-${request.id}`;
    noteInput.rows = 2;
    noteInput.placeholder = 'Note to the requester (required to reject)';

    const approve = createElement('button', 'button', 'Approve');
    const reject = createElement('button', 'button button-outline', 'Reject');
    [approve, reject].forEach(button => { button.type = 'button'; });

    const actions = createElement('div', 'review-actions');
    actions.append(approve, reject);

    const feedback = createElement('div', 'message');

    // Sends the decision to the database, which checks the manager's rights
    async function decide(approved) {
        const note = noteInput.value.trim();

        if (!approved && !note) {
            showMessage(feedback, 'Add a note explaining why the request is rejected.');
            return;
        }
        if (!approved && !window.confirm('Reject this request?')) return;

        showMessage(feedback, '');
        [approve, reject].forEach(button => { button.disabled = true; });

        const { error } = await supabase.rpc('decide_access_request', {
            p_id: request.id,
            p_approve: approved,
            p_note: note || null
        });

        if (error) {
            showMessage(feedback, error.message);
            [approve, reject].forEach(button => { button.disabled = false; });
            return;
        }

        card.remove();
        if (container.children.length === 0) {
            container.replaceChildren(createEmptyNote(EMPTY_TEXT));
        }
        onDecision(`${request.requester_name}: access to ${request.datasets?.title} ${approved ? 'approved' : 'rejected'}.`);
    }

    approve.addEventListener('click', () => decide(true));
    reject.addEventListener('click', () => decide(false));

    card.append(
        title,
        who,
        createElement('div', 'review-meta', when),
        createElement('p', 'abstract', request.justification),
        createField('Note', noteInput),
        actions,
        feedback
    );
    return card;
}