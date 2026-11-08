import { supabase } from '../shared/js/supabase.js';
import { createElement, createField, formatDate, showMessage } from '../shared/js/ui.js';

// Turns what a person typed into +265999123456 style, or returns null if it
// does not look like a phone number. A leading 0 means a Malawi number.
export function normalizePhone(text) {
    let phone = text.replace(/[\s\-().]/g, '');

    if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
    else if (phone.startsWith('0')) phone = `+265${phone.slice(1)}`;
    else if (phone.startsWith('265')) phone = `+${phone}`;

    return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}

// Shows the access request panel under the map of a restricted dataset the
// person cannot open yet: the form, or the state of the request they sent.
export async function showAccessPanel(container, dataset, user) {
    container.hidden = false;

    const { data, error } = await supabase
        .from('access_requests')
        .select('id, status, decision_note, created_at')
        .eq('dataset_id', dataset.id)
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error(error);
        container.replaceChildren(createElement('p', '', 'Your access request could not be loaded.'));
        return;
    }

    const latest = data[0];

    if (latest?.status === 'pending') {
        await showPending(container, dataset, latest);
    } else if (latest?.status === 'approved') {
        container.replaceChildren(
            createElement('p', '', 'Your request was approved. Reload the page to open the dataset.')
        );
    } else {
        showForm(container, dataset, user, latest);
    }
}

async function showPending(container, dataset, request) {
    const department = dataset.departments?.name ?? 'owning';

    const nodes = [
        createElement('h2', '', 'Access requested'),
        createElement('p', '', `Your request was sent on ${formatDate(request.created_at)}. The ${department} department will decide on it.`)
    ];

    // Who to contact if the decision takes long
    const { data: contacts, error } = await supabase
        .rpc('department_contacts', { p_department: dataset.department_id });

    if (error) console.error(error);

    if (contacts?.length) {
        nodes.push(createElement('p', 'field-hint', 'If it takes long, contact the department:'));

        const list = createElement('ul', 'contact-list');
        contacts.forEach(contact => {
            const item = createElement('li');
            const link = createElement('a', '', contact.email);
            link.href = `mailto:${contact.email}`;
            item.append(`${contact.full_name || 'Manager'}, `, link);
            list.append(item);
        });
        nodes.push(list);
    }

    container.replaceChildren(...nodes);
}

function showForm(container, dataset, user, lastRequest) {
    const nodes = [createElement('h2', '', 'Request access')];

    if (lastRequest?.status === 'rejected') {
        const reason = lastRequest.decision_note ? `: ${lastRequest.decision_note}` : '.';
        nodes.push(createElement('p', 'notice', `Your last request was rejected${reason} You can send a new one.`));
    }

    nodes.push(createElement(
        'p', 'field-hint',
        'Tell the department why you need this data. A manager will review your request.'
    ));

    const feedback = createElement('div', 'message');
    feedback.setAttribute('role', 'alert');

    const justification = createElement('textarea');
    justification.id = 'justification';
    justification.rows = 4;
    justification.required = true;

    const phone = createElement('input');
    phone.id = 'contact-phone';
    phone.type = 'tel';
    phone.required = true;
    phone.placeholder = '0999123456';

    const submit = createElement('button', 'button', 'Send request');
    submit.type = 'submit';

    const form = createElement('form');
    form.append(
        createField('Why do you need this data?', justification),
        createField('Phone number', phone),
        createElement('p', 'field-hint', 'The department uses this number to reach you. It is shared with the department and kept permanently in an access log.'),
        submit
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();
        showMessage(feedback, '');

        const reason = justification.value.trim();
        const number = normalizePhone(phone.value);

        if (reason.length < 20) {
            showMessage(feedback, 'Explain in at least 20 characters why you need this data.');
            return;
        }
        if (!number) {
            showMessage(feedback, 'Enter a phone number like 0999123456 or +265999123456.');
            return;
        }

        submit.disabled = true;
        const { error } = await supabase
            .from('access_requests')
            .insert({ dataset_id: dataset.id, justification: reason, contact_phone: number });

        if (error) {
            console.error(error);
            showMessage(feedback, error.code === '23505'
                ? 'You already have a request waiting for this dataset.'
                : `Your request could not be sent: ${error.message}`);
            submit.disabled = false;
            return;
        }

        await showAccessPanel(container, dataset, user);
    });

    container.replaceChildren(...nodes, feedback, form);
}