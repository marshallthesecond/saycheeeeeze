-- Sets inside a gallery (Marshall, 2026-11-21): a gallery can be divided into
-- up to 10 sets, each with a label ("Ceremony", "Party"). On the gallery's
-- page the sets are tabs; a gallery with no sets looks as before. The Studio
-- moves photos between sets with a button on each photo and by dragging them
-- onto a set's tab.
--
--   gallery_sets          new. id, gallery, label, position (0 first).
--   photos.set_id         new. The set the photo is in. Null when its gallery
--                         has no sets. While a gallery has sets, every one of
--                         its photos is in one of them: a trigger puts a new
--                         photo, or one moved or published into the gallery,
--                         into its first set (or the set its upload was made
--                         for).
--   upload_batches.set_id new. The set a drop of files is for: the set open
--                         in the Studio when the files were dropped.
--
--   studio_create_sets(gallery, labels)     add sets at the end; the first
--                                           sets of a gallery take its photos
--   studio_rename_set(set, label)
--   studio_move_set(set, position)          another place in the order
--   studio_delete_set(set, move_to)         its photos go to another set
--   studio_remove_sets(gallery)             back to one list of photos
--   studio_move_photos_to_set(gallery, photos, set)
--   studio_set_batch_set(batch, set)        uploads for the open set
--
-- Visitors read the sets of a gallery they can read (published, public).
-- Client galleries are read with the service key.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261121120000_photo_details.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261122120000', 'gallery_sets');

begin;

do $$
begin
  if to_regprocedure('public.my_account_ids()') is null then
    raise exception 'Run 20261114190000_accounts_and_members.sql first.';
  end if;
  if to_regclass('public.upload_batches') is null then
    raise exception 'Run 20261116090000_studio_uploads.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

-- A label is fine when it is trimmed, 1 to 40 characters, with no control
-- characters.
create or replace function public.set_label_ok(p_label text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_label is not null
     and p_label = btrim(p_label)
     and length(p_label) between 1 and 40
     and p_label !~ '[[:cntrl:]]'
$$;

create table if not exists public.gallery_sets (
  id         uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  label      text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  constraint gallery_sets_label_ok check (public.set_label_ok(label))
);

-- Two sets of one gallery never have the same label, whatever the case.
create unique index if not exists gallery_sets_label_unique on public.gallery_sets (gallery_id, lower(label));
create index if not exists gallery_sets_gallery_idx on public.gallery_sets (gallery_id, position);

-- At most 10 sets in a gallery, whoever inserts them.
create or replace function public.gallery_sets_at_most_ten()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.gallery_sets s where s.gallery_id = new.gallery_id) >= 10 then
    raise exception using errcode = 'P0001', message = 'studio:sets_full';
  end if;
  return new;
end;
$$;

drop trigger if exists gallery_sets_at_most_ten on public.gallery_sets;
create trigger gallery_sets_at_most_ten
  before insert on public.gallery_sets
  for each row execute function public.gallery_sets_at_most_ten();

alter table public.gallery_sets enable row level security;

drop policy if exists "gallery_sets: visitors read sets of readable galleries" on public.gallery_sets;
create policy "gallery_sets: visitors read sets of readable galleries"
  on public.gallery_sets for select
  to anon, authenticated
  using (
    exists (
      select 1
        from public.galleries g
       where g.id = gallery_sets.gallery_id
         and g.is_published
         and g.visibility = 'public'
    )
  );

drop policy if exists "gallery_sets: members read their account" on public.gallery_sets;
create policy "gallery_sets: members read their account"
  on public.gallery_sets for select
  to authenticated
  using (
    exists (
      select 1
        from public.galleries g
       where g.id = gallery_sets.gallery_id
         and g.account_id in (select public.my_account_ids())
    )
  );

-- Written only through the studio_* functions below. Explicit, so it is the
-- same under the old and the new Supabase default for new tables.
-- service_role for the scripts and the worker's daily database copy.
revoke all on public.gallery_sets from public, anon, authenticated;
grant select on public.gallery_sets to anon, authenticated;
grant all on public.gallery_sets to service_role;

-- ---------------------------------------------------------------------------
-- photos.set_id, upload_batches.set_id
-- ---------------------------------------------------------------------------

alter table public.photos
  add column if not exists set_id uuid references public.gallery_sets(id) on delete set null;
create index if not exists photos_set_idx on public.photos (set_id) where set_id is not null;

alter table public.upload_batches
  add column if not exists set_id uuid references public.gallery_sets(id) on delete set null;

-- Keeps every photo in a set of its own gallery, while that gallery has sets:
--   an upload made for a set lands in it;
--   a set of another gallery (a photo moved or published here) is dropped;
--   no set, and the gallery has sets: its first set.
-- Also runs when a set is deleted (its photos' set_id is set to null by the
-- foreign key), which puts them in the first set that is left.
create or replace function public.photos_keep_set()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.set_id is null and new.upload_id is not null then
    new.set_id := (
      select b.set_id
        from public.uploads u
        join public.upload_batches b on b.id = u.batch_id
       where u.id = new.upload_id
    );
  end if;
  if new.set_id is not null
     and not exists (select 1 from public.gallery_sets s where s.id = new.set_id and s.gallery_id = new.gallery_id) then
    new.set_id := null;
  end if;
  if new.set_id is null then
    new.set_id := (
      select s.id
        from public.gallery_sets s
       where s.gallery_id = new.gallery_id
       order by s.position, s.created_at, s.id
       limit 1
    );
  end if;
  return new;
end;
$$;

revoke all on function public.photos_keep_set() from public, anon, authenticated;

drop trigger if exists photos_keep_set on public.photos;
create trigger photos_keep_set
  before insert or update of gallery_id, set_id on public.photos
  for each row execute function public.photos_keep_set();

-- ---------------------------------------------------------------------------
-- Helpers for the functions below
-- ---------------------------------------------------------------------------

-- The gallery, if it is the signed-in member's; locked, so two changes to
-- its sets at the same moment take turns.
create or replace function public.studio_own_gallery(p_gallery_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  select g.id into v_id
    from public.galleries g
   where g.id = p_gallery_id
     and g.account_id in (select public.my_account_ids())
     for update;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  return v_id;
end;
$$;

revoke all on function public.studio_own_gallery(uuid) from public, anon, authenticated;

-- The set's gallery, if it is the signed-in member's (locked, as above).
create or replace function public.studio_own_set(p_set_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  select s.gallery_id into v_gallery
    from public.gallery_sets s
    join public.galleries g on g.id = s.gallery_id
   where s.id = p_set_id
     and g.account_id in (select public.my_account_ids());
  if v_gallery is null then
    raise exception using errcode = 'P0001', message = 'studio:set_not_found';
  end if;
  perform 1 from public.galleries g where g.id = v_gallery for update;
  return v_gallery;
end;
$$;

revoke all on function public.studio_own_set(uuid) from public, anon, authenticated;

-- Positions 0, 1, 2... in the order they are in now.
create or replace function public.gallery_sets_renumber(p_gallery_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.gallery_sets s
     set position = o.rn - 1
    from (select x.id, row_number() over (order by x.position, x.created_at, x.id) as rn
            from public.gallery_sets x
           where x.gallery_id = p_gallery_id) o
   where s.id = o.id and s.position is distinct from o.rn - 1;
$$;

revoke all on function public.gallery_sets_renumber(uuid) from public, anon, authenticated;

-- A gallery's sets in order, each with how many photos it has:
-- [{id, label, position, count}]
create or replace function public.gallery_sets_view(p_gallery_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'label', s.label, 'position', s.position,
           'count', (select count(*) from public.photos p where p.set_id = s.id))
         order by s.position, s.created_at, s.id), '[]'::jsonb)
    from public.gallery_sets s
   where s.gallery_id = p_gallery_id;
$$;

revoke all on function public.gallery_sets_view(uuid) from public, anon, authenticated;

-- A label for a set of this gallery: trimmed, the right length, and not the
-- label of another of its sets.
create or replace function public.studio_check_set_label(p_gallery_id uuid, p_label text, p_except uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
begin
  if not public.set_label_ok(v_label) then
    raise exception using errcode = 'P0001', message = 'studio:set_label';
  end if;
  if exists (select 1 from public.gallery_sets s
              where s.gallery_id = p_gallery_id and lower(s.label) = lower(v_label)
                and s.id is distinct from p_except) then
    raise exception using errcode = 'P0001', message = 'studio:set_label_taken';
  end if;
  return v_label;
end;
$$;

revoke all on function public.studio_check_set_label(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- studio_create_sets(gallery, labels): sets added at the end, in the order
-- given. When the gallery had no sets, all its photos go into the first one.
-- Answers with the gallery's sets.
-- ---------------------------------------------------------------------------

create or replace function public.studio_create_sets(p_gallery_id uuid, p_labels text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid := public.studio_own_gallery(p_gallery_id);
  v_had     integer;
  v_label   text;
  v_seen    text[] := '{}';
  v_next    integer;
begin
  if p_labels is null or cardinality(p_labels) = 0 then
    raise exception using errcode = 'P0001', message = 'studio:set_label';
  end if;
  select count(*), coalesce(max(s.position), -1) + 1 into v_had, v_next
    from public.gallery_sets s where s.gallery_id = v_gallery;
  if v_had + cardinality(p_labels) > 10 then
    raise exception using errcode = 'P0001', message = 'studio:sets_full';
  end if;

  foreach v_label in array p_labels loop
    v_label := public.studio_check_set_label(v_gallery, v_label, null);
    if lower(v_label) = any (v_seen) then
      raise exception using errcode = 'P0001', message = 'studio:set_label_taken';
    end if;
    v_seen := v_seen || lower(v_label);
    insert into public.gallery_sets (gallery_id, label, position) values (v_gallery, v_label, v_next);
    v_next := v_next + 1;
  end loop;

  -- Any photo of the gallery not in a set yet (all of them, the first time)
  -- goes into the first set: the trigger picks it.
  update public.photos p set set_id = null where p.gallery_id = v_gallery and p.set_id is null;

  return public.gallery_sets_view(v_gallery);
end;
$$;

revoke all on function public.studio_create_sets(uuid, text[]) from public, anon;
grant execute on function public.studio_create_sets(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_rename_set(set, label). Answers with the gallery's sets.
-- ---------------------------------------------------------------------------

create or replace function public.studio_rename_set(p_set_id uuid, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid := public.studio_own_set(p_set_id);
  v_label   text := public.studio_check_set_label(v_gallery, p_label, p_set_id);
begin
  update public.gallery_sets s set label = v_label where s.id = p_set_id;
  return public.gallery_sets_view(v_gallery);
end;
$$;

revoke all on function public.studio_rename_set(uuid, text) from public, anon;
grant execute on function public.studio_rename_set(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_move_set(set, position): the set goes to that place in the order
-- (0 first; past the end means last). Answers with the gallery's sets.
-- ---------------------------------------------------------------------------

create or replace function public.studio_move_set(p_set_id uuid, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid := public.studio_own_set(p_set_id);
  v_others  uuid[];
  v_to      integer;
begin
  if p_position is null then
    raise exception using errcode = 'P0001', message = 'studio:invalid';
  end if;
  -- The other sets in their order, and this one slotted in at v_to.
  select coalesce(array_agg(x.id order by x.position, x.created_at, x.id), '{}') into v_others
    from public.gallery_sets x
   where x.gallery_id = v_gallery and x.id <> p_set_id;
  v_to := greatest(0, least(p_position, cardinality(v_others)));
  v_others := v_others[1:v_to] || p_set_id || v_others[v_to + 1:];

  update public.gallery_sets s
     set position = o.n::integer - 1
    from unnest(v_others) with ordinality as o(id, n)
   where s.id = o.id and s.position is distinct from o.n::integer - 1;

  return public.gallery_sets_view(v_gallery);
end;
$$;

revoke all on function public.studio_move_set(uuid, integer) from public, anon;
grant execute on function public.studio_move_set(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_delete_set(set, move_to): its photos go to move_to (another set of
-- the same gallery; null: the first of the others). Deleting the last set
-- leaves the gallery without sets. Answers with the gallery's sets.
-- ---------------------------------------------------------------------------

create or replace function public.studio_delete_set(p_set_id uuid, p_move_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid := public.studio_own_set(p_set_id);
  v_to      uuid;
begin
  if p_move_to is not null then
    if p_move_to = p_set_id
       or not exists (select 1 from public.gallery_sets s where s.id = p_move_to and s.gallery_id = v_gallery) then
      raise exception using errcode = 'P0001', message = 'studio:set_target';
    end if;
    v_to := p_move_to;
  else
    v_to := (select s.id from public.gallery_sets s
              where s.gallery_id = v_gallery and s.id <> p_set_id
              order by s.position, s.created_at, s.id limit 1);
  end if;

  if v_to is not null then
    update public.photos p set set_id = v_to where p.set_id = p_set_id;
  end if;
  delete from public.gallery_sets s where s.id = p_set_id;
  perform public.gallery_sets_renumber(v_gallery);
  return public.gallery_sets_view(v_gallery);
end;
$$;

revoke all on function public.studio_delete_set(uuid, uuid) from public, anon;
grant execute on function public.studio_delete_set(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_remove_sets(gallery): every set goes; the photos stay, as one list.
-- Answers with how many sets were removed.
-- ---------------------------------------------------------------------------

create or replace function public.studio_remove_sets(p_gallery_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid := public.studio_own_gallery(p_gallery_id);
  v_n       integer;
begin
  -- The foreign key takes the photos out of the sets as they go; with no
  -- set left, the trigger leaves them in none.
  delete from public.gallery_sets s where s.gallery_id = v_gallery;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.studio_remove_sets(uuid) from public, anon;
grant execute on function public.studio_remove_sets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_move_photos_to_set(gallery, photos, set): up to 500 photos of the
-- gallery into one of its sets. Photos not in the gallery are ignored.
-- Answers with the gallery's sets.
-- ---------------------------------------------------------------------------

create or replace function public.studio_move_photos_to_set(p_gallery_id uuid, p_photo_ids uuid[], p_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid := public.studio_own_gallery(p_gallery_id);
begin
  if p_photo_ids is null or cardinality(p_photo_ids) = 0 or cardinality(p_photo_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'studio:photos';
  end if;
  if p_set_id is null
     or not exists (select 1 from public.gallery_sets s where s.id = p_set_id and s.gallery_id = v_gallery) then
    raise exception using errcode = 'P0001', message = 'studio:set_not_found';
  end if;
  update public.photos p
     set set_id = p_set_id
   where p.gallery_id = v_gallery
     and p.id = any (p_photo_ids)
     and p.set_id is distinct from p_set_id;
  return public.gallery_sets_view(v_gallery);
end;
$$;

revoke all on function public.studio_move_photos_to_set(uuid, uuid[], uuid) from public, anon;
grant execute on function public.studio_move_photos_to_set(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_set_batch_set(batch, set): the set a drop of files is for. Called
-- straight after the drop is made, before any file is sent. Null: none (the
-- gallery's first set, if it has sets).
-- ---------------------------------------------------------------------------

create or replace function public.studio_set_batch_set(p_batch_id uuid, p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gallery uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  select b.gallery_id into v_gallery
    from public.upload_batches b
   where b.id = p_batch_id
     and b.account_id in (select public.my_account_ids());
  if v_gallery is null then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  if p_set_id is not null
     and not exists (select 1 from public.gallery_sets s where s.id = p_set_id and s.gallery_id = v_gallery) then
    raise exception using errcode = 'P0001', message = 'studio:set_not_found';
  end if;
  update public.upload_batches b set set_id = p_set_id where b.id = p_batch_id;
end;
$$;

revoke all on function public.studio_set_batch_set(uuid, uuid) from public, anon;
grant execute on function public.studio_set_batch_set(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- Checks, any time after:
--
--   -- galleries with sets, and how many photos each set has
--   select g.slug, s.position, s.label, count(p.id) as photos
--     from public.gallery_sets s
--     join public.galleries g on g.id = s.gallery_id
--     left join public.photos p on p.set_id = s.id
--    group by g.slug, s.position, s.label order by g.slug, s.position;
--
--   -- should be none: a photo outside the sets of a gallery that has sets
--   select g.slug, count(*) from public.photos p join public.galleries g on g.id = p.gallery_id
--    where p.set_id is null and exists (select 1 from public.gallery_sets s where s.gallery_id = g.id)
--    group by g.slug;
--
-- UNDO. The sets are lost; every gallery goes back to one list of photos:
--   begin;
--   drop function if exists public.studio_set_batch_set(uuid, uuid);
--   drop function if exists public.studio_move_photos_to_set(uuid, uuid[], uuid);
--   drop function if exists public.studio_remove_sets(uuid);
--   drop function if exists public.studio_delete_set(uuid, uuid);
--   drop function if exists public.studio_move_set(uuid, integer);
--   drop function if exists public.studio_rename_set(uuid, text);
--   drop function if exists public.studio_create_sets(uuid, text[]);
--   drop function if exists public.studio_check_set_label(uuid, text, uuid);
--   drop function if exists public.gallery_sets_view(uuid);
--   drop function if exists public.gallery_sets_renumber(uuid);
--   drop function if exists public.studio_own_set(uuid);
--   drop function if exists public.studio_own_gallery(uuid);
--   drop trigger if exists photos_keep_set on public.photos;
--   drop function if exists public.photos_keep_set();
--   alter table public.upload_batches drop column if exists set_id;
--   alter table public.photos drop column if exists set_id;
--   drop table if exists public.gallery_sets;
--   drop function if exists public.gallery_sets_at_most_ten();
--   drop function if exists public.set_label_ok(text);
--   notify pgrst, 'reload schema';
--   delete from supabase_migrations.schema_migrations where version = '20261122120000';
--   commit;
-- ---------------------------------------------------------------------------
