import { supabase } from '../shared/js/supabase.js';

function pending(table) {
    return supabase.from(table).select('id', { count: 'exact', head: true }).eq('status', 'pending');
}

// How many items are waiting in each queue this person decides on, shown as
// numbers in the menu. The keys are the ids of the menu views.
export async function loadPendingCounts(user) {
    let review = pending('datasets');
    if (user.role === 'manager') review = review.eq('department_id', user.departmentId);

    const [reviews, membership, access] = await Promise.all([
        review,
        pending('membership_requests'),
        supabase
            .from('access_requests')
            .select('requester_id, datasets ( department_id )')
            .eq('status', 'pending')
    ]);

    [reviews, membership, access].forEach(result => {
        if (result.error) console.error(result.error);
    });

    // The same rule as the access queue: not your own request, and a manager
    // only decides on their own department's data
    const decidable = (access.data ?? []).filter(request =>
        request.requester_id !== user.id
        && (user.role === 'admin' || request.datasets?.department_id === user.departmentId)
    );

    return {
        review: reviews.count ?? 0,
        membership: membership.count ?? 0,
        access: decidable.length
    };
}