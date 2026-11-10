-- Phase 1, file 2 of 4: audit logging and the actions people take on datasets.
-- Status changes only happen through the functions below, never by editing
-- the status column directly.

-- Writes one row to the audit log. Not callable from the browser.
create function public.log_event(
    p_action     text,
    p_dataset_id uuid  default null,
    p_details    jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile public.profiles;
begin
    select * into v_profile from public.profiles where id = auth.uid();

    insert into public.audit_log (
        actor_id, actor_email, actor_department, action,
        dataset_id, dataset_title, details
    )
    values (
        auth.uid(),
        v_profile.email,
        (select name from public.departments where id = v_profile.department_id),
        p_action,
        p_dataset_id,
        (select title from public.datasets where id = p_dataset_id),
        p_details
    );
end;
$$;


-- Log dataset creation, status changes and deletion
create function public.audit_dataset_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.log_event('dataset_created', new.id);
    elsif tg_op = 'DELETE' then
        perform public.log_event('dataset_deleted', old.id,
            jsonb_build_object('title', old.title));
    elsif new.status is distinct from old.status then
        perform public.log_event('dataset_' || new.status::text, new.id,
            jsonb_build_object('from', old.status, 'to', new.status, 'note', new.review_note));
    end if;
    return null;
end;
$$;

create trigger datasets_audit
    after insert or delete or update of status on public.datasets
    for each row execute function public.audit_dataset_change();


-- Log access requests and the decisions on them
create function public.audit_access_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.log_event('access_requested', new.dataset_id);
    elsif new.status is distinct from old.status then
        perform public.log_event('access_' || new.status::text, new.dataset_id,
            jsonb_build_object('requester_id', new.requester_id, 'note', new.decision_note));
    end if;
    return null;
end;
$$;

create trigger access_requests_audit
    after insert or update of status on public.access_requests
    for each row execute function public.audit_access_request();


-- Log role and department changes
create function public.audit_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.role is distinct from old.role
       or new.department_id is distinct from old.department_id then
        perform public.log_event('role_changed', null, jsonb_build_object(
            'user_id',  new.id,
            'email',    new.email,
            'old_role', old.role,
            'new_role', new.role
        ));
    end if;
    return null;
end;
$$;

create trigger profiles_audit
    after update of role, department_id on public.profiles
    for each row execute function public.audit_profile_change();


-- Contributor sends a finished dataset in.
-- Members and managers of the owning department publish straight away,
-- everyone else goes to the department's review queue.
create function public.submit_dataset(p_id uuid)
returns public.dataset_status
language plpgsql
security definer
set search_path = public
as $$
declare
    d        public.datasets;
    v_status public.dataset_status;
begin
    select * into d from public.datasets where id = p_id;

    if not found or d.contributed_by is distinct from auth.uid() then
        raise exception 'Dataset not found';
    end if;

    if d.status not in ('draft', 'changes_requested') then
        raise exception 'This dataset has already been submitted';
    end if;

    if d.file_path is null or d.file_format is null or d.extent is null then
        raise exception 'Upload the file and complete the metadata before submitting';
    end if;

    if not exists (
        select 1 from storage.objects
        where bucket_id = 'datasets' and name = d.file_path
    ) then
        raise exception 'The data file has not finished uploading';
    end if;

    if public.auth_role() in ('member', 'manager')
       and public.auth_department() = d.department_id then
        v_status := 'published';
    else
        v_status := 'pending';
    end if;

    update public.datasets
    set status       = v_status,
        published_at = case when v_status = 'published' then now() end
    where id = p_id;

    return v_status;
end;
$$;


-- Manager decision on a pending dataset: approve, reject or request_changes.
-- On approval the manager can set the final access level.
create function public.review_dataset(
    p_id           uuid,
    p_decision     text,
    p_access_level public.access_level default null,
    p_note         text default null
)
returns public.dataset_status
language plpgsql
security definer
set search_path = public
as $$
declare
    d        public.datasets;
    v_status public.dataset_status;
begin
    select * into d from public.datasets where id = p_id;

    if not found then
        raise exception 'Dataset not found';
    end if;

    if not public.manages_dataset(p_id) then
        raise exception 'Only a manager of the owning department can review this dataset';
    end if;

    if d.status <> 'pending' then
        raise exception 'Only pending datasets can be reviewed';
    end if;

    if p_decision = 'approve' then
        v_status := 'published';
    elsif p_decision = 'reject' then
        v_status := 'rejected';
    elsif p_decision = 'request_changes' then
        v_status := 'changes_requested';
    else
        raise exception 'Unknown decision: %', p_decision;
    end if;

    if p_decision <> 'approve' and coalesce(btrim(p_note), '') = '' then
        raise exception 'Add a note explaining the decision';
    end if;

    update public.datasets
    set status       = v_status,
        access_level = case when p_decision = 'approve'
                            then coalesce(p_access_level, access_level)
                            else access_level end,
        reviewed_by  = auth.uid(),
        review_note  = p_note,
        published_at = case when p_decision = 'approve' then now() else published_at end
    where id = p_id;

    return v_status;
end;
$$;


-- Manager decision on a request for restricted data
create function public.decide_access_request(
    p_id      uuid,
    p_approve boolean,
    p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.access_requests;
begin
    select * into r from public.access_requests where id = p_id;

    if not found then
        raise exception 'Request not found';
    end if;

    if not public.manages_dataset(r.dataset_id) then
        raise exception 'Only a manager of the owning department can decide this request';
    end if;

    if r.status <> 'pending' then
        raise exception 'This request has already been decided';
    end if;

    update public.access_requests
    set status        = (case when p_approve then 'approved' else 'rejected' end)::public.request_status,
        decided_by    = auth.uid(),
        decision_note = p_note,
        decided_at    = now()
    where id = p_id;
end;
$$;
