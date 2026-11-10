-- Phase 1, file 1 of 4: types, tables, helper functions and starting data.
-- Run the files in order in the Supabase SQL editor.

-- Value lists used by the tables below
create type public.user_role      as enum ('user', 'member', 'manager', 'admin');
create type public.access_level   as enum ('public', 'restricted', 'internal');
create type public.data_kind      as enum ('vector', 'raster');
create type public.request_status as enum ('pending', 'approved', 'rejected');

-- draft: being prepared by the contributor, not yet sent
-- pending: waiting for the owning department to review
-- changes_requested: sent back to the contributor
create type public.dataset_status as enum (
    'draft', 'pending', 'changes_requested', 'published', 'rejected'
);


create table public.departments (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    slug        text not null unique,
    description text,
    created_at  timestamptz not null default now()
);


-- One row per person, created automatically when they sign up
create table public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    email         text not null,
    full_name     text,
    role          public.user_role not null default 'user',
    department_id uuid references public.departments (id),
    created_at    timestamptz not null default now(),

    -- Members and managers belong to a department, everyone else does not
    constraint profiles_department_matches_role
        check ((role in ('member', 'manager')) = (department_id is not null))
);


-- Dataset metadata. The data file itself lives in Storage at file_path.
-- The not null columns double as mandatory metadata: the database refuses
-- a dataset without a title, abstract, department, projection or license.
create table public.datasets (
    id               uuid primary key default gen_random_uuid(),
    title            text not null,
    abstract         text not null,
    department_id    uuid not null references public.departments (id),
    license          text not null,
    epsg             integer not null default 4326,
    kind             public.data_kind not null,
    access_level     public.access_level not null default 'public',
    status           public.dataset_status not null default 'draft',
    keywords         text[] not null default '{}',

    file_path        text,
    file_format      text,
    file_size_bytes  bigint,
    extent           geometry(Polygon, 4326),

    contributed_by   uuid not null default auth.uid() references public.profiles (id),
    contributor_name text,
    reviewed_by      uuid references public.profiles (id),
    review_note      text,

    created_at       timestamptz not null default now(),
    published_at     timestamptz,
    updated_at       timestamptz not null default now(),

    constraint datasets_title_not_blank    check (length(btrim(title)) > 0),
    constraint datasets_abstract_not_blank check (length(btrim(abstract)) > 0),
    constraint datasets_license_not_blank  check (length(btrim(license)) > 0),

    -- Files are stored under a folder named after the dataset id
    constraint datasets_file_path_matches_id
        check (file_path is null or file_path like (id::text || '/%'))
);

create index datasets_extent_idx     on public.datasets using gist (extent);
create index datasets_department_idx on public.datasets (department_id);
create index datasets_status_idx     on public.datasets (status, access_level);


-- A user asking a department for access to a restricted dataset
create table public.access_requests (
    id            uuid primary key default gen_random_uuid(),
    dataset_id    uuid not null references public.datasets (id) on delete cascade,
    requester_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
    justification text not null,
    status        public.request_status not null default 'pending',
    decided_by    uuid references public.profiles (id),
    decision_note text,
    created_at    timestamptz not null default now(),
    decided_at    timestamptz,

    constraint access_requests_justification_length
        check (length(btrim(justification)) >= 20)
);

-- A person can only have one open request per dataset
create unique index access_requests_one_open
    on public.access_requests (dataset_id, requester_id)
    where status = 'pending';


-- Append-only record of who did what. Only the database writes to it.
create table public.audit_log (
    id               bigint generated always as identity primary key,
    created_at       timestamptz not null default now(),
    actor_id         uuid,
    actor_email      text,
    actor_department text,
    action           text not null,
    dataset_id       uuid,
    dataset_title    text,
    details          jsonb not null default '{}'
);

create index audit_log_created_idx on public.audit_log (created_at desc);


-- Create a profile whenever someone signs up
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name');
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- Fill in the contributor name and keep updated_at current
create function public.set_dataset_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        select coalesce(full_name, email) into new.contributor_name
        from public.profiles
        where id = new.contributed_by;
    end if;

    new.updated_at := now();
    return new;
end;
$$;

create trigger datasets_defaults
    before insert or update on public.datasets
    for each row execute function public.set_dataset_defaults();


-- Helpers used by the access rules. They are security definer so that they
-- can read profiles without being blocked by the rules on profiles itself.
create function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
    select role from public.profiles where id = auth.uid();
$$;

create function public.auth_department()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select department_id from public.profiles where id = auth.uid();
$$;

-- True for an admin, or a manager of the department that owns the dataset
create function public.manages_dataset(p_dataset uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.datasets d
        where d.id = p_dataset
          and (
              public.auth_role() = 'admin'
              or (public.auth_role() = 'manager'
                  and public.auth_department() = d.department_id)
          )
    );
$$;

-- Turns text into a uuid, or null if it is not one
create function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
    return p_text::uuid;
exception when invalid_text_representation then
    return null;
end;
$$;


-- Starting departments. More can be added later as plain rows.
insert into public.departments (name, slug) values
    ('Planning',            'planning'),
    ('Lands',               'lands'),
    ('Transport',           'transport'),
    ('Environment',         'environment'),
    ('Health',              'health'),
    ('Disaster Management', 'disaster-management');
