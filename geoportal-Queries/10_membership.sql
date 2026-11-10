-- Department membership: requests to join, decisions, and managing who is in
-- a department. Run after file 09. Safe to run more than once.
--
-- Rules the database enforces:
--   * only a plain user can ask to join, and only one request can be open at a time
--   * a manager of the department, or an admin, decides on a request
--   * managers can appoint other managers from their own members
--   * only an admin can demote or remove another manager
--   * a department can never be left without a manager


create table if not exists public.membership_requests (
    id              uuid primary key default gen_random_uuid(),
    requester_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
    department_id   uuid not null references public.departments (id),
    message         text not null,
    status          public.request_status not null default 'pending',
    requester_name  text,
    requester_email text,
    decided_by      uuid references public.profiles (id),
    decision_note   text,
    created_at      timestamptz not null default now(),
    decided_at      timestamptz,

    constraint membership_requests_message_length check (length(btrim(message)) >= 10)
);

-- A person can have only one open request at a time
create unique index if not exists membership_requests_one_open
    on public.membership_requests (requester_id)
    where status = 'pending';

-- Managers cannot read the profile of someone outside their department,
-- so the name and email are copied onto the request when it is made
create or replace function public.set_membership_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    select coalesce(full_name, email), email
    into new.requester_name, new.requester_email
    from public.profiles
    where id = new.requester_id;

    return new;
end;
$$;

drop trigger if exists membership_requests_defaults on public.membership_requests;
create trigger membership_requests_defaults
    before insert on public.membership_requests
    for each row execute function public.set_membership_defaults();


-- Record requests and decisions in the audit log
create or replace function public.audit_membership_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_department text;
begin
    select name into v_department from public.departments where id = new.department_id;

    if tg_op = 'INSERT' then
        perform public.log_event('membership_requested', null, jsonb_build_object(
            'request_id',      new.id,
            'department',      v_department,
            'requester_id',    new.requester_id,
            'requester_name',  new.requester_name,
            'requester_email', new.requester_email,
            'message',         new.message
        ));
    elsif new.status is distinct from old.status then
        perform public.log_event('membership_' || new.status::text, null, jsonb_build_object(
            'request_id',      new.id,
            'department',      v_department,
            'requester_id',    new.requester_id,
            'requester_name',  new.requester_name,
            'requester_email', new.requester_email,
            'note',            new.decision_note
        ));
    end if;
    return null;
end;
$$;

drop trigger if exists membership_requests_audit on public.membership_requests;
create trigger membership_requests_audit
    after insert or update of status on public.membership_requests
    for each row execute function public.audit_membership_request();


alter table public.membership_requests enable row level security;

revoke all on public.membership_requests from anon, authenticated;
grant select on public.membership_requests to authenticated;
grant insert (department_id, message) on public.membership_requests to authenticated;
grant delete on public.membership_requests to authenticated;

drop policy if exists "requesters read their own membership requests" on public.membership_requests;
create policy "requesters read their own membership requests"
    on public.membership_requests for select
    to authenticated
    using (requester_id = auth.uid());

drop policy if exists "managers read requests for their department" on public.membership_requests;
create policy "managers read requests for their department"
    on public.membership_requests for select
    to authenticated
    using (public.auth_role() = 'manager' and department_id = public.auth_department());

drop policy if exists "admins read all membership requests" on public.membership_requests;
create policy "admins read all membership requests"
    on public.membership_requests for select
    to authenticated
    using (public.auth_role() = 'admin');

-- Only a plain user can ask to join a department
drop policy if exists "users can ask to join a department" on public.membership_requests;
create policy "users can ask to join a department"
    on public.membership_requests for insert
    to authenticated
    with check (requester_id = auth.uid()
                and status = 'pending'
                and public.auth_role() = 'user');

drop policy if exists "requesters can withdraw an open request" on public.membership_requests;
create policy "requesters can withdraw an open request"
    on public.membership_requests for delete
    to authenticated
    using (requester_id = auth.uid() and status = 'pending');


-- A manager of the department, or an admin, approves or rejects a request.
-- Approving makes the person a member of the department.
create or replace function public.decide_membership_request(
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
    r public.membership_requests;
begin
    select * into r from public.membership_requests where id = p_id;

    if not found then
        raise exception 'Request not found';
    end if;

    if not (public.auth_role() = 'admin'
            or (public.auth_role() = 'manager' and public.auth_department() = r.department_id)) then
        raise exception 'Only a manager of this department or an admin can decide this request';
    end if;

    if r.requester_id = auth.uid() then
        raise exception 'You cannot decide on your own request';
    end if;

    if r.status <> 'pending' then
        raise exception 'This request has already been decided';
    end if;

    if p_approve then
        -- The person may have joined somewhere else since asking
        if not exists (select 1 from public.profiles where id = r.requester_id and role = 'user') then
            raise exception 'This person already belongs to a department';
        end if;

        update public.profiles
        set role = 'member', department_id = r.department_id
        where id = r.requester_id;
    end if;

    update public.membership_requests
    set status        = (case when p_approve then 'approved' else 'rejected' end)::public.request_status,
        decided_by    = auth.uid(),
        decision_note = p_note,
        decided_at    = now()
    where id = p_id;
end;
$$;


-- Promotes a member to manager, or turns a manager back into a member.
--   promote: a manager of that department, or an admin
--   demote:  an admin, or the manager themselves stepping down
create or replace function public.set_staff_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    t public.profiles;
begin
    if p_role not in ('member', 'manager') then
        raise exception 'Unknown role: %', p_role;
    end if;

    select * into t from public.profiles where id = p_user;

    if not found or t.role not in ('member', 'manager') then
        raise exception 'That person does not belong to a department';
    end if;

    if t.role::text = p_role then
        return;
    end if;

    if p_role = 'manager' then
        if not (public.auth_role() = 'admin'
                or (public.auth_role() = 'manager' and public.auth_department() = t.department_id)) then
            raise exception 'Only a manager of this department or an admin can appoint a manager';
        end if;
    else
        if not (public.auth_role() = 'admin' or p_user = auth.uid()) then
            raise exception 'Only an admin can remove another manager. A manager can step down themselves.';
        end if;

        if (select count(*) from public.profiles
            where department_id = t.department_id and role = 'manager') <= 1 then
            raise exception 'A department needs at least one manager. Appoint another one first.';
        end if;
    end if;

    update public.profiles set role = p_role::public.user_role where id = p_user;
end;
$$;


-- Takes someone out of their department, which turns them back into a plain user.
--   leaving:  anyone, for themselves
--   removing: an admin, or a manager removing a member of their own department
create or replace function public.remove_from_department(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    t public.profiles;
begin
    select * into t from public.profiles where id = p_user;

    if not found or t.role not in ('member', 'manager') then
        raise exception 'That person does not belong to a department';
    end if;

    if not (p_user = auth.uid()
            or public.auth_role() = 'admin'
            or (public.auth_role() = 'manager'
                and public.auth_department() = t.department_id
                and t.role = 'member')) then
        raise exception 'You are not allowed to remove this person';
    end if;

    if t.role = 'manager' and (select count(*) from public.profiles
                               where department_id = t.department_id and role = 'manager') <= 1 then
        raise exception 'A department needs at least one manager. Appoint another one first.';
    end if;

    update public.profiles set role = 'user', department_id = null where id = p_user;
end;
$$;


revoke execute on function public.decide_membership_request(uuid, boolean, text) from public, anon;
revoke execute on function public.set_staff_role(uuid, text) from public, anon;
revoke execute on function public.remove_from_department(uuid) from public, anon;

grant execute on function public.decide_membership_request(uuid, boolean, text) to authenticated;
grant execute on function public.set_staff_role(uuid, text) to authenticated;
grant execute on function public.remove_from_department(uuid) to authenticated;
