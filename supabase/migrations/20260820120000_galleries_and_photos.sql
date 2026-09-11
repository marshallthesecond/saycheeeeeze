-- ============================================================================
-- galleries + photos — metadata only. Image bytes stay in Bunny.
--
-- Path convention: every *_path column stores a path RELATIVE to the storage
-- zone root, with NO leading slash ("Portraits/Sara/3M0A1432.png").
-- bunnyUrl() adds the hostname at read time, so changing pull zone or CDN
-- hostname is an env change, not a data migration.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- updated_at helper. Without this, updated_at is just a second created_at.
-- search_path is pinned to '' so the function can't be hijacked by a
-- shadowing schema (this is also what the Supabase security linter wants).
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- galleries
-- ---------------------------------------------------------------------------
create table public.galleries (
  id                  uuid primary key default gen_random_uuid(),

  -- The real key as far as the app is concerned: /albums/[slug].
  -- Constraint enforces lowercase, url-safe, hyphen-separated.
  slug                text not null unique
                        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),

  title               text not null check (char_length(title) between 1 and 200),

  -- Human label, often empty ("April 11th, 2026"). Deliberately text, not
  -- date: "since 2022" and "" are both valid values in the current data.
  date_label          text not null default '',
  location            text not null default '',
  year                text not null default '',
  description         text not null default '',

  -- Storage path, not a URL. Nullable: a gallery can exist before it has a
  -- cover picked.
  cover_path          text check (cover_path !~ '^/'),

  accent_color        text not null default '#111111'
                        check (accent_color ~* '^#[0-9a-f]{6}$'),

  photographer_handle text not null default 'saycheeeeeze',

  -- Bunny Storage folder to sync from ("Portraits/Sara"). NULL means the
  -- gallery is curated by hand from multiple folders (e.g. "greeeeen") and
  -- the sync job skips it.
  bunny_folder        text check (bunny_folder !~ '^/'),

  sort_order          integer not null default 0,

  -- Two separate gates, on purpose:
  --   is_published — author workflow. false = draft, not finished yet.
  --   visibility   — audience. 'public' now; 'unlisted'/'private' are the
  --                  hooks for client galleries later, unused today.
  -- Reads require BOTH. Collapsing them into one column would mean
  -- "unpublish" and "make private" are the same action, and they aren't.
  is_published        boolean not null default true,
  visibility          text not null default 'public'
                        check (visibility in ('public', 'unlisted', 'private')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger galleries_set_updated_at
  before update on public.galleries
  for each row execute function public.set_updated_at();

-- Covers the listing query (published galleries in display order).
create index galleries_published_order_idx
  on public.galleries (sort_order, created_at desc)
  where is_published;

comment on column public.galleries.cover_path is
  'Bunny storage path, no leading slash. bunnyUrl() builds the CDN URL.';
comment on column public.galleries.bunny_folder is
  'Folder the sync job lists. NULL = hand-curated gallery, sync skips it.';


-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  gallery_id   uuid not null references public.galleries(id) on delete cascade,

  storage_path text not null check (storage_path !~ '^/'),

  -- Generated, not stored by hand: file_name and storage_path can never
  -- disagree, and the sync job has one less field to get right.
  file_name    text generated always as (regexp_replace(storage_path, '^.*/', '')) stored,

  alt          text,

  -- Nullable because the sync job may not have read them yet. Once present,
  -- the masonry grid can reserve space and stop shifting.
  width        integer check (width > 0),
  height       integer check (height > 0),

  -- Free derived column so the client never does the division. Used for
  -- column packing.
  aspect_ratio numeric(8,4) generated always as (
                 case
                   when width is not null and height is not null and height > 0
                   then round(width::numeric / height::numeric, 4)
                 end
               ) stored,

  bytes        bigint check (bytes >= 0),
  taken_at     timestamptz,

  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),

  -- The idempotency anchor: the sync job upserts on this, so re-running it
  -- updates rows instead of duplicating them.
  unique (gallery_id, storage_path)
);

-- Covers "give me this gallery's photos in order". id as a tiebreaker keeps
-- pagination stable when several photos share a sort_order.
create index photos_gallery_order_idx
  on public.photos (gallery_id, sort_order, id);


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The service role bypasses RLS entirely, so everything below describes what
-- the *browser* (anon key) can do. Server-side writes are unaffected.
-- ---------------------------------------------------------------------------
alter table public.galleries enable row level security;
alter table public.photos    enable row level security;

-- Read a gallery only when it is both finished and meant for everyone.
-- When private galleries arrive, this policy is the only thing that changes.
create policy "galleries: anon read published public galleries"
  on public.galleries for select
  to anon, authenticated
  using (is_published and visibility = 'public');

-- A photo is readable exactly when its gallery is. The gallery predicate is
-- repeated in full rather than relying on the galleries policy applying
-- inside this subquery — that behaviour is easy to get wrong, and getting it
-- wrong here means leaking every photo of an unpublished gallery. Explicit
-- is worth the duplication.
--
-- Per-photo visibility later = add "and photos.is_published" here, nothing
-- else moves.
create policy "photos: anon read photos of readable galleries"
  on public.photos for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.galleries g
      where g.id = photos.gallery_id
        and g.is_published
        and g.visibility = 'public'
    )
  );

-- No insert/update/delete policies exist, which already denies anon writes.
-- The revoke is belt-and-braces: it removes the table-level grant Supabase
-- hands out by default, so a future policy added by mistake still can't be
-- exercised without the grant coming back deliberately.
revoke insert, update, delete on public.galleries from anon, authenticated;
revoke insert, update, delete on public.photos    from anon, authenticated;
