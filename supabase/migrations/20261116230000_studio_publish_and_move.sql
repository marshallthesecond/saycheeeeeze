-- Step 7 of the admin panel: publishing client photos, moving photos between
-- public galleries, and turning a private gallery into a Portfolio album,
-- all as changes to rows. No file is copied or moved in storage.
--
-- WHY THIS WORKS. Until now the site worked out where a photo's derivatives
-- are from its gallery: d/<gallery>/<photo>/ for an album,
-- clients/_d/<gallery>/<photo>/ for a client gallery. So a photo could not
-- change gallery without its files changing place. Now each row says where
-- its files are (photos.files_at), set once when the row is made, and pages
-- build addresses from that. Moving a row moves nothing else.
--
-- A photo whose files are under clients/ stays there when it is published.
-- The public pull zone refuses anything under /clients/, so public pages
-- show such a photo through the private pull zone with a link signed for
-- that one photo's folder (src/lib/photo-files.ts). Nothing else in the
-- client's gallery is opened by it.
--
--   studio_publish_photos(from, ids, to)   client gallery -> album. The photos
--                                          STAY in the client gallery too:
--                                          new rows, same files.
--   studio_move_photos(from, ids, to)      album -> album. The rows move.
--   studio_set_gallery_public(g, on, cat)  client gallery <-> Portfolio album.
--                                          Its passkeys stay for when it goes
--                                          back. Only a gallery that started
--                                          private can be switched back.
--
-- Nothing ever goes INTO a client gallery except by upload: both functions
-- refuse a client gallery as the target.
--
-- Deleting knows that files can be shared now: a photo's files go only when
-- no other row still uses them, and only then is storage counted down.
--
-- workers.remote says whether the worker can be reached from other devices
-- (a tunnel, step 7), without showing members its address.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261116170000_studio_delete_and_backup.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261116230000', 'studio_publish_and_move');

begin;

do $$
begin
  if to_regprocedure('public.studio_delete_photos(uuid, uuid[])') is null then
    raise exception 'Run 20261116170000_studio_delete_and_backup.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Where a photo's files are
-- ---------------------------------------------------------------------------

-- The folder a new photo's derivatives go in, as the worker and
-- build-ladder.mjs have always chosen it.
create or replace function public.photo_files_dir(p_kind text, p_gallery uuid, p_photo uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_kind = 'client' then 'clients/_d' else 'd' end || '/' || p_gallery || '/' || p_photo;
$$;

alter table public.photos add column if not exists files_at text;

update public.photos p
   set files_at = public.photo_files_dir(g.kind, p.gallery_id, p.id)
  from public.galleries g
 where g.id = p.gallery_id
   and p.files_at is null;

-- Every writer (the worker, reseed.ts, /api/sync, hand SQL) gets it right
-- without knowing about it: filled in from the gallery when not given.
create or replace function public.photos_fill_files_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.files_at is null then
    select g.kind into v_kind from public.galleries g where g.id = new.gallery_id;
    new.files_at := public.photo_files_dir(coalesce(v_kind, 'album'), new.gallery_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists photos_fill_files_at on public.photos;
create trigger photos_fill_files_at
  before insert on public.photos
  for each row execute function public.photos_fill_files_at();

alter table public.photos alter column files_at set not null;
alter table public.photos drop constraint if exists photos_files_at_shape;
alter table public.photos add constraint photos_files_at_shape check (
  files_at ~ '^(d|clients/_d)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

create index if not exists photos_files_at_idx on public.photos (files_at);
create index if not exists photos_storage_path_idx on public.photos (storage_path);

comment on column public.photos.files_at is
  'Folder of this photo''s derivatives, set when the row is made. Rows published from a client gallery share it with the row they came from.';

-- The private folder a gallery had before it was made a Portfolio album,
-- for when it goes back.
alter table public.galleries add column if not exists client_folder text;

comment on column public.galleries.client_folder is
  'Set while a gallery that started as a client gallery is a Portfolio album: the clients/ folder it goes back to.';

-- Reachable from other devices: the worker's door is not this computer only.
alter table public.workers add column if not exists remote boolean
  generated always as (
    upload_url is not null and upload_url !~* '^http://(127\.0\.0\.1|localhost|\[::1\])(:|/|$)'
  ) stored;
grant select (remote) on public.workers to authenticated;

-- ---------------------------------------------------------------------------
-- An album folder for a category, the way studio_create_gallery makes one:
-- the category's spelling already in use wins, d/ clients/ u/ are refused,
-- and a folder another gallery has gets -2, -3.
-- ---------------------------------------------------------------------------
create or replace function public.studio_album_folder(p_account_id uuid, p_category text, p_slug text, p_except uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_prefix   text;
  v_root     text;
  v_category text := regexp_replace(btrim(coalesce(p_category, '')), '\s+', ' ', 'g');
  v_existing text;
  v_folder   text;
  v_try      text;
  v_n        integer := 1;
begin
  select a.storage_prefix into v_prefix from public.accounts a where a.id = p_account_id;
  v_root := case when coalesce(v_prefix, '') = '' then '' else rtrim(v_prefix, '/') || '/' end;

  if v_category !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,38}[A-Za-z0-9]$' then
    raise exception using errcode = 'P0001', message = 'studio:category_format';
  end if;
  if lower(v_category) in ('d', 'clients', 'u') then
    raise exception using errcode = 'P0001', message = 'studio:category_reserved';
  end if;

  select split_part(substr(g.bunny_folder, char_length(v_root) + 1), '/', 1) into v_existing
    from public.galleries g
   where g.account_id = p_account_id
     and g.kind = 'album'
     and g.bunny_folder is not null
     and left(g.bunny_folder, char_length(v_root)) = v_root
     and lower(split_part(substr(g.bunny_folder, char_length(v_root) + 1), '/', 1)) = lower(v_category)
   order by g.created_at
   limit 1;
  if v_existing is not null and v_existing <> '' then
    v_category := v_existing;
  end if;

  v_folder := v_root || v_category || '/' || p_slug;
  v_try := v_folder;
  while exists (
    select 1 from public.galleries g
     where lower(g.bunny_folder) = lower(v_try) and g.id is distinct from p_except
  ) loop
    v_n := v_n + 1;
    v_try := v_folder || '-' || v_n;
  end loop;
  return v_try;
end;
$$;

-- ---------------------------------------------------------------------------
-- The two galleries of a publish or a move, locked in a fixed order so two
-- moves the other way round cannot wait on each other.
-- ---------------------------------------------------------------------------
create or replace function public.studio_lock_pair(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform 1 from public.galleries g
   where g.id in (p_from, p_to)
     and g.account_id in (select public.my_account_ids())
   order by g.id
     for update;
end;
$$;

-- ---------------------------------------------------------------------------
-- studio_publish_photos: photos of a client gallery into an album. They stay
-- in the client gallery; the album gets rows of its own that point at the
-- same files. One already in the album (same file) is skipped.
-- Answers {"added": n, "skipped": n}.
-- ---------------------------------------------------------------------------
create or replace function public.studio_publish_photos(p_from uuid, p_photo_ids uuid[], p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  f        record;
  t        record;
  v_base   integer;
  v_cols   text;
  v_select text;
  v_found  integer;
  v_n      integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_photo_ids is null or cardinality(p_photo_ids) = 0 or cardinality(p_photo_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'studio:photos';
  end if;
  if p_from is not distinct from p_to then
    raise exception using errcode = 'P0001', message = 'studio:same_gallery';
  end if;

  perform public.studio_lock_pair(p_from, p_to);
  select g.id, g.kind, g.account_id, g.cover_path into t
    from public.galleries g
   where g.id = p_to and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  select g.id, g.kind, g.account_id into f
    from public.galleries g
   where g.id = p_from and g.account_id = t.account_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  if t.kind <> 'album' then
    raise exception using errcode = 'P0001', message = 'studio:target_private';
  end if;
  if f.kind <> 'client' then
    -- From an album the photos move instead: studio_move_photos.
    raise exception using errcode = 'P0001', message = 'studio:from_public';
  end if;

  select count(*) into v_found from public.photos p where p.gallery_id = f.id and p.id = any (p_photo_ids);
  v_base := coalesce((select max(p.sort_order) from public.photos p where p.gallery_id = t.id), -1) + 1;

  -- Every column of the row, whatever the table has grown since, except the
  -- ones that belong to the new row or to the client gallery: its id, place
  -- and time, the client's mark, the upload that made the original, the
  -- worker's bookkeeping, and what Postgres computes.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg('p.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols, v_select
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'photos'
     and c.is_generated = 'NEVER' and c.identity_generation is null
     and c.column_name not in ('id', 'gallery_id', 'sort_order', 'created_at', 'updated_at', 'upload_id',
                               'client_mark', 'client_marked_at', 'claimed_at', 'error', 'attempts');

  execute format(
    'insert into public.photos (gallery_id, sort_order, %s)
     select $1, $2 + (row_number() over (order by p.sort_order, p.id))::integer - 1, %s
       from public.photos p
      where p.gallery_id = $3 and p.id = any ($4)
        and not exists (select 1 from public.photos q where q.gallery_id = $1 and q.storage_path = p.storage_path)
     on conflict do nothing',
    v_cols, v_select)
  using t.id, v_base, f.id, p_photo_ids;
  get diagnostics v_n = row_count;

  if t.cover_path is null and v_n > 0 then
    update public.galleries g
       set cover_path = (select p.storage_path from public.photos p
                          where p.gallery_id = t.id order by p.sort_order, p.id limit 1)
     where g.id = t.id;
  end if;

  return jsonb_build_object('added', v_n, 'skipped', v_found - v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- studio_move_photos: photos from one album to another. The rows move; one
-- whose file the target already has stays where it is and is counted as
-- skipped. Answers {"moved": n, "skipped": n}.
-- ---------------------------------------------------------------------------
create or replace function public.studio_move_photos(p_from uuid, p_photo_ids uuid[], p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  f       record;
  t       record;
  v_base  integer;
  v_found integer;
  v_n     integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_photo_ids is null or cardinality(p_photo_ids) = 0 or cardinality(p_photo_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'studio:photos';
  end if;
  if p_from is not distinct from p_to then
    raise exception using errcode = 'P0001', message = 'studio:same_gallery';
  end if;

  perform public.studio_lock_pair(p_from, p_to);
  select g.id, g.kind, g.account_id, g.cover_path into t
    from public.galleries g
   where g.id = p_to and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  select g.id, g.kind, g.account_id, g.cover_path into f
    from public.galleries g
   where g.id = p_from and g.account_id = t.account_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  if t.kind <> 'album' then
    raise exception using errcode = 'P0001', message = 'studio:target_private';
  end if;
  if f.kind <> 'album' then
    -- Out of a client gallery a photo is published, never moved: the client
    -- keeps it.
    raise exception using errcode = 'P0001', message = 'studio:from_private';
  end if;

  select count(*) into v_found from public.photos p where p.gallery_id = f.id and p.id = any (p_photo_ids);
  v_base := coalesce((select max(p.sort_order) from public.photos p where p.gallery_id = t.id), -1) + 1;

  with moving as (
    select p.id, row_number() over (order by p.sort_order, p.id) as rn
      from public.photos p
     where p.gallery_id = f.id and p.id = any (p_photo_ids)
       and not exists (select 1 from public.photos q where q.gallery_id = t.id and q.storage_path = p.storage_path)
  )
  update public.photos p
     set gallery_id = t.id, sort_order = v_base + m.rn::integer - 1
    from moving m
   where p.id = m.id;
  get diagnostics v_n = row_count;

  -- The source's cover left with them: its first photo left, or none.
  if f.cover_path is not null
     and not exists (select 1 from public.photos p where p.gallery_id = f.id and p.storage_path = f.cover_path) then
    update public.galleries g
       set cover_path = (select p.storage_path from public.photos p
                          where p.gallery_id = f.id order by p.sort_order, p.id limit 1)
     where g.id = f.id;
  end if;
  if t.cover_path is null and v_n > 0 then
    update public.galleries g
       set cover_path = (select p.storage_path from public.photos p
                          where p.gallery_id = t.id order by p.sort_order, p.id limit 1)
     where g.id = t.id;
  end if;

  return jsonb_build_object('moved', v_n, 'skipped', v_found - v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- studio_set_gallery_public: a client gallery becomes a Portfolio album (on)
-- or goes back (off).
--
-- On: listed in the Portfolio under p_category, no passkey asked. New
-- uploads go to a public folder; the photos already there keep their files
-- where they are. Off: private again with the folder and passkeys it had.
-- Only a gallery that started private can go back: an album made as one has
-- its files in public folders. Refused while a file is being built
-- (studio:busy), so the worker never builds into the side it left.
-- Answers {"kind": "album"|"client", "folder": ...}.
-- ---------------------------------------------------------------------------
create or replace function public.studio_set_gallery_public(p_gallery_id uuid, p_public boolean, p_category text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g        record;
  v_folder text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  select x.id, x.slug, x.kind, x.account_id, x.bunny_folder, x.client_folder into g
    from public.galleries x
   where x.id = p_gallery_id
     and x.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  perform 1 from public.uploads u
   where u.gallery_id = g.id and u.status in ('waiting', 'uploading', 'queued', 'processing')
     for update;
  if exists (select 1 from public.uploads u where u.gallery_id = g.id and u.status = 'processing') then
    raise exception using errcode = 'P0001', message = 'studio:busy';
  end if;

  if coalesce(p_public, false) then
    if g.kind <> 'client' then
      raise exception using errcode = 'P0001', message = 'studio:already_public';
    end if;
    v_folder := public.studio_album_folder(g.account_id, p_category, g.slug, g.id);
    update public.galleries x
       set kind = 'album',
           visibility = 'public',
           is_listed = true,
           client_folder = coalesce(x.client_folder, x.bunny_folder),
           bunny_folder = v_folder
     where x.id = g.id;
    return jsonb_build_object('kind', 'album', 'folder', v_folder);
  end if;

  if g.kind <> 'album' or g.client_folder is null then
    raise exception using errcode = 'P0001', message = 'studio:not_private_origin';
  end if;
  update public.galleries x
     set kind = 'client',
         visibility = 'private',
         is_listed = false,
         bunny_folder = x.client_folder,
         client_folder = null
   where x.id = g.id;
  return jsonb_build_object('kind', 'client', 'folder', g.client_folder);
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting, now that files can be shared between rows.
-- ---------------------------------------------------------------------------
create or replace function public.studio_delete_photos(p_gallery_id uuid, p_photo_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g       record;
  v_ids   uuid[];
  v_gone  text[];
  v_paths text[];
  v_dirs  text[];
  v_bytes bigint;
  v_n     integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_photo_ids is null or cardinality(p_photo_ids) = 0 or cardinality(p_photo_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'studio:photos';
  end if;

  select x.id, x.slug, x.kind, x.account_id, x.cover_path into g
    from public.galleries x
   where x.id = p_gallery_id
     and x.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  select array_agg(p.id), array_agg(p.storage_path) into v_ids, v_gone
    from public.photos p
   where p.gallery_id = g.id and p.id = any (p_photo_ids);
  if v_ids is null then
    return jsonb_build_object('deleted', 0, 'files', 0);
  end if;

  -- Originals and derivative folders no other row uses. A file shared with
  -- another gallery (a published photo, a hand-made album) stays, and so
  -- does what it takes in storage.
  select coalesce(array_agg(distinct p.storage_path), '{}') into v_paths
    from public.photos p
   where p.id = any (v_ids)
     and public.is_original_path(p.storage_path)
     and not exists (select 1 from public.photos o where o.storage_path = p.storage_path and o.id <> all (v_ids));
  select coalesce(array_agg(d.files_at || '/' order by d.files_at), '{}'),
         coalesce(sum(d.bytes), 0)
    into v_dirs, v_bytes
    from (
      select distinct on (p.files_at) p.files_at, public.photo_stored_bytes(p) as bytes
        from public.photos p
       where p.id = any (v_ids)
         and not exists (select 1 from public.photos o where o.files_at = p.files_at and o.id <> all (v_ids))
       order by p.files_at, p.id
    ) d;

  delete from public.photos p where p.id = any (v_ids);
  get diagnostics v_n = row_count;

  update public.accounts a
     set storage_used_bytes = greatest(a.storage_used_bytes - v_bytes, 0)
   where a.id = g.account_id;

  if g.cover_path = any (v_gone)
     and not exists (select 1 from public.photos p where p.gallery_id = g.id and p.storage_path = g.cover_path) then
    update public.galleries x
       set cover_path = (select p.storage_path from public.photos p
                          where p.gallery_id = g.id order by p.sort_order, p.id limit 1)
     where x.id = g.id;
  end if;

  if cardinality(v_paths) + cardinality(v_dirs) > 0 then
    insert into public.jobs (kind, payload, max_attempts)
    values ('delete_files',
            jsonb_build_object(
              'account_id', g.account_id, 'gallery_id', g.id, 'slug', g.slug, 'kind', g.kind,
              'photos', v_n, 'paths', to_jsonb(v_paths), 'dirs', to_jsonb(v_dirs)),
            10);
  end if;

  return jsonb_build_object('deleted', v_n, 'files', cardinality(v_paths));
end;
$$;

create or replace function public.studio_delete_gallery(p_gallery_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  g       record;
  v_paths text[];
  v_dirs  text[];
  v_bytes bigint;
  v_n     integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  select x.id, x.slug, x.kind, x.account_id into g
    from public.galleries x
   where x.id = p_gallery_id
     and x.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

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

  select count(*) into v_n from public.photos p where p.gallery_id = g.id;
  select coalesce(array_agg(distinct p.storage_path), '{}') into v_paths
    from public.photos p
   where p.gallery_id = g.id
     and public.is_original_path(p.storage_path)
     and not exists (select 1 from public.photos o where o.storage_path = p.storage_path and o.gallery_id <> g.id);
  -- Per photo now, not the gallery's whole folder: photos moved out of this
  -- gallery earlier still have their files in it.
  select coalesce(array_agg(d.files_at || '/' order by d.files_at), '{}'),
         coalesce(sum(d.bytes), 0)
    into v_dirs, v_bytes
    from (
      select distinct on (p.files_at) p.files_at, public.photo_stored_bytes(p) as bytes
        from public.photos p
       where p.gallery_id = g.id
         and not exists (select 1 from public.photos o where o.files_at = p.files_at and o.gallery_id <> g.id)
       order by p.files_at, p.id
    ) d;

  delete from public.photos p where p.gallery_id = g.id;
  update public.accounts a
     set storage_used_bytes = greatest(a.storage_used_bytes - v_bytes, 0)
   where a.id = g.account_id;

  delete from public.gallery_access where gallery_id = g.id;
  delete from public.galleries where id = g.id;

  if cardinality(v_paths) + cardinality(v_dirs) > 0 then
    insert into public.jobs (kind, payload, max_attempts)
    values ('delete_files',
            jsonb_build_object(
              'account_id', g.account_id, 'gallery_id', g.id, 'slug', g.slug, 'kind', g.kind,
              'photos', v_n, 'paths', to_jsonb(v_paths), 'dirs', to_jsonb(v_dirs)),
            10);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function
  public.photo_files_dir(text, uuid, uuid),
  public.photos_fill_files_at(),
  public.studio_album_folder(uuid, text, text, uuid),
  public.studio_lock_pair(uuid, uuid)
  from public, anon, authenticated;

revoke all on function
  public.studio_publish_photos(uuid, uuid[], uuid),
  public.studio_move_photos(uuid, uuid[], uuid),
  public.studio_set_gallery_public(uuid, boolean, text),
  public.studio_delete_photos(uuid, uuid[]),
  public.studio_delete_gallery(uuid)
  from public, anon;
grant execute on function
  public.studio_publish_photos(uuid, uuid[], uuid),
  public.studio_move_photos(uuid, uuid[], uuid),
  public.studio_set_gallery_public(uuid, boolean, text),
  public.studio_delete_photos(uuid, uuid[]),
  public.studio_delete_gallery(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- Checks, read-only. Run after the file.
--
--   -- every photo knows where its files are
--   select count(*) filter (where files_at is null) as missing, count(*) from public.photos;
--
--   -- photos shown in more than one gallery (published from a client gallery)
--   select files_at, count(*) from public.photos group by files_at having count(*) > 1;
--
--   -- galleries that started private and are Portfolio albums now
--   select slug, bunny_folder, client_folder from public.galleries where client_folder is not null;
--
-- UNDO. Only before anything was published, moved or switched: after that,
-- rows point at files their gallery alone no longer explains, and dropping
-- files_at would break them. Then run 20261116170000_studio_delete_and_backup.sql
-- again for the delete functions.
--   begin;
--   drop function if exists public.studio_publish_photos(uuid, uuid[], uuid);
--   drop function if exists public.studio_move_photos(uuid, uuid[], uuid);
--   drop function if exists public.studio_set_gallery_public(uuid, boolean, text);
--   drop function if exists public.studio_album_folder(uuid, text, text, uuid);
--   drop function if exists public.studio_lock_pair(uuid, uuid);
--   drop trigger if exists photos_fill_files_at on public.photos;
--   drop function if exists public.photos_fill_files_at();
--   alter table public.photos drop constraint if exists photos_files_at_shape;
--   drop index if exists public.photos_files_at_idx;
--   drop index if exists public.photos_storage_path_idx;
--   alter table public.photos drop column if exists files_at;
--   drop function if exists public.photo_files_dir(text, uuid, uuid);
--   alter table public.galleries drop column if exists client_folder;
--   alter table public.workers drop column if exists remote;
--   delete from supabase_migrations.schema_migrations where version = '20261116230000';
--   commit;
-- ---------------------------------------------------------------------------
