-- Proves each role sees and can do only what it should. Run after 01 to 10.
--
-- Before running, create four users in the Supabase dashboard
-- (Authentication, Users, Add user, tick Auto Confirm User):
--   admin@test.local   manager@test.local   member@test.local   visitor@test.local
--
-- Then run this whole file. The last line shows one row per check.
-- Every row in the pass column should be true. It can be run again any time.

-- Create a profile for anyone who signed up before file 01 was run
insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), raw_user_meta_data ->> 'full_name'
from auth.users
on conflict (id) do nothing;

-- Stop here with a clear message if the setup is incomplete, instead of
-- quietly creating no test data
do $$
begin
    if (select count(*) from public.profiles
        where email in ('admin@test.local', 'manager@test.local',
                        'member@test.local', 'visitor@test.local')) < 4 then
        raise exception 'Create the four test users first (see the notes at the top of this file)';
    end if;

    if not exists (select 1 from public.departments where slug = 'health') then
        raise exception 'The Health department is missing. Re-run the insert at the bottom of 01_schema.sql';
    end if;
end;
$$;

-- Give the test users their roles. Manager and member belong to Health.
update public.profiles set role = 'admin' where email = 'admin@test.local';

update public.profiles
set role = 'user', department_id = null
where email = 'visitor@test.local';

delete from public.membership_requests where requester_email like '%@test.local';
delete from public.audit_log where action like 'membership_%' and details ->> 'requester_email' like '%@test.local';

update public.profiles
set role = 'manager',
    department_id = (select id from public.departments where slug = 'health')
where email = 'manager@test.local';

update public.profiles
set role = 'member',
    department_id = (select id from public.departments where slug = 'health')
where email = 'member@test.local';

-- Fresh test datasets. Their ids all start with 00000000 so they are easy to spot.
-- a1 public, a2 restricted, a3 internal, a4 pending from the visitor,
-- a5 draft from the visitor, a6 restricted with an open request from the visitor.
delete from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%';
delete from public.audit_log where dataset_id::text like '00000000-0000-0000-0000-0000000000a%';

insert into public.datasets
    (id, title, abstract, department_id, license, kind, access_level, status, contributed_by, published_at)
select v.id, v.title, 'Test dataset', d.id, 'CC-BY-4.0', 'vector',
       v.access::public.access_level, v.status::public.dataset_status, p.id,
       case when v.status = 'published' then now() end
from (values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, 'Test public',     'public',     'published', 'manager@test.local'),
    ('00000000-0000-0000-0000-0000000000a2'::uuid, 'Test restricted', 'restricted', 'published', 'manager@test.local'),
    ('00000000-0000-0000-0000-0000000000a3'::uuid, 'Test internal',   'internal',   'published', 'manager@test.local'),
    ('00000000-0000-0000-0000-0000000000a4'::uuid, 'Test pending',    'public',     'pending',   'visitor@test.local'),
    ('00000000-0000-0000-0000-0000000000a5'::uuid, 'Test draft',      'public',     'draft',     'visitor@test.local'),
    ('00000000-0000-0000-0000-0000000000a6'::uuid, 'Test restricted 2', 'restricted', 'published', 'manager@test.local')
) as v(id, title, access, status, who)
join public.profiles p on p.email = v.who
cross join (select id from public.departments where slug = 'health') d;

insert into public.access_requests (id, dataset_id, requester_id, justification, contact_phone)
select '00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-0000000000a6',
       id,
       'Needed for a cholera response planning study',
       '+265999123456'
from public.profiles
where email = 'visitor@test.local';


-- Test runner. It switches to the given user, runs the statement the way the
-- browser would, then switches back and records the outcome.
--   count:  the statement must return exactly this many rows
--   ok:     the statement must succeed
--   denied: the statement must be refused
create temp table test_results (
    n      serial,
    who    text,
    label  text,
    expect text,
    actual text,
    pass   boolean
);

create function pg_temp.run_test(
    p_email text,
    p_label text,
    p_kind  text,
    p_sql   text,
    p_count int default null
)
returns void
language plpgsql
as $$
declare
    v_id     uuid;
    v_count  int;
    v_failed boolean := false;
    v_actual text;
begin
    begin
        if p_email = 'anon' then
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
            perform set_config('role', 'anon', true);
        else
            select id into v_id from auth.users where email = p_email;
            perform set_config('request.jwt.claims',
                json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
            perform set_config('role', 'authenticated', true);
        end if;

        if p_kind = 'count' then
            execute 'select count(*) from (' || p_sql || ') q' into v_count;
        else
            execute p_sql;
        end if;
    exception when others then
        v_failed := true;
        v_actual := sqlerrm;
    end;

    execute 'reset role';

    if p_kind = 'count' then
        insert into test_results (who, label, expect, actual, pass)
        values (p_email, p_label, p_count::text, coalesce(v_count::text, v_actual),
                v_count is not distinct from p_count);
    elsif p_kind = 'ok' then
        insert into test_results (who, label, expect, actual, pass)
        values (p_email, p_label, 'succeeds', coalesce(v_actual, 'succeeded'), not v_failed);
    else
        insert into test_results (who, label, expect, actual, pass)
        values (p_email, p_label, 'refused', coalesce(v_actual, 'was allowed'), v_failed);
    end if;
end;
$$;


-- Who can see which datasets
select pg_temp.run_test('anon',                'sees published public and restricted only', 'count',
    $q$select 1 from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%'$q$, 3);
select pg_temp.run_test('visitor@test.local',  'sees published plus their own pending and draft', 'count',
    $q$select 1 from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%'$q$, 5);
select pg_temp.run_test('member@test.local',   'sees published including internal, not pending', 'count',
    $q$select 1 from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%'$q$, 4);
select pg_temp.run_test('manager@test.local',  'sees everything sent in, but not drafts', 'count',
    $q$select 1 from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%'$q$, 5);
select pg_temp.run_test('admin@test.local',    'sees everything', 'count',
    $q$select 1 from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%'$q$, 6);

-- Who can open which files. Open public data needs nothing. Everything else
-- needs the right to the file and a ticket from open_dataset_file.
select pg_temp.run_test('anon',               'opens the public file', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a1')$q$, 1);
select pg_temp.run_test('anon',               'cannot open the restricted file', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a2')$q$, 0);
select pg_temp.run_test('anon',               'cannot ask to open a file', 'denied',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a1', 'view')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot open the restricted file before approval', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a6')$q$, 0);
select pg_temp.run_test('visitor@test.local', 'is refused a ticket for the restricted file before approval', 'denied',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a6', 'view')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot open the internal file', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a3')$q$, 0);
select pg_temp.run_test('visitor@test.local', 'is refused a ticket for the internal file', 'denied',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a3', 'view')$q$);

select pg_temp.run_test('member@test.local',  'cannot open the internal file without a ticket', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a3')$q$, 0);
select pg_temp.run_test('member@test.local',  'gets a ticket for the internal file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a3', 'view')$q$);
select pg_temp.run_test('member@test.local',  'opens the internal file with the ticket', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a3')$q$, 1);
select pg_temp.run_test('member@test.local',  'cannot open a pending file', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a4')$q$, 0);
select pg_temp.run_test('member@test.local',  'is refused a ticket for a pending file', 'denied',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a4', 'view')$q$);

select pg_temp.run_test('manager@test.local', 'cannot open a pending file without a ticket', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a4')$q$, 0);
select pg_temp.run_test('manager@test.local', 'gets a ticket to review a pending file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a4', 'view')$q$);
select pg_temp.run_test('manager@test.local', 'opens a pending file to review it', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a4')$q$, 1);

select pg_temp.run_test('visitor@test.local', 'contributor cannot open their pending file without a ticket', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a4')$q$, 0);
select pg_temp.run_test('visitor@test.local', 'contributor gets a ticket for their own file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a4', 'view')$q$);
select pg_temp.run_test('visitor@test.local', 'contributor opens their own file with the ticket', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a4')$q$, 1);

-- Things nobody should be able to do from the browser
select pg_temp.run_test('visitor@test.local', 'cannot insert a dataset as published', 'denied',
    $q$insert into public.datasets (title, abstract, department_id, license, kind, status)
       values ('x', 'x', (select id from public.departments limit 1), 'x', 'vector', 'published')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot make themselves admin', 'denied',
    $q$update public.profiles set role = 'admin' where email = 'visitor@test.local'$q$);
select pg_temp.run_test('visitor@test.local', 'cannot write to the audit log', 'denied',
    $q$insert into public.audit_log (action) values ('forged')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot submit a draft that has no file', 'denied',
    $q$select public.submit_dataset('00000000-0000-0000-0000-0000000000a5')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot read the audit log', 'count',
    $q$select 1 from public.audit_log$q$, 0);

-- Access requests
select pg_temp.run_test('visitor@test.local', 'cannot request access with a one-word reason', 'denied',
    $q$insert into public.access_requests (dataset_id, justification, contact_phone)
       values ('00000000-0000-0000-0000-0000000000a2', 'please', '+265999123456')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot request access with a malformed phone number', 'denied',
    $q$insert into public.access_requests (dataset_id, justification, contact_phone)
       values ('00000000-0000-0000-0000-0000000000a2', 'Needed for a cholera response planning study', '0999 123')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot request an internal dataset', 'denied',
    $q$insert into public.access_requests (dataset_id, justification, contact_phone)
       values ('00000000-0000-0000-0000-0000000000a3', 'I would like to see this internal data please', '+265999123456')$q$);
select pg_temp.run_test('visitor@test.local', 'can request a restricted dataset', 'ok',
    $q$insert into public.access_requests (dataset_id, justification, contact_phone)
       values ('00000000-0000-0000-0000-0000000000a2', 'Needed for a cholera response planning study', '+265999123456')$q$);
select pg_temp.run_test('manager@test.local', 'manager sees who is asking and how to reach them', 'count',
    $q$select 1 from public.access_requests
       where dataset_id = '00000000-0000-0000-0000-0000000000a2'
         and requester_email = 'visitor@test.local' and contact_phone is not null$q$, 1);
select pg_temp.run_test('member@test.local',  'a member cannot see access requests or phone numbers', 'count',
    $q$select 1 from public.access_requests$q$, 0);
select pg_temp.run_test('member@test.local',  'a member cannot decide a request', 'denied',
    $q$select public.decide_access_request('00000000-0000-0000-0000-0000000000b1', true)$q$);
select pg_temp.run_test('manager@test.local', 'a manager can approve a request', 'ok',
    $q$select public.decide_access_request('00000000-0000-0000-0000-0000000000b1', true, 'Approved')$q$);
select pg_temp.run_test('visitor@test.local', 'approval alone does not open the file, a ticket is needed', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a6')$q$, 0);
select pg_temp.run_test('visitor@test.local', 'gets a ticket for the approved restricted file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a6', 'view')$q$);
select pg_temp.run_test('visitor@test.local', 'opens the restricted file after approval', 'count',
    $q$select 1 where public.can_read_dataset_file('00000000-0000-0000-0000-0000000000a6')$q$, 1);
select pg_temp.run_test('visitor@test.local', 'downloads the approved restricted file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a6', 'download')$q$);
select pg_temp.run_test('visitor@test.local', 'downloads the open public file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a1', 'download')$q$);
select pg_temp.run_test('visitor@test.local', 'only views the open public file', 'ok',
    $q$select public.open_dataset_file('00000000-0000-0000-0000-0000000000a1', 'view')$q$);

-- Reviewing a contribution
select pg_temp.run_test('member@test.local',  'a member cannot review a contribution', 'denied',
    $q$select public.review_dataset('00000000-0000-0000-0000-0000000000a4', 'approve')$q$);
select pg_temp.run_test('manager@test.local', 'rejecting needs a note', 'denied',
    $q$select public.review_dataset('00000000-0000-0000-0000-0000000000a4', 'reject')$q$);
select pg_temp.run_test('manager@test.local', 'a manager can approve and set the access level', 'ok',
    $q$select public.review_dataset('00000000-0000-0000-0000-0000000000a4', 'approve', 'restricted')$q$);
select pg_temp.run_test('anon',               'the approved contribution is now listed', 'count',
    $q$select 1 from public.datasets where id::text like '00000000-0000-0000-0000-0000000000a%'$q$, 4);

-- The audit trail picked it all up
select pg_temp.run_test('admin@test.local',   'audit log recorded the approval', 'count',
    $q$select 1 from public.audit_log
       where dataset_id = '00000000-0000-0000-0000-0000000000a4' and action = 'dataset_published'$q$, 1);
select pg_temp.run_test('admin@test.local',   'audit log recorded the access decision', 'count',
    $q$select 1 from public.audit_log
       where dataset_id = '00000000-0000-0000-0000-0000000000a6' and action = 'access_approved'$q$, 1);

select pg_temp.run_test('admin@test.local',   'audit log keeps who asked and their phone number', 'count',
    $q$select 1 from public.audit_log
       where dataset_id = '00000000-0000-0000-0000-0000000000a2' and action = 'access_requested'
         and details ->> 'requester_email' = 'visitor@test.local'
         and details ->> 'contact_phone' = '+265999123456'$q$, 1);
select pg_temp.run_test('admin@test.local',   'audit log names the person on a decision', 'count',
    $q$select 1 from public.audit_log
       where dataset_id = '00000000-0000-0000-0000-0000000000a6' and action = 'access_approved'
         and details ->> 'requester_email' = 'visitor@test.local'$q$, 1);
-- Downloads and views are recorded, and people can read only their own downloads
select pg_temp.run_test('admin@test.local',   'restricted file view is logged', 'count',
    $q$select 1 from public.audit_log where dataset_id = '00000000-0000-0000-0000-0000000000a6' and action = 'dataset_viewed'$q$, 1);
select pg_temp.run_test('admin@test.local',   'restricted file download is logged', 'count',
    $q$select 1 from public.audit_log where dataset_id = '00000000-0000-0000-0000-0000000000a6' and action = 'dataset_downloaded'$q$, 1);
select pg_temp.run_test('admin@test.local',   'public file download is logged', 'count',
    $q$select 1 from public.audit_log where dataset_id = '00000000-0000-0000-0000-0000000000a1' and action = 'dataset_downloaded'$q$, 1);
select pg_temp.run_test('admin@test.local',   'viewing open public data is not logged', 'count',
    $q$select 1 from public.audit_log where dataset_id = '00000000-0000-0000-0000-0000000000a1' and action = 'dataset_viewed'$q$, 0);
select pg_temp.run_test('visitor@test.local', 'reads their own download history', 'count',
    $q$select 1 from public.audit_log where action = 'dataset_downloaded'$q$, 2);
select pg_temp.run_test('visitor@test.local', 'cannot read their view entries', 'count',
    $q$select 1 from public.audit_log where action = 'dataset_viewed'$q$, 0);
select pg_temp.run_test('member@test.local',  'cannot read other people''s downloads', 'count',
    $q$select 1 from public.audit_log where action = 'dataset_downloaded'$q$, 0);
select pg_temp.run_test('member@test.local',  'sees the managers to contact', 'count',
    $q$select 1 from public.department_contacts((select id from public.departments where slug = 'health'))$q$, 1);
select pg_temp.run_test('anon',               'cannot list contacts', 'denied',
    $q$select 1 from public.department_contacts((select id from public.departments where slug = 'health'))$q$);
select pg_temp.run_test('visitor@test.local', 'cannot create tickets directly', 'denied',
    $q$insert into public.download_tickets (user_id, dataset_id, purpose, expires_at)
       values ((select id from auth.users where email = 'visitor@test.local'), '00000000-0000-0000-0000-0000000000a3', 'view', now() + interval '1 hour')$q$);
-- Department membership
create temp table test_ids as
select u.email, u.id from auth.users u where u.email like '%@test.local';
grant select on test_ids to anon, authenticated;

-- An open request from the visitor to join Transport, made by the database
insert into public.membership_requests (id, requester_id, department_id, message)
select '00000000-0000-0000-0000-0000000000d1', i.id, d.id, 'I work on roads data for the ministry'
from test_ids i, public.departments d
where i.email = 'visitor@test.local' and d.slug = 'transport';

select pg_temp.run_test('member@test.local',  'a member cannot ask to join a department', 'denied',
    $q$insert into public.membership_requests (department_id, message)
       values ((select id from public.departments where slug = 'transport'), 'I would like to join this department')$q$);
select pg_temp.run_test('member@test.local',  'a member cannot decide a join request', 'denied',
    $q$select public.decide_membership_request('00000000-0000-0000-0000-0000000000d1', true)$q$);
select pg_temp.run_test('manager@test.local', 'a manager cannot decide for another department', 'denied',
    $q$select public.decide_membership_request('00000000-0000-0000-0000-0000000000d1', true)$q$);
select pg_temp.run_test('visitor@test.local', 'withdraws an open request', 'ok',
    $q$delete from public.membership_requests where id = '00000000-0000-0000-0000-0000000000d1'$q$);
select pg_temp.run_test('visitor@test.local', 'cannot ask to join with a one word reason', 'denied',
    $q$insert into public.membership_requests (department_id, message)
       values ((select id from public.departments where slug = 'health'), 'please')$q$);
select pg_temp.run_test('visitor@test.local', 'asks to join Health', 'ok',
    $q$insert into public.membership_requests (department_id, message)
       values ((select id from public.departments where slug = 'health'), 'I analyse health facility data')$q$);
select pg_temp.run_test('visitor@test.local', 'cannot have two open requests', 'denied',
    $q$insert into public.membership_requests (department_id, message)
       values ((select id from public.departments where slug = 'transport'), 'I also want to join Transport')$q$);
select pg_temp.run_test('manager@test.local', 'the manager sees the request and who sent it', 'count',
    $q$select 1 from public.membership_requests where requester_email = 'visitor@test.local' and status = 'pending'$q$, 1);
select pg_temp.run_test('member@test.local',  'a member cannot see join requests', 'count',
    $q$select 1 from public.membership_requests$q$, 0);
select pg_temp.run_test('manager@test.local', 'the manager approves the request', 'ok',
    $q$select public.decide_membership_request(
           (select id from public.membership_requests where requester_email = 'visitor@test.local' and status = 'pending'), true)$q$);
select pg_temp.run_test('visitor@test.local', 'is now a member of Health', 'count',
    $q$select 1 from public.profiles where id = (select id from test_ids where email = 'visitor@test.local') and role = 'member'$q$, 1);
select pg_temp.run_test('visitor@test.local', 'a member cannot ask to join again', 'denied',
    $q$insert into public.membership_requests (department_id, message)
       values ((select id from public.departments where slug = 'transport'), 'I want to move to Transport')$q$);

-- Managers and members
select pg_temp.run_test('member@test.local',  'a member cannot appoint a manager', 'denied',
    $q$select public.set_staff_role((select id from test_ids where email = 'visitor@test.local'), 'manager')$q$);
select pg_temp.run_test('manager@test.local', 'a manager appoints a member as manager', 'ok',
    $q$select public.set_staff_role((select id from test_ids where email = 'visitor@test.local'), 'manager')$q$);
select pg_temp.run_test('visitor@test.local', 'a manager cannot demote another manager', 'denied',
    $q$select public.set_staff_role((select id from test_ids where email = 'manager@test.local'), 'member')$q$);
select pg_temp.run_test('visitor@test.local', 'a manager steps down while another remains', 'ok',
    $q$select public.set_staff_role((select id from test_ids where email = 'visitor@test.local'), 'member')$q$);
select pg_temp.run_test('manager@test.local', 'the only manager cannot step down', 'denied',
    $q$select public.set_staff_role((select id from test_ids where email = 'manager@test.local'), 'member')$q$);
select pg_temp.run_test('manager@test.local', 'appoints the second manager again', 'ok',
    $q$select public.set_staff_role((select id from test_ids where email = 'visitor@test.local'), 'manager')$q$);
select pg_temp.run_test('admin@test.local',   'an admin can demote a manager', 'ok',
    $q$select public.set_staff_role((select id from test_ids where email = 'manager@test.local'), 'member')$q$);
select pg_temp.run_test('admin@test.local',   'an admin can appoint a manager', 'ok',
    $q$select public.set_staff_role((select id from test_ids where email = 'manager@test.local'), 'manager')$q$);
select pg_temp.run_test('visitor@test.local', 'a manager cannot remove another manager', 'denied',
    $q$select public.remove_from_department((select id from test_ids where email = 'manager@test.local'))$q$);
select pg_temp.run_test('visitor@test.local', 'a manager removes a member of their department', 'ok',
    $q$select public.remove_from_department((select id from test_ids where email = 'member@test.local'))$q$);

-- Put the member back, then check leaving
update public.profiles
set role = 'member', department_id = (select id from public.departments where slug = 'health')
where email = 'member@test.local';

select pg_temp.run_test('visitor@test.local', 'the second manager steps down', 'ok',
    $q$select public.set_staff_role((select id from test_ids where email = 'visitor@test.local'), 'member')$q$);
select pg_temp.run_test('manager@test.local', 'the last manager cannot leave', 'denied',
    $q$select public.remove_from_department((select id from test_ids where email = 'manager@test.local'))$q$);
select pg_temp.run_test('visitor@test.local', 'a member leaves the department', 'ok',
    $q$select public.remove_from_department((select id from test_ids where email = 'visitor@test.local'))$q$);
select pg_temp.run_test('visitor@test.local', 'is a plain user again', 'count',
    $q$select 1 from public.profiles where id = (select id from test_ids where email = 'visitor@test.local') and role = 'user'$q$, 1);

-- A rejection with a note
select pg_temp.run_test('visitor@test.local', 'asks to join Transport after leaving', 'ok',
    $q$insert into public.membership_requests (department_id, message)
       values ((select id from public.departments where slug = 'transport'), 'I would like to work with roads data')$q$);
select pg_temp.run_test('admin@test.local',   'an admin rejects the request with a note', 'ok',
    $q$select public.decide_membership_request(
           (select id from public.membership_requests where requester_email = 'visitor@test.local' and status = 'pending'),
           false, 'Not at the moment')$q$);
select pg_temp.run_test('visitor@test.local', 'sees the reason for the rejection', 'count',
    $q$select 1 from public.membership_requests where status = 'rejected' and decision_note = 'Not at the moment'$q$, 1);

-- The audit log recorded it
select pg_temp.run_test('admin@test.local',   'audit log recorded the request', 'count',
    $q$select 1 where exists (select 1 from public.audit_log
       where action = 'membership_requested' and details ->> 'requester_email' = 'visitor@test.local')$q$, 1);
select pg_temp.run_test('admin@test.local',   'audit log recorded the approval', 'count',
    $q$select 1 where exists (select 1 from public.audit_log
       where action = 'membership_approved' and details ->> 'requester_email' = 'visitor@test.local')$q$, 1);
select pg_temp.run_test('admin@test.local',   'audit log recorded the rejection', 'count',
    $q$select 1 where exists (select 1 from public.audit_log
       where action = 'membership_rejected' and details ->> 'requester_email' = 'visitor@test.local')$q$, 1);


-- Failures sort to the top
select n, who, label, expect, actual, pass
from test_results
order by pass, n;
