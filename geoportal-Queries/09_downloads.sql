-- Logged file access and download history. Run after file 08.
-- Safe to run more than once.
--
-- Public datasets can still be opened by anyone. For everything else, a file
-- can only be opened after the person asks for it through open_dataset_file,
-- which checks their rights, writes the audit log, and hands out a short
-- ticket. Storage only releases the file while the ticket is valid, so access
-- cannot skip the log.


-- Short-lived permission slips. Only the database functions below touch this table.
create table if not exists public.download_tickets (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references public.profiles (id) on delete cascade,
    dataset_id  uuid not null references public.datasets (id) on delete cascade,
    purpose     text not null check (purpose in ('view', 'download')),
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);

create index if not exists download_tickets_lookup_idx
    on public.download_tickets (user_id, dataset_id, expires_at);

alter table public.download_tickets enable row level security;
revoke all on public.download_tickets from anon, authenticated;


-- The earlier rule for who may read a file, now under a new name.
-- It says whether a person has the right to the file, ticket or not.
create or replace function public.has_file_rights(p_dataset uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    d      public.datasets;
    v_role public.user_role := public.auth_role();
    v_dept uuid             := public.auth_department();
begin
    select * into d from public.datasets where id = p_dataset;

    if not found then
        return false;
    end if;

    if v_role = 'admin' or d.contributed_by = auth.uid() then
        return true;
    end if;

    -- Managers see their department's files once sent in, including pending ones
    if v_role = 'manager' and v_dept = d.department_id and d.status <> 'draft' then
        return true;
    end if;

    if d.status <> 'published' then
        return false;
    end if;

    if v_role = 'member' and v_dept = d.department_id then
        return true;
    end if;

    if d.access_level = 'public' then
        return true;
    end if;

    -- Restricted files open only after a manager approved the request
    if d.access_level = 'restricted' then
        return exists (
            select 1 from public.access_requests r
            where r.dataset_id = d.id
              and r.requester_id = auth.uid()
              and r.status = 'approved'
        );
    end if;

    return false;
end;
$$;


-- What Storage asks before releasing a file: open public data goes straight
-- out, everything else also needs the right and a valid ticket
create or replace function public.can_read_dataset_file(p_dataset uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    d public.datasets;
begin
    select * into d from public.datasets where id = p_dataset;

    if not found then
        return false;
    end if;

    if d.status = 'published' and d.access_level = 'public' then
        return true;
    end if;

    return public.has_file_rights(p_dataset)
       and exists (
           select 1 from public.download_tickets t
           where t.user_id = auth.uid()
             and t.dataset_id = p_dataset
             and t.expires_at > now()
       );
end;
$$;


-- Asks to open a dataset's file. Returns the file path once the person has
-- the right to it and the request has been logged.
-- purpose is 'view' for the map or 'download' for saving the file.
create or replace function public.open_dataset_file(p_dataset uuid, p_purpose text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    d public.datasets;
begin
    if auth.uid() is null then
        raise exception 'Log in to open this dataset';
    end if;

    if p_purpose not in ('view', 'download') then
        raise exception 'Unknown purpose: %', p_purpose;
    end if;

    select * into d from public.datasets where id = p_dataset;

    if not found or not public.has_file_rights(p_dataset) then
        raise exception 'You do not have access to this dataset';
    end if;

    -- Tidy up old tickets while we are here
    delete from public.download_tickets where expires_at < now() - interval '1 hour';

    insert into public.download_tickets (user_id, dataset_id, purpose, expires_at)
    values (auth.uid(), p_dataset, p_purpose, now() + interval '5 minutes');

    -- Looking at open public data is not worth a log entry. Everything else is.
    if p_purpose = 'download' then
        perform public.log_event('dataset_downloaded', p_dataset, jsonb_build_object('purpose', p_purpose));
    elsif not (d.status = 'published' and d.access_level = 'public') then
        perform public.log_event('dataset_viewed', p_dataset, jsonb_build_object('purpose', p_purpose));
    end if;

    return d.file_path;
end;
$$;


-- Who to contact about a department's datasets: its managers, shown to signed-in people
create or replace function public.department_contacts(p_department uuid)
returns table (full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
    select p.full_name, p.email
    from public.profiles p
    where auth.uid() is not null
      and p.department_id = p_department
      and p.role = 'manager'
    order by p.full_name;
$$;


-- People can read their own download history
drop policy if exists "people read their own downloads" on public.audit_log;
create policy "people read their own downloads"
    on public.audit_log for select
    to authenticated
    using (actor_id = auth.uid() and action = 'dataset_downloaded');


revoke execute on function public.has_file_rights(uuid) from public, anon, authenticated;

revoke execute on function public.open_dataset_file(uuid, text) from public, anon;
grant execute on function public.open_dataset_file(uuid, text) to authenticated;

revoke execute on function public.department_contacts(uuid) from public, anon;
grant execute on function public.department_contacts(uuid) to authenticated;
