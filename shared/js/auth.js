import { supabase } from './supabase.js';

// Turns Supabase error text into something a person can act on
function friendlyError(error) {
    const text = error.message || '';

    if (text.includes('Invalid login credentials')) {
        return 'The email or password is incorrect.';
    }
    if (text.includes('Email not confirmed')) {
        return 'Confirm your email first. Check your inbox for the link.';
    }
    if (text.includes('rate limit')) {
        return 'Too many attempts. Please wait a few minutes and try again.';
    }
    if (text.includes('Password should be')) {
        return 'That password is too short. Choose a longer one.';
    }
    return 'Something went wrong. Please try again.';
}

// Keep the raw error in the console for debugging, show the friendly one
function fail(error) {
    console.error(error);
    throw new Error(friendlyError(error));
}

// Creates the account. The profile row is made by a database trigger,
// using the name passed in as metadata.
export async function signUp({ fullName, email, password }) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
    });

    if (error) fail(error);

    // No session yet means the project requires email confirmation first
    return { needsConfirmation: !data.session };
}

export async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) fail(error);
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) fail(error);
}

// Returns the signed-in person with their role and department, or null
export async function getCurrentUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('full_name, role, departments ( name )')
        .eq('id', session.user.id)
        .single();

    if (error) {
        console.error(error);
        return null;
    }

    return {
        id: session.user.id,
        email: session.user.email,
        fullName: profile.full_name,
        role: profile.role,
        department: profile.departments?.name ?? null
    };
}