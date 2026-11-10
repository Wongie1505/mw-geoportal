-- Records when a manager decided on a contribution, so the review history can
-- show dates. Run after file 07. Safe to run more than once.

alter table public.datasets
    add column if not exists reviewed_at timestamptz;

-- Decisions made before this column existed get their last update time,
-- which is the closest date available
update public.datasets
set reviewed_at = updated_at
where reviewed_by is not null and reviewed_at is null;

-- Same function as in file 02, with one extra line that stamps reviewed_at
create or replace function public.review_dataset(
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
        reviewed_at  = now(),
        review_note  = p_note,
        published_at = case when p_decision = 'approve' then now() else published_at end
    where id = p_id;

    return v_status;
end;
$$;
