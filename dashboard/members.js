import { supabase } from '../shared/js/supabase.js';
import { createElement, createEmptyNote, createTable, showMessage } from '../shared/js/ui.js';

// The people in the department, managers first. A manager sees their own
// department, an admin sees all of them. onChange gets a short text to show.
export async function loadMembers(user, container, onChange) {
    let query = supabase
        .from('profiles')
        .select('id, full_name, email, role, department_id, departments ( name )')
        .in('role', ['member', 'manager']);

    if (user.role === 'manager') query = query.eq('department_id', user.departmentId);

    const { data, error } = await query;

    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The members could not be loaded.'));
        return;
    }

    if (data.length === 0) {
        container.replaceChildren(createEmptyNote('There are no members yet.'));
        return;
    }

    const isAdmin = user.role === 'admin';
    const feedback = createElement('div', 'message');

    const headers = isAdmin
        ? ['Name', 'Email', 'Department', 'Role', '']
        : ['Name', 'Email', 'Role', ''];

    const rows = data.sort(compare).map(person => {
        const cells = [
            person.full_name || person.email,
            person.email,
            person.role === 'manager' ? 'Manager' : 'Member',
            createActions(user, person, feedback, onChange)
        ];
        if (isAdmin) cells.splice(2, 0, person.departments?.name ?? '');
        return cells;
    });

    container.replaceChildren(feedback, createTable(headers, rows));
}

// Department by name, then managers before members, then name
function compare(a, b) {
    const department = (a.departments?.name ?? '').localeCompare(b.departments?.name ?? '');
    if (department) return department;
    if (a.role !== b.role) return a.role === 'manager' ? -1 : 1;
    return (a.full_name || a.email).localeCompare(b.full_name || b.email);
}

// Decides which buttons to offer. This only decides what to show, the
// database makes the real decision when the action is sent.
function listActions(user, person) {
    const name = person.full_name || person.email;
    const isAdmin = user.role === 'admin';
    const actions = [];

    const remove = {
        label: 'Remove',
        danger: true,
        rpc: 'remove_from_department',
        args: { p_user: person.id },
        confirm: `Remove ${name} from the department?`,
        done: `${name} was removed.`
    };

    if (person.role === 'member') {
        actions.push({
            label: 'Make manager',
            rpc: 'set_staff_role',
            args: { p_user: person.id, p_role: 'manager' },
            confirm: `Make ${name} a manager of the department?`,
            done: `${name} is now a manager.`
        }, remove);
    } else if (isAdmin) {
        actions.push({
            label: 'Make member',
            rpc: 'set_staff_role',
            args: { p_user: person.id, p_role: 'member' },
            confirm: `Turn ${name} back into a member?`,
            done: `${name} is now a member.`
        }, remove);
    } else if (person.id === user.id) {
        actions.push({
            label: 'Step down',
            rpc: 'set_staff_role',
            args: { p_user: person.id, p_role: 'member' },
            confirm: 'Step down as manager? You will stay in the department as a member.',
            done: 'You stepped down as manager.'
        });
    }
    return actions;
}

function createActions(user, person, feedback, onChange) {
    const wrapper = createElement('div', 'member-actions');
    const buttons = [];

    listActions(user, person).forEach(action => {
        const style = action.danger ? 'button-danger' : 'button-outline';
        const button = createElement('button', `button ${style} button-small`, action.label);
        button.type = 'button';
        buttons.push(button);

        button.addEventListener('click', async () => {
            if (!window.confirm(action.confirm)) return;

            showMessage(feedback, '');
            buttons.forEach(item => { item.disabled = true; });

            const { error } = await supabase.rpc(action.rpc, action.args);

            if (error) {
                showMessage(feedback, error.message);
                buttons.forEach(item => { item.disabled = false; });
                return;
            }

            // The sections depend on the role, so a change to your own needs a fresh page
            if (person.id === user.id) {
                location.reload();
                return;
            }
            onChange(action.done);
        });
        wrapper.append(button);
    });
    return wrapper;
}

// The Leave department button in the dashboard header
export function setupLeaveButton(user, button, onError) {
    if (!['member', 'manager'].includes(user.role)) return;

    button.hidden = false;
    button.addEventListener('click', async () => {
        if (!window.confirm(`Leave the ${user.department} department? You will become a normal user again.`)) return;

        button.disabled = true;
        const { error } = await supabase.rpc('remove_from_department', { p_user: user.id });

        if (error) {
            onError(error.message);
            button.disabled = false;
            return;
        }
        location.reload();
    });
}