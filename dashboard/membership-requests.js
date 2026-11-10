import { supabase } from '../shared/js/supabase.js';
import {
    createElement, createEmptyNote, createField, formatDate, showMessage
} from '../shared/js/ui.js';

const EMPTY_TEXT = 'No membership requests are waiting.';

// Pending requests to join a department. The database only returns the
// manager's own department, and every department for an admin.
export async function loadMembershipRequests(user, container, onDecision) {
    const { data, error } = await supabase
        .from('membership_requests')
        .select('id, message, created_at, requester_name, requester_email, departments ( name )')
        .eq('status', 'pending')
        .order('created_at');

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The membership requests could not be loaded.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote(EMPTY_TEXT));
        return;
    }

    container.replaceChildren(...data.map(request =>
        createRequestCard(request, user, container, onDecision)
    ));
}

function createRequestCard(request, user, container, onDecision) {
    const card = createElement('article', 'review-card');

    const email = createElement('a', '', request.requester_email);
    email.href = `mailto:${request.requester_email}`;

    const who = createElement('div', 'review-meta');
    who.append(email);

    let when = `Requested on ${formatDate(request.created_at)}`;
    if (user.role === 'admin') when += `, to join ${request.departments?.name}`;

    const noteInput = createElement('textarea');
    noteInput.id = `membership-note-${request.id}`;
    noteInput.rows = 2;
    noteInput.placeholder = 'Note to the requester (required to reject)';

    const approve = createElement('button', 'button', 'Approve');
    const reject = createElement('button', 'button button-outline', 'Reject');
    [approve, reject].forEach(button => { button.type = 'button'; });

    const actions = createElement('div', 'review-actions');
    actions.append(approve, reject);

    const feedback = createElement('div', 'message');

    // The database checks that this person may decide on the request
    async function decide(approved) {
        const note = noteInput.value.trim();

        if (!approved && !note) {
            showMessage(feedback, 'Add a note explaining why the request is rejected.');
            return;
        }
        if (!approved && !window.confirm('Reject this request?')) return;

        showMessage(feedback, '');
        [approve, reject].forEach(button => { button.disabled = true; });

        const { error } = await supabase.rpc('decide_membership_request', {
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
        onDecision(`${request.requester_name}: request ${approved ? 'approved' : 'rejected'}.`);
    }

    approve.addEventListener('click', () => decide(true));
    reject.addEventListener('click', () => decide(false));

    card.append(
        createElement('h3', '', request.requester_name),
        who,
        createElement('div', 'review-meta', when),
        createElement('p', 'abstract', request.message),
        createField('Note', noteInput),
        actions,
        feedback
    );
    return card;
}