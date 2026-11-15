-- Creating and editing galleries from the Studio.
--
-- Step 3 of the admin panel. Until now a signed-in member could only read.
-- This opens exactly four things, and nothing a visitor sees changes.
--
-- WHAT IT ADDS
--
--   editing              a member can change the everyday fields of a gallery
--                        in their own account: title, date, location, year,
--                        description, colour, published, visibility, listed,
--                        list label, note to the client, closing date and the
--                        download settings. Nothing else.
--   studio_create_gallery()   the only way a member creates a gallery.
--   studio_create_passkey()   the only way a member creates a passkey.
--   studio_set_cover()        picks the cover from the gallery's own photos.
--   studio_delete_gallery()   deletes a gallery that has no photos.
--   passkey list         a member can list and revoke the passkeys of their
--                        own galleries. The hash itself stays unreadable.
--   created_by           who made the gallery, when it was made in the Studio.
--   born private         a client gallery now starts private and unlisted,
--                        whoever inserts it (the Studio, reseed.ts, SQL).
--
-- WHY CREATING GOES THROUGH A FUNCTION. A new gallery needs things a member
-- cannot check for themselves: that the address is free across the whole
-- site, and that its storage folder is not somebody else's. The function
-- checks both and works the folder out itself, so no member can ever point a
-- gallery at a folder they chose.
--
-- WHY SOME COLUMNS STAY CLOSED. slug, kind, bunny_folder, account_id and
-- list_cover_path decide where files are and who can reach them. Changing
-- kind alone would move a gallery between the public and the private zone
-- without moving a single file. Those stay with the scripts.
--
-- WHY THE COVER GOES THROUGH A FUNCTION. cover_path on a client gallery is
-- signed for the private zone by the site. Left writable, a member could name
-- any private file and have it signed. The function accepts a photo of the
-- same gallery and nothing else.
--
-- BORN PRIVATE. Before this, a client gallery took the column default,
-- visibility 'public': served with no passkey. That is how sara-grad went out
-- ungated. From now on it takes a deliberate UPDATE to open one. Existing
-- rows are not touched.
--
-- PASSKEYS. Hashed here with bcrypt at cost 10 (the old hand-written INSERTs
-- used pgcrypto's default, 6, which is 16 times weaker). unlock_gallery()
-- reads both the same way, so old and new passkeys work side by side.
--
-- Why 10 and not 12: a wrong guess at the gate is compared against every
-- live passkey of the gallery, one hash each, and a visitor's request is cut
-- off by Supabase after 3 seconds. Measured: about 0.07 s a hash at cost 10,
-- 0.3 s at cost 12. Ten passkeys at cost 12 would time out and the gate would
-- say "unavailable" instead of "wrong code". For the same reason a gallery
-- holds at most 10 live passkeys.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261114190000_accounts_and_members.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261115100000', 'studio_gallery_writes');

begin;

-- ---------------------------------------------------------------------------
-- Stop early, changing nothing, if this database is not what the file expects.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.accounts') is null or to_regclass('public.account_members') is null then
    raise exception 'Run 20261114190000_accounts_and_members.sql first.';
  end if;
  if to_regclass('public.gallery_access') is null then
    raise exception 'public.gallery_access does not exist. Passkeys need it.';
  end if;
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'gen_salt' and n.nspname in ('public', 'extensions')
  ) then
    raise exception 'pgcrypto is not installed in public or extensions. Passkeys need crypt() and gen_salt().';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- created_by: the login that made the gallery. NULL for everything made by a
-- script or before today.
-- ---------------------------------------------------------------------------
alter table public.galleries
  add column if not exists created_by uuid references auth.users(id) on delete set null;

comment on column public.galleries.created_by is
  'The login that created the gallery in the Studio. NULL = made by a script or by hand.';

-- ---------------------------------------------------------------------------
-- A client gallery starts private and unlisted.
--
-- Only on INSERT, and only in the safe direction: it never opens anything.
-- Making a client gallery public, or listing it, is an UPDATE afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.galleries_client_starts_private()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'client' then
    if new.visibility = 'public' then
      new.visibility := 'private';
    end if;
    new.is_listed := false;
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_client_starts_private on public.galleries;
create trigger galleries_client_starts_private
  before insert on public.galleries
  for each row execute function public.galleries_client_starts_private();

revoke all on function public.galleries_client_starts_private() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Editing a gallery
--
-- Table-level write access stays off. What is granted is a list of columns,
-- so a request that tries to change slug, kind or bunny_folder is refused by
-- Postgres before any rule is even consulted.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.galleries from anon, authenticated;

grant update (
  title, date_label, location, year, description, accent_color,
  is_published, visibility, is_listed,
  list_label, client_note, expires_at,
  download_enabled, download_tiers
) on public.galleries to authenticated;

drop policy if exists "galleries: members update their account" on public.galleries;
create policy "galleries: members update their account"
  on public.galleries for update
  to authenticated
  using (account_id in (select public.my_account_ids()))
  with check (account_id in (select public.my_account_ids()));

-- ---------------------------------------------------------------------------
-- Passkeys: list and revoke
--
-- code_hash is left out of the grant, so not even the gallery's owner can
-- read a hash through the API. Creating one goes through the function below;
-- there is no INSERT or DELETE grant at all.
-- ---------------------------------------------------------------------------
alter table public.gallery_access enable row level security;

revoke all on public.gallery_access from anon, authenticated;

grant select (id, gallery_id, label, created_at, expires_at, revoked_at, last_used_at, use_count)
  on public.gallery_access to authenticated;
grant update (label, expires_at, revoked_at)
  on public.gallery_access to authenticated;

drop policy if exists "gallery_access: members read their galleries' passkeys" on public.gallery_access;
create policy "gallery_access: members read their galleries' passkeys"
  on public.gallery_access for select
  to authenticated
  using (
    gallery_id in (
      select g.id from public.galleries g
       where g.account_id in (select public.my_account_ids())
    )
  );

drop policy if exists "gallery_access: members update their galleries' passkeys" on public.gallery_access;
create policy "gallery_access: members update their galleries' passkeys"
  on public.gallery_access for update
  to authenticated
  using (
    gallery_id in (
      select g.id from public.galleries g
       where g.account_id in (select public.my_account_ids())
    )
  )
  with check (
    gallery_id in (
      select g.id from public.galleries g
       where g.account_id in (select public.my_account_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- The four functions
--
-- All SECURITY DEFINER: they do what the caller's own grants cannot, after
-- checking that the caller is a member of the account the gallery is in.
-- search_path is pinned the same way unlock_gallery() pins it (pgcrypto lives
-- in `extensions` on Supabase, in `public` on older projects), and every
-- table is written with its schema.
--
-- A refusal is raised as 'studio:<reason>'. The Studio turns the reason into
-- a sentence in the photographer's language.
-- ---------------------------------------------------------------------------

-- studio_create_passkey ------------------------------------------------------
create or replace function public.studio_create_passkey(
  p_gallery_id uuid,
  p_code       text,
  p_label      text default 'client',
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_kind  text;
  v_code  text := btrim(coalesce(p_code, ''));
  v_label text := coalesce(nullif(btrim(coalesce(p_label, '')), ''), 'client');
  v_id    uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  select g.kind into v_kind
    from public.galleries g
   where g.id = p_gallery_id
     and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  if v_kind <> 'client' then
    raise exception using errcode = 'P0001', message = 'studio:not_client';
  end if;

  if char_length(v_code) < 6 or char_length(v_code) > 64 then
    raise exception using errcode = 'P0001', message = 'studio:code_length';
  end if;
  if char_length(v_label) > 80 then
    raise exception using errcode = 'P0001', message = 'studio:label_length';
  end if;

  -- See PASSKEYS at the top for why there is a limit at all.
  if (select count(*) from public.gallery_access a
       where a.gallery_id = p_gallery_id and a.revoked_at is null) >= 10 then
    raise exception using errcode = 'P0001', message = 'studio:too_many_codes';
  end if;

  -- The same code twice in one gallery would make "revoke this one" mean
  -- nothing: the other row would still let it in.
  if exists (
    select 1 from public.gallery_access a
     where a.gallery_id = p_gallery_id
       and a.revoked_at is null
       and a.code_hash = crypt(v_code, a.code_hash)
  ) then
    raise exception using errcode = 'P0001', message = 'studio:code_in_use';
  end if;

  insert into public.gallery_access (gallery_id, code_hash, label, expires_at)
  values (p_gallery_id, crypt(v_code, gen_salt('bf', 10)), v_label, p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

-- studio_create_gallery ------------------------------------------------------
create or replace function public.studio_create_gallery(
  p_account_id    uuid,
  p_kind          text,
  p_title         text,
  p_slug          text,
  p_category      text default null,
  p_date_label    text default '',
  p_location      text default '',
  p_passkey       text default null,
  p_passkey_label text default 'client'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_prefix   text;
  v_username text;
  v_root     text;
  v_title    text := btrim(coalesce(p_title, ''));
  v_slug     text := btrim(coalesce(p_slug, ''));
  v_category text := regexp_replace(btrim(coalesce(p_category, '')), '\s+', ' ', 'g');
  v_existing text;
  v_folder   text;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  select a.storage_prefix, a.username into v_prefix, v_username
    from public.accounts a
   where a.id = p_account_id
     and a.status = 'active'
     and a.id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_member';
  end if;

  if p_kind is null or p_kind not in ('album', 'client') then
    raise exception using errcode = 'P0001', message = 'studio:kind';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception using errcode = 'P0001', message = 'studio:title_length';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) < 2 or char_length(v_slug) > 60 then
    raise exception using errcode = 'P0001', message = 'studio:slug_format';
  end if;

  -- Across the whole site and whatever the case: addresses are /albums/<slug>
  -- and /galleries/<slug> with no photographer in them yet, and the site
  -- looks a slug up case-insensitively.
  if exists (select 1 from public.galleries g where lower(g.slug) = v_slug) then
    raise exception using errcode = 'P0001', message = 'studio:slug_taken';
  end if;

  -- Where the files will live. '' is the zone root (the first account).
  v_root := case when coalesce(v_prefix, '') = '' then '' else rtrim(v_prefix, '/') || '/' end;

  if p_kind = 'client' then
    -- Every private path contains /clients/, which is what the public zone's
    -- edge rule blocks and what reseed.ts keys on.
    v_folder := v_root || 'clients/' || v_slug;
  else
    if v_category !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,38}[A-Za-z0-9]$' then
      raise exception using errcode = 'P0001', message = 'studio:category_format';
    end if;
    -- d/ and clients/ are the two reserved roots; u/ is kept for later accounts.
    if lower(v_category) in ('d', 'clients', 'u') then
      raise exception using errcode = 'P0001', message = 'studio:category_reserved';
    end if;

    -- "portraits" when "Portraits" already exists must not become a second
    -- folder, and a second chip on the Portfolio page. Reuse the spelling
    -- that is already there.
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

    v_folder := v_root || v_category || '/' || v_slug;
  end if;

  if exists (select 1 from public.galleries g where lower(g.bunny_folder) = lower(v_folder)) then
    raise exception using errcode = 'P0001', message = 'studio:folder_taken';
  end if;

  -- Not published: an empty gallery should not appear on the site the moment
  -- it is named. Publishing is a button in the Studio.
  insert into public.galleries (
    account_id, slug, title, kind, visibility, is_listed, is_published,
    bunny_folder, date_label, location, year, photographer_handle, created_by
  ) values (
    p_account_id, v_slug, v_title, p_kind,
    case when p_kind = 'client' then 'private' else 'public' end,
    p_kind = 'album',
    false,
    v_folder,
    left(btrim(coalesce(p_date_label, '')), 120),
    left(btrim(coalesce(p_location, '')), 120),
    to_char(now(), 'YYYY'),
    v_username,
    v_uid
  )
  returning id into v_id;

  if p_kind = 'client' and btrim(coalesce(p_passkey, '')) <> '' then
    perform public.studio_create_passkey(v_id, p_passkey, p_passkey_label, null);
  end if;

  return v_id;
end;
$$;

-- studio_set_cover -----------------------------------------------------------
-- p_photo_id left out (NULL) clears the cover; the gallery then shows its
-- first photo.
create or replace function public.studio_set_cover(
  p_gallery_id uuid,
  p_photo_id   uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_path text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  perform 1 from public.galleries g
   where g.id = p_gallery_id
     and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  if p_photo_id is not null then
    select p.storage_path into v_path
      from public.photos p
     where p.id = p_photo_id and p.gallery_id = p_gallery_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'studio:photo_not_found';
    end if;
  end if;

  update public.galleries set cover_path = v_path where id = p_gallery_id;
end;
$$;

-- studio_delete_gallery ------------------------------------------------------
-- Empty galleries only. One with photos has files in storage, and deleting
-- the row would orphan them; that arrives with storage cleanup.
create or replace function public.studio_delete_gallery(p_gallery_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  perform 1 from public.galleries g
   where g.id = p_gallery_id
     and g.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  if exists (select 1 from public.photos p where p.gallery_id = p_gallery_id) then
    raise exception using errcode = 'P0001', message = 'studio:has_photos';
  end if;

  -- Named, not left to a cascade: whether gallery_access cascades was never
  -- written down in a migration.
  delete from public.gallery_access where gallery_id = p_gallery_id;
  delete from public.galleries where id = p_gallery_id;
end;
$$;

revoke all on function
  public.studio_create_passkey(uuid, text, text, timestamptz),
  public.studio_create_gallery(uuid, text, text, text, text, text, text, text, text),
  public.studio_set_cover(uuid, uuid),
  public.studio_delete_gallery(uuid)
  from public, anon;

grant execute on function
  public.studio_create_passkey(uuid, text, text, timestamptz),
  public.studio_create_gallery(uuid, text, text, text, text, text, text, text, text),
  public.studio_set_cover(uuid, uuid),
  public.studio_delete_gallery(uuid)
  to authenticated, service_role;

-- Tell the API layer the new functions exist, so the first call does not
-- answer "function not found".
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- Checks, read-only. Run after the file.
--
--   -- the four functions exist
--   select proname from pg_proc
--    where proname like 'studio\_%' order by 1;
--
--   -- client galleries that are open to anyone with the link today.
--   -- Not changed by this file. Each one is either deliberate or a mistake.
--   select slug, title, visibility, is_listed, is_published
--     from public.galleries where kind = 'client' and visibility <> 'private';
--
--   -- client galleries that are private but have no working passkey:
--   -- nobody can open these.
--   select g.slug, g.title
--     from public.galleries g
--    where g.kind = 'client' and g.visibility = 'private'
--      and not exists (select 1 from public.gallery_access a
--                       where a.gallery_id = g.id and a.revoked_at is null
--                         and (a.expires_at is null or a.expires_at > now()));
-- ---------------------------------------------------------------------------
