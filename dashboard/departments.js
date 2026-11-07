import { supabase } from '../shared/js/supabase.js';
import { createEmptyNote, createTable } from '../shared/js/ui.js';

// The admin's view of every department: who manages it, how many people it
// has and where its datasets stand
export async function loadAllDepartments(container) {
    const [departments, staff, datasets] = await Promise.all([
        supabase.from('departments').select('id, name').order('name'),
        supabase.from('profiles').select('full_name, email, role, department_id').in('role', ['member', 'manager']),
        supabase.from('datasets').select('department_id, status')
    ]);

    const error = departments.error || staff.error || datasets.error;
    if (error) {
        console.error(error);
        container.replaceChildren(createEmptyNote('The departments could not be loaded.'));
        return;
    }

    const rows = departments.data.map(department => {
        const people = staff.data.filter(person => person.department_id === department.id);
        const managers = people
            .filter(person => person.role === 'manager')
            .map(person => person.full_name || person.email);

        const owned = datasets.data.filter(row => row.department_id === department.id);
        const count = status => owned.filter(row => row.status === status).length;

        return [
            department.name,
            managers.length ? managers.join(', ') : 'No manager yet',
            String(people.length),
            String(count('published')),
            String(count('pending')),
            String(count('changes_requested')),
            String(count('rejected'))
        ];
    });

    container.replaceChildren(createTable(
        ['Department', 'Managers', 'Members', 'Published', 'Pending', 'Sent back', 'Rejected'],
        rows
    ));
}