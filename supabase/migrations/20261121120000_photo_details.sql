-- A photo's own details, edited from the Studio's photo panel and ⋯ menu
-- (Marshall, 2026-11-21): its name, a description, category tags, and
-- whether it is shown in its gallery. Four new columns:
--
--   name          new. The name the Studio shows, and that a client's
--                 download is saved under. Null: the file's own name
--                 (file_name, which is computed from the storage path and so
--                 cannot be renamed). Renaming changes only this: the stored
--                 file and its address stay, so links keep working.
--   description   new. Shown under the photo in the gallery viewer and read
--                 as its alt text. Null: none (the old automatic `alt` text
--                 is what the site shows then, as before).
--   tags          new. Portfolio categories the photo is also filed under,
--                 besides its album's own. At most 10, each 1 to 40 letters.
--   hidden        new. Off the site: its gallery, the Portfolio, Best picks,
--                 the service pages and the album's count and cover. Still in
--                 the Studio, marked. Clients do not see it either.
--
-- HOW HIDDEN WORKS: in the visitors' read rule for photos (the original
-- migration left a note that per-photo visibility goes exactly there). Every
-- public page reads photos through that rule, so no page needed changing.
-- Client galleries are read with the service key, which skips the rule; they
-- filter `hidden` in the code (src/lib/client-galleries.ts).
--
--   studio_update_photo(photo, changes)        name, description, tags, hidden
--   studio_set_photos_hidden(gallery, photos)  hide or show many at once
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261120120000_service_content.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261121120000', 'photo_details');

begin;

do $$
begin
  if to_regprocedure('public.my_account_ids()') is null then
    raise exception 'Run 20261114190000_accounts_and_members.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

-- A tag list is fine when it has at most 10 tags, each trimmed, 1 to 40
-- characters, no control characters, and no two the same (ignoring case).
create or replace function public.photo_tags_ok(p_tags text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_tags is not null
     and cardinality(p_tags) <= 10
     and not exists (
       select 1 from unnest(p_tags) t
        where t is null or t <> btrim(t) or length(t) < 1 or length(t) > 40 or t ~ '[[:cntrl:]]'
     )
     and (select count(distinct lower(t)) from unnest(p_tags) t) = cardinality(p_tags);
$$;

alter table public.photos add column if not exists name text;
alter table public.photos add column if not exists description text;
alter table public.photos add column if not exists tags text[] not null default '{}';
alter table public.photos add column if not exists hidden boolean not null default false;

alter table public.photos drop constraint if exists photos_name_ok;
alter table public.photos add constraint photos_name_ok
  check (name is null or (name = btrim(name) and length(name) between 1 and 200 and name !~ '[/\\[:cntrl:]]'));
alter table public.photos drop constraint if exists photos_description_length;
alter table public.photos add constraint photos_description_length
  check (description is null or (length(description) between 1 and 1000));
alter table public.photos drop constraint if exists photos_tags_ok;
alter table public.photos add constraint photos_tags_ok check (public.photo_tags_ok(tags));

-- ---------------------------------------------------------------------------
-- Visitors: a hidden photo is not readable. Otherwise exactly as before.
-- ---------------------------------------------------------------------------

drop policy if exists "photos: anon read photos of readable galleries" on public.photos;
create policy "photos: anon read photos of readable galleries"
  on public.photos for select
  to anon, authenticated
  using (
    not photos.hidden
    and exists (
      select 1
      from public.galleries g
      where g.id = photos.gallery_id
        and g.is_published
        and g.visibility = 'public'
    )
  );

-- ---------------------------------------------------------------------------
-- studio_update_photo: any of name, description, tags, hidden. Keys left out
-- are left as they are. Answers with the photo's details after the change.
-- ---------------------------------------------------------------------------

create or replace function public.studio_update_photo(p_photo_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key   text;
  v_name  text;
  v_desc  text;
  v_tags  text[];
  v_tag   text;
  v_row   public.photos%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'studio:invalid';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('name', 'description', 'tags', 'hidden') then
      raise exception using errcode = 'P0001', message = 'studio:invalid';
    end if;
  end loop;

  select p.* into v_row
    from public.photos p
    join public.galleries g on g.id = p.gallery_id
   where p.id = p_photo_id
     and g.account_id in (select public.my_account_ids())
     for update of p;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:photo_not_found';
  end if;

  -- A name the same as the file's own is no name: the photo keeps following
  -- its file. Blank or null goes back to the file's name.
  if p_changes ? 'name' then
    if jsonb_typeof(p_changes -> 'name') = 'null' then
      v_name := null;
    elsif jsonb_typeof(p_changes -> 'name') = 'string' then
      v_name := nullif(btrim(p_changes ->> 'name'), '');
    else
      raise exception using errcode = 'P0001', message = 'studio:name';
    end if;
    if v_name is not null and (length(v_name) > 200 or v_name ~ '[/\\[:cntrl:]]') then
      raise exception using errcode = 'P0001', message = 'studio:name';
    end if;
    if v_name = v_row.file_name then
      v_name := null;
    end if;
    v_row.name := v_name;
  end if;

  if p_changes ? 'description' then
    if jsonb_typeof(p_changes -> 'description') = 'null' then
      v_desc := null;
    elsif jsonb_typeof(p_changes -> 'description') = 'string' then
      v_desc := nullif(btrim(p_changes ->> 'description'), '');
    else
      raise exception using errcode = 'P0001', message = 'studio:description';
    end if;
    if v_desc is not null and length(v_desc) > 1000 then
      raise exception using errcode = 'P0001', message = 'studio:description';
    end if;
    v_row.description := v_desc;
  end if;

  if p_changes ? 'tags' then
    if jsonb_typeof(p_changes -> 'tags') <> 'array' then
      raise exception using errcode = 'P0001', message = 'studio:tags';
    end if;
    v_tags := '{}';
    for v_tag in
      select case when jsonb_typeof(e) = 'string' then btrim(e #>> '{}') end
        from jsonb_array_elements(p_changes -> 'tags') e
    loop
      if v_tag is null or v_tag = '' then
        raise exception using errcode = 'P0001', message = 'studio:tags';
      end if;
      -- The same tag twice, in any case, is kept once.
      if not exists (select 1 from unnest(v_tags) x where lower(x) = lower(v_tag)) then
        v_tags := v_tags || v_tag;
      end if;
    end loop;
    if not public.photo_tags_ok(v_tags) then
      raise exception using errcode = 'P0001', message = 'studio:tags';
    end if;
    v_row.tags := v_tags;
  end if;

  if p_changes ? 'hidden' then
    if jsonb_typeof(p_changes -> 'hidden') <> 'boolean' then
      raise exception using errcode = 'P0001', message = 'studio:invalid';
    end if;
    v_row.hidden := (p_changes ->> 'hidden')::boolean;
  end if;

  update public.photos p
     set name = v_row.name,
         description = v_row.description,
         tags = v_row.tags,
         hidden = v_row.hidden
   where p.id = v_row.id;

  return jsonb_build_object(
    'name', v_row.name,
    'fileName', v_row.file_name,
    'description', v_row.description,
    'tags', to_jsonb(v_row.tags),
    'hidden', v_row.hidden
  );
end;
$$;

revoke all on function public.studio_update_photo(uuid, jsonb) from public, anon;
grant execute on function public.studio_update_photo(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- studio_set_photos_hidden: many photos of one gallery at once. Answers with
-- how many changed. Photos not in the gallery are ignored.
-- ---------------------------------------------------------------------------

create or replace function public.studio_set_photos_hidden(p_gallery_id uuid, p_photo_ids uuid[], p_hidden boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_hidden is null or p_photo_ids is null or cardinality(p_photo_ids) = 0 or cardinality(p_photo_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'studio:photos';
  end if;
  perform 1 from public.galleries g
   where g.id = p_gallery_id and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  update public.photos p
     set hidden = p_hidden
   where p.gallery_id = p_gallery_id
     and p.id = any (p_photo_ids)
     and p.hidden is distinct from p_hidden;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.studio_set_photos_hidden(uuid, uuid[], boolean) from public, anon;
grant execute on function public.studio_set_photos_hidden(uuid, uuid[], boolean) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Checks, any time after:
--
--   -- hidden photos, per gallery
--   select g.slug, count(*) filter (where p.hidden) as hidden, count(*) as photos
--     from public.photos p join public.galleries g on g.id = p.gallery_id
--    group by g.slug having count(*) filter (where p.hidden) > 0 order by g.slug;
--
--   -- every tag in use, with how many photos carry it
--   select t as tag, count(*) from public.photos, unnest(tags) t group by t order by 2 desc;
--
-- UNDO. Names, descriptions, tags and hidden flags are lost; hidden photos show again:
--   begin;
--   drop function if exists public.studio_set_photos_hidden(uuid, uuid[], boolean);
--   drop function if exists public.studio_update_photo(uuid, jsonb);
--   drop policy if exists "photos: anon read photos of readable galleries" on public.photos;
--   create policy "photos: anon read photos of readable galleries" on public.photos for select
--     to anon, authenticated
--     using (exists (select 1 from public.galleries g where g.id = photos.gallery_id
--                     and g.is_published and g.visibility = 'public'));
--   alter table public.photos drop constraint if exists photos_tags_ok;
--   alter table public.photos drop constraint if exists photos_description_length;
--   alter table public.photos drop constraint if exists photos_name_ok;
--   alter table public.photos drop column if exists hidden;
--   alter table public.photos drop column if exists tags;
--   alter table public.photos drop column if exists description;
--   alter table public.photos drop column if exists name;
--   drop function if exists public.photo_tags_ok(text[]);
--   delete from supabase_migrations.schema_migrations where version = '20261121120000';
--   commit;
-- ---------------------------------------------------------------------------
