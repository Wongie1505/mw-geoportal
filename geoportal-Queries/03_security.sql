-- Phase 1, file 3 of 4: who can see and change what. Safe to run more than once.
-- Row level security means the database itself enforces these rules,
-- whatever the browser code does.

alter table public.departments     enable row level security;
alter table public.profiles        enable row level security;
alter table public.datasets        enable row level security;
alter table public.access_requests enable row level security;
alter table public.audit_log       enable row level security;


-- Start from nothing, then grant only what is needed
revoke all on public.departments, public.profiles, public.datasets,
              public.access_requests, public.audit_log
    from anon, authenticated;

grant select on public.departments to anon, authenticated;
grant insert, update, delete on public.departments to authenticated;

-- People may only change their own name. Role and department are changed
-- by an admin, never by the user.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Status, reviewer and publish date are not in these lists on purpose:
-- they only change through the workflow functions.
grant select on public.datasets to anon, authenticated;
grant insert (title, abstract, department_id, license, epsg, kind, access_level,
              keywords, file_path, file_format, file_size_bytes, extent)
    on public.datasets to authenticated;
grant update (title, abstract, department_id, license, epsg, kind, access_level,
              keywords, file_path, file_format, file_size_bytes, extent)
    on public.datasets to authenticated;
grant delete on public.datasets to authenticated;

grant select on public.access_requests to authenticated;
grant insert (dataset_id, justification) on public.access_requests to authenticated;

-- The phone column is added by file 05, so only grant it once it exists
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'access_requests'
          and column_name  = 'contact_phone'
    ) then
        grant insert (contact_phone) on public.access_requests to authenticated;
    end if;
end;
$$;

grant select on public.audit_log to authenticated;


-- Departments: anyone can read, only admins change them
drop policy if exists "departments are public" on public.departments;
create policy "departments are public"
    on public.departments for select
    to anon, authenticated
    using (true);

drop policy if exists "admins manage departments" on public.departments;
create policy "admins manage departments"
    on public.departments for all
    to authenticated
    using (public.auth_role() = 'admin')
    with check (public.auth_role() = 'admin');


-- Profiles: yourself, your department's people if you manage it, or everyone for admins
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
    on public.profiles for select
    to authenticated
    using (id = auth.uid());

drop policy if exists "managers read their department" on public.profiles;
create policy "managers read their department"
    on public.profiles for select
    to authenticated
    using (public.auth_role() = 'manager'
           and department_id = public.auth_department());

drop policy if exists "admins read all profiles" on public.profiles;
create policy "admins read all profiles"
    on public.profiles for select
    to authenticated
    using (public.auth_role() = 'admin');

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
    on public.profiles for update
    to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());


-- Datasets: reading
-- Published public and restricted datasets are listed for everybody so people
-- can discover them. Whether the file itself can be opened is decided in storage.
drop policy if exists "published datasets are listed" on public.datasets;
create policy "published datasets are listed"
    on public.datasets for select
    to anon, authenticated
    using (status = 'published' and access_level in ('public', 'restricted'));

drop policy if exists "department staff read internal datasets" on public.datasets;
create policy "department staff read internal datasets"
    on public.datasets for select
    to authenticated
    using (status = 'published'
           and access_level = 'internal'
           and public.auth_role() in ('member', 'manager')
           and department_id = public.auth_department());

drop policy if exists "contributors read their own datasets" on public.datasets;
create policy "contributors read their own datasets"
    on public.datasets for select
    to authenticated
    using (contributed_by = auth.uid());

-- Drafts stay private to their contributor until they are sent in
drop policy if exists "managers read their department datasets" on public.datasets;
create policy "managers read their department datasets"
    on public.datasets for select
    to authenticated
    using (public.auth_role() = 'manager'
           and department_id = public.auth_department()
           and status <> 'draft');

drop policy if exists "admins read all datasets" on public.datasets;
create policy "admins read all datasets"
    on public.datasets for select
    to authenticated
    using (public.auth_role() = 'admin');

-- Datasets: writing
drop policy if exists "anyone signed in can start a draft" on public.datasets;
create policy "anyone signed in can start a draft"
    on public.datasets for insert
    to authenticated
    with check (contributed_by = auth.uid() and status = 'draft');

drop policy if exists "contributors edit unsent datasets" on public.datasets;
create policy "contributors edit unsent datasets"
    on public.datasets for update
    to authenticated
    using (contributed_by = auth.uid() and status in ('draft', 'changes_requested'))
    with check (contributed_by = auth.uid() and status in ('draft', 'changes_requested'));

drop policy if exists "managers edit their department datasets" on public.datasets;
create policy "managers edit their department datasets"
    on public.datasets for update
    to authenticated
    using (public.auth_role() = 'manager'
           and department_id = public.auth_department()
           and status <> 'draft')
    with check (public.auth_role() = 'manager'
                and department_id = public.auth_department());

drop policy if exists "admins edit all datasets" on public.datasets;
create policy "admins edit all datasets"
    on public.datasets for update
    to authenticated
    using (public.auth_role() = 'admin')
    with check (public.auth_role() = 'admin');

drop policy if exists "contributors delete unsent datasets" on public.datasets;
create policy "contributors delete unsent datasets"
    on public.datasets for delete
    to authenticated
    using (contributed_by = auth.uid() and status in ('draft', 'changes_requested'));

drop policy if exists "managers delete their department datasets" on public.datasets;
create policy "managers delete their department datasets"
    on public.datasets for delete
    to authenticated
    using (public.manages_dataset(id));


-- Access requests
drop policy if exists "requesters read their own requests" on public.access_requests;
create policy "requesters read their own requests"
    on public.access_requests for select
    to authenticated
    using (requester_id = auth.uid());

drop policy if exists "managers read requests for their datasets" on public.access_requests;
create policy "managers read requests for their datasets"
    on public.access_requests for select
    to authenticated
    using (public.manages_dataset(dataset_id));

drop policy if exists "ask for access to a restricted dataset" on public.access_requests;
create policy "ask for access to a restricted dataset"
    on public.access_requests for insert
    to authenticated
    with check (
        requester_id = auth.uid()
        and status = 'pending'
        and exists (
            select 1 from public.datasets d
            where d.id = dataset_id
              and d.status = 'published'
              and d.access_level = 'restricted'
        )
    );


-- Audit log: admins read it, nobody writes it directly
drop policy if exists "admins read the audit log" on public.audit_log;
create policy "admins read the audit log"
    on public.audit_log for select
    to authenticated
    using (public.auth_role() = 'admin');


-- Who may open the data file of a dataset
create or replace function public.can_read_dataset_file(p_dataset uuid)
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

-- Contributors can add files to their own unsent datasets only
create or replace function public.can_upload_dataset_file(p_dataset uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.datasets d
        where d.id = p_dataset
          and d.contributed_by = auth.uid()
          and d.status in ('draft', 'changes_requested')
    );
$$;


-- Workflow functions are for signed-in users. The audit writer is for nobody.
revoke execute on function
    public.submit_dataset(uuid),
    public.review_dataset(uuid, text, public.access_level, text),
    public.decide_access_request(uuid, boolean, text)
    from public, anon;
grant execute on function
    public.submit_dataset(uuid),
    public.review_dataset(uuid, text, public.access_level, text),
    public.decide_access_request(uuid, boolean, text)
    to authenticated;

revoke execute on function public.log_event(text, uuid, jsonb) from public, anon, authenticated;

-- Helpers the rules call while checking access
grant execute on function
    public.auth_role(),
    public.auth_department(),
    public.manages_dataset(uuid),
    public.try_uuid(text),
    public.can_read_dataset_file(uuid),
    public.can_upload_dataset_file(uuid)
    to anon, authenticated;


-- Storage: one private bucket. The first folder in every path is the dataset id.
-- The size limit and file types are enforced by the bucket itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('datasets', 'datasets', false, 52428800,
        array['application/geo+json', 'application/json', 'image/tiff'])
on conflict (id) do update
    set file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "datasets bucket: read allowed files" on storage.objects;
create policy "datasets bucket: read allowed files"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'datasets'
           and public.can_read_dataset_file(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists "datasets bucket: contributors upload" on storage.objects;
create policy "datasets bucket: contributors upload"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'datasets'
                and public.can_upload_dataset_file(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists "datasets bucket: contributors replace" on storage.objects;
create policy "datasets bucket: contributors replace"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'datasets'
           and public.can_upload_dataset_file(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists "datasets bucket: remove files" on storage.objects;
create policy "datasets bucket: remove files"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'datasets'
           and (public.can_upload_dataset_file(public.try_uuid((storage.foldername(name))[1]))
                or public.manages_dataset(public.try_uuid((storage.foldername(name))[1]))));
