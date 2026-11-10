import { supabase } from '../shared/js/supabase.js';
import { createElement, createField, showMessage } from '../shared/js/ui.js';

// "Water Affairs" becomes "water-affairs"
function makeSlug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The admin's form for a new department. onAdded gets a short text to show.
export function setupDepartmentForm(container, onAdded) {
    const name = createElement('input');
    name.id = 'department-name';
    name.type = 'text';
    name.maxLength = 80;
    name.placeholder = 'For example, Water Affairs';

    const description = createElement('input');
    description.id = 'department-description';
    description.type = 'text';
    description.placeholder = 'What the department is responsible for (optional)';

    const add = createElement('button', 'button', 'Add department');
    add.type = 'button';

    const actions = createElement('div', 'review-actions');
    actions.append(add);

    const feedback = createElement('div', 'message');

    add.addEventListener('click', async () => {
        const text = name.value.trim();
        const slug = makeSlug(text);

        if (text.length < 3 || !slug) {
            showMessage(feedback, 'Enter a department name of at least 3 letters.');
            return;
        }

        showMessage(feedback, '');
        add.disabled = true;

        const { error } = await supabase.from('departments').insert({
            name: text,
            slug,
            description: description.value.trim() || null
        });

        add.disabled = false;

        if (error) {
            console.error(error);
            // 23505 is the database saying the name or slug is already taken
            showMessage(feedback, error.code === '23505'
                ? 'A department with that name already exists.'
                : error.message);
            return;
        }

        name.value = '';
        description.value = '';
        onAdded(`${text} was added.`);
    });

    container.append(
        createElement('h3', 'subheading', 'Add a department'),
        createField('Name', name),
        createField('Description', description),
        actions,
        feedback
    );
}