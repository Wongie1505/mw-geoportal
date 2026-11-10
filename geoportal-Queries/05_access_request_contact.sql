-- Adds contact details to access requests and lets managers see who is asking.
-- Run after files 01 to 03. Safe to run more than once.

do $$
begin
    -- Only on the first run: no real requests exist yet, so any test rows are
    -- cleared to allow the new required column.
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'access_requests'
          and column_name  = 'contact_phone'
    ) then
        delete from public.access_requests;

        -- International format, for example +265999123456
        alter table public.access_requests
            add column contact_phone text not null,
            add constraint access_requests_phone_format
                check (contact_phone ~ '^\+[1-9][0-9]{7,14}$');
    end if;
end;
$$;

-- Managers cannot read the profile of someone outside their department, so the
-- name and email are copied onto the request when it is made.
alter table public.access_requests
    add column if not exists requester_name  text,
    add column if not exists requester_email text;

create or replace function public.set_request_defaults()
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

drop trigger if exists access_requests_defaults on public.access_requests;
create trigger access_requests_defaults
    before insert on public.access_requests
    for each row execute function public.set_request_defaults();

-- The phone number is now part of what a user supplies when asking
grant insert (dataset_id, justification, contact_phone)
    on public.access_requests to authenticated;

-- Match the 50MB upload ceiling
update storage.buckets set file_size_limit = 52428800 where id = 'datasets';
