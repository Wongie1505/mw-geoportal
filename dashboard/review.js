import { supabase } from '../shared/js/supabase.js';
import {
    ACCESS_LABELS, accessBadge, createElement, createEmptyNote, formatDate, showMessage
} from '../shared/js/ui.js';

const EMPTY_TEXT = 'Nothing is waiting for review.';

// Lists the pending datasets this person may decide on. A manager sees their
// own department's, an admin sees every department's.
export async function loadReviewQueue(user, container, onDecision) {
    let query = supabase
        .from('datasets')
        .select('id, title, abstract, access_level, contributor_name, created_at, departments ( name )')
        .eq('status', 'pending')
        .order('created_at');

    if (user.role === 'manager') query = query.eq('department_id', user.departmentId);

    const { data, error } = await query;

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The review queue could not be loaded.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote(EMPTY_TEXT));
        return;
    }

    container.replaceChildren(...data.map(dataset =>
        createReviewCard(dataset, user, container, onDecision)
    ));
}

function createReviewCard(dataset, user, container, onDecision) {
    const card = createElement('article', 'review-card');

    const title = createElement('h3');
    const link = createElement('a', '', dataset.title);
    link.href = `../dataset/dataset.html?id=${encodeURIComponent(dataset.id)}`;
    title.append(link);

    // Admins see all departments, so say which one this is for
    let meta = `Contributed by ${dataset.contributor_name} on ${formatDate(dataset.created_at)}`;
    if (user.role === 'admin') meta += `, for ${dataset.departments?.name}`;

    const proposed = createElement('div', 'review-meta');
    proposed.append(`${meta}. Proposed access: `, accessBadge(dataset.access_level));

    // The manager makes the final call on access, starting from the proposal
    const accessSelect = createElement('select');
    accessSelect.id = `access-${dataset.id}`;
    Object.entries(ACCESS_LABELS).forEach(([value, label]) => {
        const option = createElement('option', '', label);
        option.value = value;
        option.selected = value === dataset.access_level;
        accessSelect.append(option);
    });

    const noteInput = createElement('textarea');
    noteInput.id = `note-${dataset.id}`;
    noteInput.rows = 2;
    noteInput.placeholder = 'Note to the contributor (required to reject or ask for changes)';

    const controls = createElement('div', 'review-controls');
    controls.append(
        createField('Final access level', accessSelect),
        createField('Note', noteInput)
    );

    const approve = createElement('button', 'button', 'Approve');
    const changes = createElement('button', 'button button-outline', 'Request changes');
    const reject = createElement('button', 'button button-outline', 'Reject');
    [approve, changes, reject].forEach(button => { button.type = 'button'; });

    const actions = createElement('div', 'review-actions');
    actions.append(approve, changes, reject);

    const feedback = createElement('div', 'message');

    // Sends the decision to the database, which checks the manager's rights
    async function decide(decision, doneText) {
        if (decision === 'reject' && !window.confirm('Reject this dataset?')) return;

        showMessage(feedback, '');
        [approve, changes, reject].forEach(button => { button.disabled = true; });

        const { error } = await supabase.rpc('review_dataset', {
            p_id: dataset.id,
            p_decision: decision,
            p_access_level: accessSelect.value,
            p_note: noteInput.value.trim() || null
        });

        if (error) {
            showMessage(feedback, error.message);
            [approve, changes, reject].forEach(button => { button.disabled = false; });
            return;
        }

        card.remove();
        if (container.children.length === 0) {
            container.replaceChildren(createEmptyNote(EMPTY_TEXT));
        }
        onDecision(`${dataset.title}: ${doneText}`);
    }

    approve.addEventListener('click', () => decide('approve', 'approved and published.'));
    changes.addEventListener('click', () => decide('request_changes', 'sent back for changes.'));
    reject.addEventListener('click', () => decide('reject', 'rejected.'));

    card.append(
        title,
        proposed,
        createElement('p', 'abstract', dataset.abstract),
        controls,
        actions,
        feedback
    );
    return card;
}

function createField(labelText, control) {
    const field = createElement('div', 'field');
    const label = createElement('label', '', labelText);
    label.htmlFor = control.id;
    field.append(label, control);
    return field;
}