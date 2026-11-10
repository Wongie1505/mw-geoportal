-- Finds datasets and files that no longer match. Run it whenever something
-- was deleted by hand in the dashboard instead of through the site.
--
--   row without file:  the catalog shows a card but the file is gone.
--                      Delete the dataset from the site, or run:
--                      delete from public.datasets where id = '...';
--   file without row:  a file is left in the bucket that no dataset points to.
--                      Remove it in the Storage dashboard.

select 'row without file' as problem, d.id::text as reference, d.title as detail
from public.datasets d
where d.file_path is not null
  and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'datasets' and o.name = d.file_path
  )

union all

select 'file without row', o.name, null
from storage.objects o
where o.bucket_id = 'datasets'
  and o.name not like '%.emptyFolderPlaceholder'
  and not exists (select 1 from public.datasets d where d.file_path = o.name)

order by 1, 2;
