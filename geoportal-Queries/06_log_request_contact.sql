-- Records who asked for access, and how to reach them, in the audit log.
-- Run after file 05. Safe to run more than once.
--
-- The audit log is append-only and kept even if the request or the dataset is
-- later deleted, so this is the permanent record of every access request.

create or replace function public.audit_access_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.log_event('access_requested', new.dataset_id, jsonb_build_object(
            'request_id',      new.id,
            'requester_id',    new.requester_id,
            'requester_name',  new.requester_name,
            'requester_email', new.requester_email,
            'contact_phone',   new.contact_phone,
            'justification',   new.justification
        ));
    elsif new.status is distinct from old.status then
        -- Decisions name the person but do not repeat the phone number
        perform public.log_event('access_' || new.status::text, new.dataset_id, jsonb_build_object(
            'request_id',      new.id,
            'requester_id',    new.requester_id,
            'requester_name',  new.requester_name,
            'requester_email', new.requester_email,
            'note',            new.decision_note
        ));
    end if;
    return null;
end;
$$;
