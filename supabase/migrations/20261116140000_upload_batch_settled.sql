-- After a drop: tell the Studio when the worker has finished with it.
--
-- WHY. After a drop the worker refreshes the cache of ONE site, the one in
-- NEXT_PUBLIC_SITE_URL (www.saycheeeeeze.studio). A Studio running anywhere
-- else, a dev preview or `pnpm dev`, has a cache of its own that nothing
-- refreshed, so its album page kept what it had cached during the drop.
-- Now that Studio refreshes its own site's pages as well, and settled_at
-- tells it when: after the worker has put the gallery in file-name order, so
-- the page it caches is the final one.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261116090000_studio_uploads.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261116140000', 'upload_batch_settled');

begin;

do $$
begin
  if to_regprocedure('public.worker_set_photo_order(uuid, uuid[])') is null then
    raise exception 'Run 20261116090000_studio_uploads.sql first.';
  end if;
end $$;

-- Members already read upload_batches (a table-wide grant), so they read
-- this column too. Only the worker writes it.
alter table public.upload_batches add column if not exists settled_at timestamptz;

comment on column public.upload_batches.settled_at is
  'When the worker last finished with this drop: gallery in file-name order, site told. Older than finished_at means not yet (a retried file finished the drop again).';

-- The worker, at the end of a finish_batch job. Only a drop that is done:
-- a file retried meanwhile has reopened it, and its own finish_batch will
-- settle it again.
create or replace function public.worker_settle_batch(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.upload_batches b
     set settled_at = now()
   where b.id = p_batch_id
     and b.status = 'done';
  return found;
end;
$$;

revoke all on function public.worker_settle_batch(uuid) from public, anon, authenticated;
grant execute on function public.worker_settle_batch(uuid) to service_role;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- Checks, read-only. Run after the file.
--
--   select column_name from information_schema.columns
--    where table_name = 'upload_batches' and column_name = 'settled_at';
--   select to_regprocedure('public.worker_settle_batch(uuid)');
--
--   -- after the next drop: settled a second or two after it finished
--   select status, finished_at, settled_at - finished_at as took
--     from public.upload_batches order by created_at desc limit 5;
--
-- UNDO
--   begin;
--   drop function if exists public.worker_settle_batch(uuid);
--   alter table public.upload_batches drop column if exists settled_at;
--   delete from supabase_migrations.schema_migrations where version = '20261116140000';
--   commit;
-- ---------------------------------------------------------------------------
