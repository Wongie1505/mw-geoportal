-- Adds the OpenStreetMap roads dataset to the catalog. Safe to run more than once.
--
-- Before running, set the two values at the top of the block:
--   v_email            the email you registered with
--   v_department_slug  the slug of the owning department (check the departments table)
--
-- After running, upload the file as described in the steps at the bottom.

do $$
declare
    v_email           text := 'YOUR_EMAIL';
    v_department_slug text := 'transport';

    v_dataset_id      uuid := '5f0c2a9e-3b1d-4c7e-8a46-1d9b7e2f0a11';
    v_profile_id      uuid;
    v_department_id   uuid;
begin
    select id into v_profile_id from public.profiles where email = v_email;
    if v_profile_id is null then
        raise exception 'No account with the email %. Set v_email to the email you registered with.', v_email;
    end if;

    select id into v_department_id from public.departments where slug = v_department_slug;
    if v_department_id is null then
        raise exception 'No department with the slug %. Available slugs: %',
            v_department_slug,
            (select string_agg(slug, ', ' order by slug) from public.departments);
    end if;

    insert into public.datasets (
        id, title, abstract, department_id, license, epsg, kind, access_level,
        status, keywords, file_path, file_format, extent, contributed_by, published_at
    )
    values (
        v_dataset_id,
        'Malawi Road Network',
        'Roads of Malawi extracted from OpenStreetMap. Includes the main road classes and local roads.',
        v_department_id,
        'ODbL 1.0. Contains data from OpenStreetMap contributors.',
        4326,
        'vector',
        'public',
        'published',
        array['roads', 'transport', 'openstreetmap'],
        v_dataset_id::text || '/data.json',
        'geojson',
        -- Rough bounding box of Malawi. The upload form will compute exact extents.
        st_makeenvelope(32.6, -17.2, 36.0, -9.3, 4326),
        v_profile_id,
        now()
    )
    on conflict (id) do nothing;

    -- Make sure the row is really there before finishing
    if not exists (select 1 from public.datasets where id = v_dataset_id) then
        raise exception 'The dataset row was not created.';
    end if;
end;
$$;

-- Upload steps, in the Supabase dashboard:
--   1. Storage, then the datasets bucket, then create a folder named
--      5f0c2a9e-3b1d-4c7e-8a46-1d9b7e2f0a11
--   2. Upload the roads GeoJSON into that folder and name it data.json.
--      The .json name matters: the bucket only accepts the JSON file type,
--      and a .geojson file is often sent as an unknown type and rejected.
