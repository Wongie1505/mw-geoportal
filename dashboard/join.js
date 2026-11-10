import { supabase } from '../shared/js/supabase.js';
import { SUPPORT_EMAIL } from '../shared/js/site.js';
import {
    createElement, createEmptyNote, createField, formatDate, showMessage
} from '../shared/js/ui.js';

// What a plain user sees about joining a department: the request form, the
// request that is waiting, or the reason the last one was rejected
export async function loadJoin(container) {
    const { data, error } = await supabase
        .from('membership_requests')
        .select('id, department_id, message, status, decision_note, created_at, departments ( name )')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('Your membership request could not be loaded.'));
        return;
    }

    const last = data[0];

    if (last?.status === 'pending') {
        await showPending(container, last);
    } else {
        await showForm(container, last);
    }
}

async function showPending(container, request) {
    const department = request.departments?.name ?? 'the department';

    const nodes = [
        createElement('p', 'notice', `Your request to join ${department} was sent on ${formatDate(request.created_at)}. A manager of the department will decide on it.`),
        createElement('p', 'review-meta', `Your message: ${request.message}`)
    ];

    // Who to contact if the decision takes long
    const { data: contacts, error } = await supabase
        .rpc('department_contacts', { p_department: request.department_id });

    if (error) console.error(error);

    const list = createElement('ul', 'contact-list');

    (contacts ?? []).forEach(contact => {
        list.append(createContactItem(`${contact.full_name || 'Manager'}, `, contact.email));
    });
    if (SUPPORT_EMAIL) {
        list.append(createContactItem('System admin, ', SUPPORT_EMAIL));
    }

    if (list.children.length) {
        nodes.push(createElement('p', 'field-hint', 'If it takes long, contact:'), list);
    }

    const cancel = createElement('button', 'button button-outline', 'Cancel request');
    cancel.type = 'button';

    const feedback = createElement('div', 'message');

    cancel.addEventListener('click', async () => {
        if (!window.confirm('Cancel this request?')) return;

        cancel.disabled = true;
        const { data, error } = await supabase
            .from('membership_requests')
            .delete()
            .eq('id', request.id)
            .select('id');

        if (error || data.length === 0) {
            console.error(error);
            showMessage(feedback, error?.message ?? 'The request could not be cancelled.');
            cancel.disabled = false;
            return;
        }
        loadJoin(container);
    });

    const actions = createElement('div', 'review-actions');
    actions.append(cancel);

    container.replaceChildren(...nodes, actions, feedback);
}

function createContactItem(prefix, email) {
    const item = createElement('li');
    const link = createElement('a', '', email);
    link.href = `mailto:${email}`;
    item.append(prefix, link);
    return item;
}

async function showForm(container, last) {
    const { data: departments, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The departments could not be loaded.'));
        return;
    }

    const nodes = [];

    if (last?.status === 'rejected') {
        const reason = last.decision_note ? `: ${last.decision_note}` : '.';
        nodes.push(createElement('p', 'notice', `Your last request was rejected${reason} You can send a new one.`));
    }

    const select = createElement('select');
    select.id = 'join-department';

    const placeholder = createElement('option', '', 'Choose a department');
    placeholder.value = '';
    select.append(placeholder);

    departments.forEach(department => {
        const option = createElement('option', '', department.name);
        option.value = department.id;
        select.append(option);
    });

    const message = createElement('textarea');
    message.id = 'join-message';
    message.rows = 3;
    message.placeholder = 'Who you are and why you should be part of this department';

    const submit = createElement('button', 'button', 'Send request');
    submit.type = 'button';

    const feedback = createElement('div', 'message');

    submit.addEventListener('click', async () => {
        const text = message.value.trim();

        if (!select.value) {
            showMessage(feedback, 'Choose a department.');
            return;
        }
        if (text.length < 10) {
            showMessage(feedback, 'Write at least 10 characters in the message.');
            return;
        }

        showMessage(feedback, '');
        submit.disabled = true;

        const { error } = await supabase
            .from('membership_requests')
            .insert({ department_id: select.value, message: text });

        if (error) {
            console.error(error);
            // 23505 is the database saying one request is already open
            showMessage(feedback, error.code === '23505'
                ? 'You already have a request waiting.'
                : error.message);
            submit.disabled = false;
            return;
        }
        loadJoin(container);
    });

    const actions = createElement('div', 'review-actions');
    actions.append(submit);

    nodes.push(
        createField('Department', select),
        createField('Message', message),
        actions,
        feedback
    );
    container.replaceChildren(...nodes);
}