-- The Services tab in the Studio: a service page's texts, cover and packages,
-- edited as a draft and published when every language is written, and a
-- switch that turns a service off (Marshall, 2026-11-20).
--
-- The code (src/lib/services.ts) stays the base. A service nobody has touched
-- has no row here and shows as the code has it. Once edited:
--
--   published   what the site shows, laid over the code (null: the code)
--   draft       the unpublished changes (null: none)
--   enabled     off: no page, not on the lists, not bookable. Takes effect at
--               once, not through the draft.
--   rev         goes up with every change to the draft or a Publish, so two
--               open editors cannot overwrite each other unseen.
--
-- The shape of `published` and `draft` is checked in the app
-- (src/lib/service-content.ts, parseContent). A value that fails the check is
-- ignored and the code's version shows.
--
-- Visitors read `published` and `enabled` and nothing else: the column grants
-- below leave `draft` out. Members read their drafts through studio_services().
--
--   studio_services                 every row of an account, drafts included
--   studio_save_service_draft       save the draft (refused if rev moved on)
--   studio_publish_service          the draft becomes what the site shows
--   studio_discard_service_draft    drop the draft
--   studio_set_service_enabled      the on/off switch
--   studio_order_place              put a place's photos (a service page's
--                                   rail, Best picks) in a new order
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261119120000_photo_placements.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261120120000', 'service_content');

begin;

do $$
begin
  if to_regprocedure('public.studio_place_photo(uuid, text, boolean)') is null then
    raise exception 'Run 20261119120000_photo_placements.sql first.';
  end if;
end $$;

create table if not exists public.service_content (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  slug         text not null,
  enabled      boolean not null default true,
  published    jsonb,
  draft        jsonb,
  rev          integer not null default 0,
  published_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (account_id, slug),
  constraint service_content_slug_shape
    check (length(slug) <= 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint service_content_published_object
    check (published is null or jsonb_typeof(published) = 'object'),
  constraint service_content_draft_object
    check (draft is null or jsonb_typeof(draft) = 'object')
);

alter table public.service_content enable row level security;

-- Every row is public in the columns visitors are granted: the published
-- content is on the site anyway.
drop policy if exists "service_content: anyone reads" on public.service_content;
create policy "service_content: anyone reads"
  on public.service_content for select
  to anon, authenticated
  using (true);

revoke all on public.service_content from public, anon, authenticated;
grant select (account_id, slug, enabled, published, published_at)
  on public.service_content to anon, authenticated;
grant all on public.service_content to service_role;

-- ---------------------------------------------------------------------------
-- The checks every function below starts with.
-- ---------------------------------------------------------------------------

create or replace function public.studio_service_guard(p_account uuid, p_slug text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;
  if p_account is null or not exists (select 1 from public.my_account_ids() a where a = p_account) then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  if p_slug is not null and (length(p_slug) > 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception using errcode = 'P0001', message = 'studio:service';
  end if;
end;
$$;

revoke all on function public.studio_service_guard(uuid, text) from public, anon;
grant execute on function public.studio_service_guard(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------

create or replace function public.studio_services(p_account uuid)
returns table (
  slug         text,
  enabled      boolean,
  published    jsonb,
  draft        jsonb,
  rev          integer,
  published_at timestamptz,
  updated_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.studio_service_guard(p_account, null);
  return query
    select s.slug, s.enabled, s.published, s.draft, s.rev, s.published_at, s.updated_at
      from public.service_content s
     where s.account_id = p_account
     order by s.slug;
end;
$$;

revoke all on function public.studio_services(uuid) from public, anon;
grant execute on function public.studio_services(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The draft
-- ---------------------------------------------------------------------------

-- Returns the new rev. p_rev is the rev the editor last saw; 0 for a service
-- with no row yet.
create or replace function public.studio_save_service_draft(
  p_account uuid,
  p_slug    text,
  p_draft   jsonb,
  p_rev     integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rev integer;
begin
  perform public.studio_service_guard(p_account, p_slug);
  if p_slug is null then
    raise exception using errcode = 'P0001', message = 'studio:service';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' or octet_length(p_draft::text) > 200000 then
    raise exception using errcode = 'P0001', message = 'studio:draft';
  end if;

  insert into public.service_content (account_id, slug)
  values (p_account, p_slug)
  on conflict (account_id, slug) do nothing;

  select s.rev into v_rev
    from public.service_content s
   where s.account_id = p_account and s.slug = p_slug
   for update;
  if v_rev is distinct from p_rev then
    raise exception using errcode = 'P0001', message = 'studio:conflict';
  end if;

  update public.service_content s
     set draft = p_draft, rev = s.rev + 1, updated_at = now()
   where s.account_id = p_account and s.slug = p_slug
  returning s.rev into v_rev;
  return v_rev;
end;
$$;

revoke all on function public.studio_save_service_draft(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.studio_save_service_draft(uuid, text, jsonb, integer) to authenticated;

-- The draft as it was at p_rev becomes the published content. The app checks
-- that draft before it calls this; the rev makes sure it is the same one.
create or replace function public.studio_publish_service(
  p_account uuid,
  p_slug    text,
  p_rev     integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rev   integer;
  v_draft jsonb;
begin
  perform public.studio_service_guard(p_account, p_slug);

  select s.rev, s.draft into v_rev, v_draft
    from public.service_content s
   where s.account_id = p_account and s.slug = p_slug
   for update;
  if not found or v_rev is distinct from p_rev then
    raise exception using errcode = 'P0001', message = 'studio:conflict';
  end if;
  if v_draft is null then
    raise exception using errcode = 'P0001', message = 'studio:nothing_to_publish';
  end if;

  update public.service_content s
     set published = s.draft, draft = null, published_at = now(), rev = s.rev + 1, updated_at = now()
   where s.account_id = p_account and s.slug = p_slug
  returning s.rev into v_rev;
  return v_rev;
end;
$$;

revoke all on function public.studio_publish_service(uuid, text, integer) from public, anon;
grant execute on function public.studio_publish_service(uuid, text, integer) to authenticated;

create or replace function public.studio_discard_service_draft(
  p_account uuid,
  p_slug    text,
  p_rev     integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rev integer;
begin
  perform public.studio_service_guard(p_account, p_slug);

  select s.rev into v_rev
    from public.service_content s
   where s.account_id = p_account and s.slug = p_slug
   for update;
  if not found then
    return 0;
  end if;
  if v_rev is distinct from p_rev then
    raise exception using errcode = 'P0001', message = 'studio:conflict';
  end if;

  update public.service_content s
     set draft = null, rev = s.rev + 1, updated_at = now()
   where s.account_id = p_account and s.slug = p_slug
  returning s.rev into v_rev;
  return v_rev;
end;
$$;

revoke all on function public.studio_discard_service_draft(uuid, text, integer) from public, anon;
grant execute on function public.studio_discard_service_draft(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- On and off
-- ---------------------------------------------------------------------------

create or replace function public.studio_set_service_enabled(
  p_account uuid,
  p_slug    text,
  p_on      boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.studio_service_guard(p_account, p_slug);
  if p_slug is null or p_on is null then
    raise exception using errcode = 'P0001', message = 'studio:service';
  end if;

  insert into public.service_content (account_id, slug, enabled)
  values (p_account, p_slug, p_on)
  on conflict (account_id, slug) do update
    set enabled = excluded.enabled, updated_at = now();
  return p_on;
end;
$$;

revoke all on function public.studio_set_service_enabled(uuid, text, boolean) from public, anon;
grant execute on function public.studio_set_service_enabled(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- A place's photos in a new order
-- ---------------------------------------------------------------------------

-- p_photo_ids must be exactly the photos the place holds now, in the new
-- order. Anything else (a photo added or taken off in another tab since the
-- list was loaded) is refused as 'studio:stale', and nothing moves.
create or replace function public.studio_order_place(
  p_account   uuid,
  p_place     text,
  p_photo_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_have uuid[];
begin
  perform public.studio_service_guard(p_account, null);
  if p_place is null or length(p_place) > 72
     or p_place !~ '^(best-picks|service:[a-z0-9]+(-[a-z0-9]+)*)$' then
    raise exception using errcode = 'P0001', message = 'studio:place';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account::text || '/' || p_place, 0));

  select coalesce(array_agg(pl.photo_id order by pl.photo_id), '{}'::uuid[]) into v_have
    from public.photo_placements pl
   where pl.account_id = p_account and pl.place = p_place;

  if p_photo_ids is null
     or cardinality(p_photo_ids) <> cardinality(v_have)
     or (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(p_photo_ids) as x) <> v_have then
    raise exception using errcode = 'P0001', message = 'studio:stale';
  end if;

  update public.photo_placements pl
     set position = o.n
    from unnest(p_photo_ids) with ordinality as o(id, n)
   where pl.account_id = p_account and pl.place = p_place and pl.photo_id = o.id;
end;
$$;

revoke all on function public.studio_order_place(uuid, text, uuid[]) from public, anon;
grant execute on function public.studio_order_place(uuid, text, uuid[]) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Checks, any time after:
--
--   -- each service: on or off, published or not, a draft waiting or not
--   select slug, enabled, published is not null as published,
--          draft is not null as has_draft, rev, published_at
--     from public.service_content
--    order by slug;
--
-- Back to the code's version of one service (the Studio's edits to it are
-- lost; its on/off switch is kept):
--   update public.service_content set published = null, draft = null, rev = rev + 1
--    where slug = 'portraits';
--
-- UNDO. The site goes back to the code for every service, all of them on:
--   begin;
--   drop function if exists public.studio_order_place(uuid, text, uuid[]);
--   drop function if exists public.studio_set_service_enabled(uuid, text, boolean);
--   drop function if exists public.studio_discard_service_draft(uuid, text, integer);
--   drop function if exists public.studio_publish_service(uuid, text, integer);
--   drop function if exists public.studio_save_service_draft(uuid, text, jsonb, integer);
--   drop function if exists public.studio_services(uuid);
--   drop function if exists public.studio_service_guard(uuid, text);
--   drop table if exists public.service_content;
--   delete from supabase_migrations.schema_migrations where version = '20261120120000';
--   commit;
-- ---------------------------------------------------------------------------
