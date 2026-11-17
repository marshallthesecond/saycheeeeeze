-- Step 6 of the admin panel: deleting photos and galleries with their files,
-- the nightly copy of the database, and the cover a drop sets.
--
-- WHAT CHANGES
--
--   Deleting. studio_delete_photos() takes photos out of a gallery and
--   studio_delete_gallery() now also takes a gallery that has photos. Both
--   remove the rows at once (the site stops showing them) and queue ONE
--   delete_files job with exactly which files to remove from storage. The
--   worker removes them when it runs. Nothing here touches storage itself.
--
--   Which files. An original is removed only when no other photo row uses
--   the same path (a hand-made album can show a photograph that lives in
--   another gallery's folder). Derivatives live in a folder of their own per
--   photo (d/<gallery>/<photo>/, clients/_d/... for client galleries), or per
--   gallery when the whole gallery goes; those folders are removed whole.
--   Paths that do not look like either are left out, never guessed at.
--
--   The database copy. worker_backup_tables() tells the worker which tables
--   there are and how to read and restore them; worker_backup_users() which
--   logins there are (ids and emails, never passwords). The worker writes
--   the copy to the laptop and notes how it went on its workers row, which
--   the Studio shows.
--
--   The cover. A drop into a gallery without a cover made the first file to
--   FINISH the cover. When the worker settles the drop it now moves that to
--   the first file by NAME, unless the cover was changed in the meantime.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261116140000_upload_batch_settled.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261116170000', 'studio_delete_and_backup');

begin;

do $$
begin
  if to_regprocedure('public.worker_settle_batch(uuid)') is null then
    raise exception 'Run 20261116140000_upload_batch_settled.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- What a photo takes in storage: the original and its derivatives. The same
-- sum as the backfill of accounts.storage_used_bytes in 20261116090000, so
-- deleting gives back exactly what counting gave.
-- ---------------------------------------------------------------------------
create or replace function public.photo_stored_bytes(p public.photos)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select (
    coalesce(p.source_bytes, p.bytes, 0)
    + coalesce(p.delivery_bytes, 0)
    + coalesce(p.share_bytes, 0)
    + coalesce((
        select sum(
                 case when jsonb_typeof(v->'a') = 'number' then (v->>'a')::numeric else 0 end
               + case when jsonb_typeof(v->'p') = 'number' then (v->>'p')::numeric else 0 end)
          from jsonb_array_elements(case when jsonb_typeof(p.variants) = 'array' then p.variants else '[]'::jsonb end) v
      ), 0)
  )::bigint;
$$;

-- An original's path that may be deleted: inside a folder, no "..", no
-- empty segment, not a folder itself, not in a derivative root.
create or replace function public.is_original_path(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is not null
     and char_length(p_path) between 3 and 1024
     and p_path ~ '^[^/]+(/[^/]+)+$'
     and p_path !~ '(^|/)\.{1,2}(/|$)'
     and p_path !~ '^(d|clients/_d)/'
     and p_path !~ '[[:cntrl:]\\]';
$$;

-- ---------------------------------------------------------------------------
-- studio_delete_photos: some photos of one gallery, with their files.
-- Answers {"deleted": n, "files": originals to remove}.
-- ---------------------------------------------------------------------------
create or replace function public.studio_delete_photos(p_gallery_id uuid, p_photo_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g        record;
  v_root   text;
  v_ids    uuid[];
  v_gone   text[];
  v_paths  text[];
  v_dirs   text[];
  v_bytes  bigint;
  v_n      integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_photo_ids is null or cardinality(p_photo_ids) = 0 or cardinality(p_photo_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'studio:photos';
  end if;

  select x.id, x.slug, x.kind, x.account_id, x.cover_path
    into g
    from public.galleries x
   where x.id = p_gallery_id
     and x.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  v_root := case g.kind when 'album' then 'd' when 'client' then 'clients/_d' end;
  if v_root is null then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  -- Only photos of this gallery; anything else in the list is ignored.
  select array_agg(p.id), array_agg(p.storage_path), coalesce(sum(public.photo_stored_bytes(p)), 0)
    into v_ids, v_gone, v_bytes
    from public.photos p
   where p.gallery_id = g.id and p.id = any (p_photo_ids);
  if v_ids is null then
    return jsonb_build_object('deleted', 0, 'files', 0);
  end if;

  select coalesce(array_agg(distinct p.storage_path), '{}')
    into v_paths
    from public.photos p
   where p.id = any (v_ids)
     and public.is_original_path(p.storage_path)
     and not exists (
       select 1 from public.photos o
        where o.storage_path = p.storage_path and o.id <> all (v_ids)
     );
  v_dirs := array(select v_root || '/' || g.id || '/' || x || '/' from unnest(v_ids) x order by x);

  delete from public.photos p where p.id = any (v_ids);
  get diagnostics v_n = row_count;

  update public.accounts a
     set storage_used_bytes = greatest(a.storage_used_bytes - v_bytes, 0)
   where a.id = g.account_id;

  -- The cover went with them: the first photo left, or none.
  if g.cover_path = any (v_gone)
     and not exists (select 1 from public.photos p where p.gallery_id = g.id and p.storage_path = g.cover_path) then
    update public.galleries x
       set cover_path = (
         select p.storage_path from public.photos p
          where p.gallery_id = g.id
          order by p.sort_order, p.id
          limit 1)
     where x.id = g.id;
  end if;

  insert into public.jobs (kind, payload, max_attempts)
  values ('delete_files',
          jsonb_build_object(
            'account_id', g.account_id, 'gallery_id', g.id, 'slug', g.slug, 'kind', g.kind,
            'photos', v_n, 'paths', to_jsonb(v_paths), 'dirs', to_jsonb(v_dirs)),
          10);

  return jsonb_build_object('deleted', v_n, 'files', cardinality(v_paths));
end;
$$;

-- ---------------------------------------------------------------------------
-- studio_delete_gallery: now with its photos and their files.
--
-- Refused while one of its files is being built (studio:busy): the worker
-- would put that photo's files in storage after the gallery is gone. Files
-- still on their way are dropped with the gallery (the worker tidies its
-- copies). The uploads rows go with the gallery.
-- ---------------------------------------------------------------------------
create or replace function public.studio_delete_gallery(p_gallery_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g        record;
  v_root   text;
  v_paths  text[];
  v_bytes  bigint;
  v_n      integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  select x.id, x.slug, x.kind, x.account_id
    into g
    from public.galleries x
   where x.id = p_gallery_id
     and x.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  v_root := case g.kind when 'album' then 'd' when 'client' then 'clients/_d' end;

  -- Locked, so the worker cannot start building one of them meanwhile: it
  -- waits, then finds the file gone.
  perform 1 from public.uploads u
   where u.gallery_id = g.id and u.status in ('waiting', 'uploading', 'queued', 'processing')
     for update;
  if exists (select 1 from public.uploads u where u.gallery_id = g.id and u.status = 'processing') then
    raise exception using errcode = 'P0001', message = 'studio:busy';
  end if;
  update public.jobs j
     set status = 'cancelled', finished_at = now()
   where j.kind = 'process_upload' and j.status = 'queued'
     and (j.payload->>'upload_id')::uuid in (select u.id from public.uploads u where u.gallery_id = g.id);

  select coalesce(sum(public.photo_stored_bytes(p)), 0), count(*)
    into v_bytes, v_n
    from public.photos p where p.gallery_id = g.id;
  select coalesce(array_agg(distinct p.storage_path), '{}')
    into v_paths
    from public.photos p
   where p.gallery_id = g.id
     and public.is_original_path(p.storage_path)
     and not exists (
       select 1 from public.photos o where o.storage_path = p.storage_path and o.gallery_id <> g.id
     );

  delete from public.photos p where p.gallery_id = g.id;
  update public.accounts a
     set storage_used_bytes = greatest(a.storage_used_bytes - v_bytes, 0)
   where a.id = g.account_id;

  -- Named, not left to a cascade: whether gallery_access cascades was never
  -- written down in a migration.
  delete from public.gallery_access where gallery_id = g.id;
  delete from public.galleries where id = g.id;

  if v_n > 0 and v_root is not null then
    insert into public.jobs (kind, payload, max_attempts)
    values ('delete_files',
            jsonb_build_object(
              'account_id', g.account_id, 'gallery_id', g.id, 'slug', g.slug, 'kind', g.kind,
              'photos', v_n, 'paths', to_jsonb(v_paths),
              'dirs', jsonb_build_array(v_root || '/' || g.id || '/')),
            10);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Files still to be removed, for the Studio. Jobs are not readable by
-- members; this answers for their own accounts only.
--   {"waiting": photos whose files are still in storage,
--    "failed": photos whose files the worker gave up on, "error": its reason}
-- ---------------------------------------------------------------------------
create or replace function public.studio_storage_cleanup()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'waiting', coalesce(sum((j.payload->>'photos')::integer) filter (where j.status in ('queued', 'running')), 0),
    'failed',  coalesce(sum((j.payload->>'photos')::integer) filter (where j.status = 'failed'), 0),
    'error',   (select f.error from public.jobs f
                 where f.kind = 'delete_files' and f.status = 'failed'
                   and (f.payload->>'account_id')::uuid in (select public.my_account_ids())
                 order by f.finished_at desc nulls last limit 1)
  )
  from public.jobs j
  where j.kind = 'delete_files'
    and j.status in ('queued', 'running', 'failed')
    and (j.payload->>'account_id')::uuid in (select public.my_account_ids());
$$;

-- Try the given-up removals again. Answers how many photos' files.
create or replace function public.studio_retry_cleanup()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  with r as (
    update public.jobs j
       set status = 'queued', attempts = 0, run_after = now(), error = null,
           claimed_by = null, claimed_at = null, heartbeat_at = null, finished_at = null
     where j.kind = 'delete_files' and j.status = 'failed'
       and (j.payload->>'account_id')::uuid in (select public.my_account_ids())
    returning (j.payload->>'photos')::integer as n
  )
  select coalesce(sum(r.n), 0) into v_n from r;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The cover a drop sets: the first file by name, not the first to finish.
-- ---------------------------------------------------------------------------
alter table public.upload_batches add column if not exists had_cover boolean;

comment on column public.upload_batches.had_cover is
  'Whether the gallery had a cover when the drop began. NULL for drops from before 20261116170000.';

create or replace function public.upload_batches_note_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.had_cover := exists (
    select 1 from public.galleries g where g.id = new.gallery_id and g.cover_path is not null
  );
  return new;
end;
$$;

drop trigger if exists upload_batches_note_cover on public.upload_batches;
create trigger upload_batches_note_cover
  before insert on public.upload_batches
  for each row execute function public.upload_batches_note_cover();

-- Same name and answer as in 20261116140000; now also the cover.
create or replace function public.worker_settle_batch(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  b             record;
  v_first_done  text;
  v_first_named text;
begin
  select x.id, x.gallery_id, x.status, x.had_cover
    into b
    from public.upload_batches x
   where x.id = p_batch_id
     for update;
  if not found or b.status <> 'done' then
    return false;
  end if;

  -- The gallery had no cover, so the first file of this drop to finish
  -- became it. If it still is, the first by name (the gallery is already in
  -- file-name order) takes over. Changed meanwhile = chosen: left alone.
  if b.had_cover is false then
    select p.storage_path into v_first_done
      from public.uploads u join public.photos p on p.id = u.photo_id
     where u.batch_id = b.id and u.status = 'ready'
     order by u.finished_at, u.id
     limit 1;
    select p.storage_path into v_first_named
      from public.uploads u join public.photos p on p.id = u.photo_id
     where u.batch_id = b.id and u.status = 'ready'
     order by p.sort_order, p.id
     limit 1;
    if v_first_done is not null and v_first_named is not null and v_first_done <> v_first_named then
      update public.galleries g
         set cover_path = v_first_named
       where g.id = b.gallery_id and g.cover_path = v_first_done;
    end if;
  end if;

  update public.upload_batches x set settled_at = now() where x.id = b.id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The database copy.
-- ---------------------------------------------------------------------------

-- How it went, per worker. Members read these too (the Uploads page).
alter table public.workers
  add column if not exists backup_at     timestamptz,
  add column if not exists backup_bytes  bigint check (backup_bytes is null or backup_bytes >= 0),
  add column if not exists backup_tables integer check (backup_tables is null or backup_tables >= 0),
  add column if not exists backup_error  text check (backup_error is null or char_length(backup_error) <= 500);

grant select (backup_at, backup_bytes, backup_tables, backup_error) on public.workers to authenticated;

-- Every table of the public schema, in a form the worker can read and the
-- restore script can write back: its columns, primary key, columns it must
-- not write (generated, or identity ALWAYS), the tables it points at
-- (restored first), and the columns that hold a login's id (mapped by email
-- when the logins were made again with new ids).
drop function if exists public.worker_backup_tables();
create function public.worker_backup_tables()
returns table (
  table_name        text,
  columns           text[],
  primary_key       text[],
  generated         text[],
  depends_on        text[],
  auth_user_columns text[],
  approx_rows       bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    coalesce((
      select array_agg(a.attname::text order by a.attnum)
        from pg_catalog.pg_attribute a
       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    ), '{}'),
    coalesce((
      select array_agg(a.attname::text order by k.ord)
        from pg_catalog.pg_constraint pk
        cross join lateral unnest(pk.conkey) with ordinality as k(attnum, ord)
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
       where pk.conrelid = c.oid and pk.contype = 'p'
    ), '{}'),
    coalesce((
      select array_agg(a.attname::text order by a.attnum)
        from pg_catalog.pg_attribute a
       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         and (a.attgenerated <> '' or a.attidentity = 'a')
    ), '{}'),
    coalesce((
      select array_agg(distinct f.relname::text)
        from pg_catalog.pg_constraint fk
        join pg_catalog.pg_class f on f.oid = fk.confrelid
        join pg_catalog.pg_namespace fn on fn.oid = f.relnamespace
       where fk.conrelid = c.oid and fk.contype = 'f' and fn.nspname = 'public' and f.oid <> c.oid
    ), '{}'),
    coalesce((
      select array_agg(distinct a.attname::text)
        from pg_catalog.pg_constraint fk
        join pg_catalog.pg_class f on f.oid = fk.confrelid
        join pg_catalog.pg_namespace fn on fn.oid = f.relnamespace
        cross join lateral unnest(fk.conkey) as k(attnum)
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
       where fk.conrelid = c.oid and fk.contype = 'f' and fn.nspname = 'auth' and f.relname = 'users'
    ), '{}'),
    greatest(c.reltuples, 0)::bigint
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
  order by c.relname;
$$;

-- The logins: id and email only. Passwords never leave Supabase Auth.
create or replace function public.worker_backup_users()
returns table (id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.created_at from auth.users u order by u.created_at, u.id;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function
  public.photo_stored_bytes(public.photos),
  public.is_original_path(text),
  public.upload_batches_note_cover(),
  public.worker_settle_batch(uuid),
  public.worker_backup_tables(),
  public.worker_backup_users()
  from public, anon, authenticated;
grant execute on function
  public.worker_settle_batch(uuid),
  public.worker_backup_tables(),
  public.worker_backup_users()
  to service_role;

revoke all on function
  public.studio_delete_photos(uuid, uuid[]),
  public.studio_delete_gallery(uuid),
  public.studio_storage_cleanup(),
  public.studio_retry_cleanup()
  from public, anon;
grant execute on function
  public.studio_delete_photos(uuid, uuid[]),
  public.studio_delete_gallery(uuid),
  public.studio_storage_cleanup(),
  public.studio_retry_cleanup()
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- Checks, read-only. Run after the file.
--
--   select proname from pg_proc
--    where proname in ('studio_delete_photos', 'studio_delete_gallery', 'studio_storage_cleanup',
--                      'studio_retry_cleanup', 'worker_backup_tables', 'worker_backup_users',
--                      'photo_stored_bytes', 'is_original_path')
--    order by 1;
--
--   -- files waiting to be removed, per state
--   select status, count(*), sum((payload->>'photos')::int) as photos
--     from public.jobs where kind = 'delete_files' group by status;
--
--   -- the last database copy
--   select name, backup_at, pg_size_pretty(backup_bytes), backup_tables, backup_error
--     from public.workers;
--
-- UNDO (puts step 6 back to "empty galleries only"; the copies on the laptop
-- stay). Run this, then run 20261115100000_studio_gallery_writes.sql and
-- 20261116140000_upload_batch_settled.sql again (both re-runnable): they put
-- back the earlier studio_delete_gallery and worker_settle_batch.
--   begin;
--   drop function if exists public.studio_delete_photos(uuid, uuid[]);
--   drop function if exists public.studio_storage_cleanup();
--   drop function if exists public.studio_retry_cleanup();
--   drop function if exists public.worker_backup_tables();
--   drop function if exists public.worker_backup_users();
--   drop trigger if exists upload_batches_note_cover on public.upload_batches;
--   drop function if exists public.upload_batches_note_cover();
--   alter table public.upload_batches drop column if exists had_cover;
--   alter table public.workers drop column if exists backup_at, drop column if exists backup_bytes,
--     drop column if exists backup_tables, drop column if exists backup_error;
--   drop function if exists public.is_original_path(text);
--   drop function if exists public.photo_stored_bytes(public.photos);
--   delete from supabase_migrations.schema_migrations where version = '20261116170000';
--   commit;
--   -- queued delete_files jobs stay in jobs; an older worker leaves them alone.
-- ---------------------------------------------------------------------------
