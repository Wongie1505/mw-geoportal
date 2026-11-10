-- Sets who is an admin, manager, member or plain user.
-- This is a tool you edit and run whenever you need it, not part of the
-- install order. Run one block at a time, after changing the values at the top.
--
-- An account has exactly one role, so one email cannot be both admin and manager.
-- Admins belong to no department. Members and managers must have one.


-- 1. Make someone an admin
do $$
declare
    v_email text := 'ADMIN_EMAIL';
begin
    update public.profiles
    set role = 'admin', department_id = null
    where email = v_email;

    if not found then
        raise exception 'No account with the email %. Register it on the site first.', v_email;
    end if;
end;
$$;


-- 2. Make someone the manager of a department
do $$
declare
    v_email           text := 'MANAGER_EMAIL';
    v_department_slug text := 'transport';
    v_department_id   uuid;
begin
    select id into v_department_id from public.departments where slug = v_department_slug;
    if v_department_id is null then
        raise exception 'No department with the slug %. Available slugs: %',
            v_department_slug,
            (select string_agg(slug, ', ' order by slug) from public.departments);
    end if;

    update public.profiles
    set role = 'manager', department_id = v_department_id
    where email = v_email;

    if not found then
        raise exception 'No account with the email %. Register it on the site first.', v_email;
    end if;
end;
$$;


-- 3. Make someone a member of a department (same shape as the manager block)
do $$
declare
    v_email           text := 'MEMBER_EMAIL';
    v_department_slug text := 'transport';
    v_department_id   uuid;
begin
    select id into v_department_id from public.departments where slug = v_department_slug;
    if v_department_id is null then
        raise exception 'No department with the slug %. Available slugs: %',
            v_department_slug,
            (select string_agg(slug, ', ' order by slug) from public.departments);
    end if;

    update public.profiles
    set role = 'member', department_id = v_department_id
    where email = v_email;

    if not found then
        raise exception 'No account with the email %. Register it on the site first.', v_email;
    end if;
end;
$$;


-- 4. Turn someone back into a plain user
do $$
declare
    v_email text := 'USER_EMAIL';
begin
    update public.profiles
    set role = 'user', department_id = null
    where email = v_email;

    if not found then
        raise exception 'No account with the email %.', v_email;
    end if;
end;
$$;


-- Check the result: everyone with their role and department
select p.email, p.full_name, p.role, d.name as department
from public.profiles p
left join public.departments d on d.id = p.department_id
order by p.role, p.email;
