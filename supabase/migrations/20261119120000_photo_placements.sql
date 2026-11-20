-- Where a photo is shown besides its own album: the Best picks grid on Home,
-- and the photo rail at the bottom of four service pages (Portraits,
-- Graduation, Model tests, Brands & products). Chosen in the Studio, photo by
-- photo, from the menu on each photo ("Add to..."), the way a song is added to
-- a playlist (Marshall, 2026-11-19).
--
-- Until now these were lists of storage paths in the code (BEST_PICKS in
-- src/app/[locale]/about/photos.ts, galleryPaths in src/lib/services.ts), so a
-- change meant an edit and a deploy. This table replaces them. The FIRST run
-- copies those lists in, in their order, so the site looks the same the moment
-- this is run. The code lists stay as what the site shows while this table
-- does not exist yet.
--
--   photo_placements       one row per photo per place, with its position
--   studio_place_photo     add one photo to a place, or take it off, for members
--
-- Only album photos can be placed: an album photo is public once its album is
-- published, a client photo never is. A client photo is published to an album
-- first (studio_publish_photos), and the album's copy is placed. Visitors see
-- a placement only while its album is published and public, and see it again
-- if the album is published again. Deleting a photo deletes its placements.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261116230000_studio_publish_and_move.sql. It is re-runnable, and a re-run
-- never copies the code lists in again. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261119120000', 'photo_placements');

begin;

do $$
begin
  if to_regprocedure('public.studio_move_photos(uuid, uuid[], uuid)') is null then
    raise exception 'Run 20261116230000_studio_publish_and_move.sql first.';
  end if;
end $$;

-- Whether this run makes the table. Only then are the code lists copied in,
-- so a re-run never brings back a photo that was taken off since.
create temporary table placement_run on commit drop as
  select to_regclass('public.photo_placements') is null as fresh;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

-- place: 'best-picks', or 'service:<slug>' for a service page's rail. The app
-- decides which places exist; the database only checks the shape, so a new
-- place needs no migration.
-- position: the order on the page, smallest first. A new photo goes last.
create table if not exists public.photo_placements (
  account_id uuid not null references public.accounts(id) on delete cascade,
  place      text not null,
  photo_id   uuid not null references public.photos(id) on delete cascade,
  position   integer not null,
  created_at timestamptz not null default now(),
  primary key (account_id, place, photo_id),
  constraint photo_placements_place_shape
    check (length(place) <= 72 and place ~ '^(best-picks|service:[a-z0-9]+(-[a-z0-9]+)*)$')
);

create index if not exists photo_placements_place_idx on public.photo_placements (place, position);
create index if not exists photo_placements_photo_idx on public.photo_placements (photo_id);

alter table public.photo_placements enable row level security;

-- Visitors: a placement whose photo is in a published, public album. The
-- photos and galleries policies apply inside this too.
drop policy if exists "photo_placements: visitors read public ones" on public.photo_placements;
create policy "photo_placements: visitors read public ones"
  on public.photo_placements for select
  to anon, authenticated
  using (
    exists (
      select 1
        from public.photos p
        join public.galleries g on g.id = p.gallery_id
       where p.id = photo_placements.photo_id
         and g.kind = 'album'
         and g.is_published
         and g.visibility = 'public'
    )
  );

-- Members: everything of their account, unpublished albums included, for the
-- Studio's menus.
drop policy if exists "photo_placements: members read their account" on public.photo_placements;
create policy "photo_placements: members read their account"
  on public.photo_placements for select
  to authenticated
  using (account_id in (select public.my_account_ids()));

-- Written only through studio_place_photo. Explicit, so it is the same under
-- the old and the new Supabase default for new tables. service_role for the
-- worker's daily database copy, which takes every table.
revoke all on public.photo_placements from public, anon, authenticated;
grant select on public.photo_placements to anon, authenticated;
grant all on public.photo_placements to service_role;

-- ---------------------------------------------------------------------------
-- studio_place_photo(photo, place, on)
-- ---------------------------------------------------------------------------
-- on = true: put the photo at the end of the place (nothing happens if it is
-- there already). on = false: take it off. Returns every place the photo is in
-- afterwards, sorted, for the Studio's menu.
--
-- Refusals (P0001, message 'studio:<reason>'):
--   not_signed_in     no login
--   place             not a place's shape
--   photo_not_found   not a photo of the caller's account
--   not_album         adding a photo that is in a client gallery
--   place_full        the place already has 100 photos
-- Taking a photo off works wherever it is now, so a placement left on a
-- gallery that went private again can still be removed.
create or replace function public.studio_place_photo(
  p_photo_id uuid,
  p_place    text,
  p_on       boolean
)
returns text[]
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_account uuid;
  v_kind    text;
  v_count   integer;
  v_last    integer;
  v_places  text[];
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  if p_place is null or length(p_place) > 72
     or p_place !~ '^(best-picks|service:[a-z0-9]+(-[a-z0-9]+)*)$' then
    raise exception using errcode = 'P0001', message = 'studio:place';
  end if;

  select g.account_id, g.kind into v_account, v_kind
    from public.photos p
    join public.galleries g on g.id = p.gallery_id
   where p.id = p_photo_id
     and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:photo_not_found';
  end if;

  if coalesce(p_on, false) then
    if v_kind is distinct from 'album' then
      raise exception using errcode = 'P0001', message = 'studio:not_album';
    end if;

    -- One change at a time per place, so two adds never get the same position.
    perform pg_advisory_xact_lock(hashtextextended(v_account::text || '/' || p_place, 0));

    if not exists (
      select 1 from public.photo_placements
       where account_id = v_account and place = p_place and photo_id = p_photo_id
    ) then
      select count(*), coalesce(max(position), 0) into v_count, v_last
        from public.photo_placements
       where account_id = v_account and place = p_place;
      if v_count >= 100 then
        raise exception using errcode = 'P0001', message = 'studio:place_full';
      end if;
      insert into public.photo_placements (account_id, place, photo_id, position)
      values (v_account, p_place, p_photo_id, v_last + 1);
    end if;
  else
    delete from public.photo_placements
     where account_id = v_account and place = p_place and photo_id = p_photo_id;
  end if;

  select coalesce(array_agg(pl.place order by pl.place), '{}'::text[]) into v_places
    from public.photo_placements pl
   where pl.account_id = v_account and pl.photo_id = p_photo_id;
  return v_places;
end;
$$;

revoke all on function public.studio_place_photo(uuid, text, boolean) from public, anon;
grant execute on function public.studio_place_photo(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The lists from the code, copied in on the first run
-- ---------------------------------------------------------------------------
-- As they were on 2026-11-19, in their order. A path is matched to the album
-- photo with that file; a file in more than one album goes by its published,
-- public album first. A path that is in no album cannot be placed and is
-- named in a notice instead (the site only ever showed album photos for it).

create temporary table placement_seed (place text, path text, pos integer) on commit drop;
insert into placement_seed (place, path, pos) values
  -- BEST_PICKS, src/app/[locale]/about/photos.ts
  ('best-picks', 'Portraits/Sara/3M0A1432.png', 1),
  ('best-picks', 'Portraits/Radmir/3M0A0675.png', 2),
  ('best-picks', 'WIUT-Fashion-Show/3M0A3551.png', 3),
  ('best-picks', 'WIUT/5I9A3029.png', 4),
  ('best-picks', 'Portraits/9O6A2264.png', 5),
  ('best-picks', 'Portraits/Gulasal at WIUT/2W6A7098.png', 6),
  ('best-picks', 'Portraits/3M0A4694.png', 7),
  ('best-picks', 'Portraits/Mekhrangiz/4P5A1850.png', 8),
  ('best-picks', 'WIUT-Fashion-Show/3M0A2504.png', 9),
  -- portraits.galleryPaths, src/lib/services.ts
  ('service:portraits', 'Portraits/Mekhrangiz/4P5A1850.png', 1),
  ('service:portraits', 'Portraits/Radmir/3M0A0675.png', 2),
  ('service:portraits', 'Portraits/Sara/3M0A1432.png', 3),
  ('service:portraits', 'Portraits/Gulasal at WIUT/2W6A7098.png', 4),
  ('service:portraits', 'Portraits/Diora/076A0398.png', 5),
  ('service:portraits', 'Portraits/9O6A2264.png', 6),
  ('service:portraits', 'Portraits/3M0A4694.png', 7),
  -- graduation.galleryPaths
  ('service:graduation', 'Portraits/ShirinGrad.png', 1),
  ('service:graduation', 'Portraits/RadmirGrad.png', 2),
  ('service:graduation', 'Portraits/DiyoraGrad.png', 3);

insert into public.photo_placements (account_id, place, photo_id, position)
select distinct on (s.place, s.path) g.account_id, s.place, p.id, s.pos
  from placement_seed s
  join public.photos p on p.storage_path = s.path
  join public.galleries g on g.id = p.gallery_id and g.kind = 'album'
 where (select fresh from placement_run)
 order by s.place, s.path, (g.is_published and g.visibility = 'public') desc, g.created_at, p.id
on conflict do nothing;

do $$
declare
  r record;
begin
  if not (select fresh from placement_run) then
    return;
  end if;
  for r in
    select s.place, s.path
      from placement_seed s
     where not exists (
       select 1
         from public.photos p
         join public.galleries g on g.id = p.gallery_id and g.kind = 'album'
        where p.storage_path = s.path
     )
     order by s.place, s.pos
  loop
    raise notice 'Not in any album, so not carried over: % (%)', r.path, r.place;
  end loop;
end $$;

commit;

-- What each place holds now (the SQL editor shows this):
select place, count(*) as photos
  from public.photo_placements
 group by place
 order by place;

-- ---------------------------------------------------------------------------
-- Checks, any time after:
--
--   -- a place, in its order, with each photo's album
--   select pl.position, p.storage_path, g.title, g.is_published
--     from public.photo_placements pl
--     join public.photos p on p.id = pl.photo_id
--     join public.galleries g on g.id = p.gallery_id
--    where pl.place = 'best-picks'
--    order by pl.position;
--
-- UNDO. The site goes back to the lists in the code (whatever was chosen in
-- the Studio is lost, so look at the check above first):
--   begin;
--   drop function if exists public.studio_place_photo(uuid, text, boolean);
--   drop table if exists public.photo_placements;
--   delete from supabase_migrations.schema_migrations where version = '20261119120000';
--   commit;
-- ---------------------------------------------------------------------------
