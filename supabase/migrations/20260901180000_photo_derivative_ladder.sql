-- ============================================================================
-- Derivative ladder — schema only. Nothing reads these columns yet.
--
-- Phase 2 of replacing Bunny Optimizer with pre-generated AVIF/WebP files.
-- The worker (Phase 3) fills these in; the renderer (Phase 4) starts reading
-- them. Applying this migration on its own changes no behaviour at all, which
-- is the point — it can go in well ahead of the code that uses it.
--
-- Storage layout the worker writes to, fixed by the token proof in Phase 0:
--
--   /d/{gallery_id}/{photo_id}/{checksum8}/{width}.avif
--   /d/{gallery_id}/{photo_id}/{checksum8}/{width}.webp
--   /d/{gallery_id}/{photo_id}/{checksum8}/download.jpg
--
-- gallery_id comes first so ONE Bunny directory token signed over
-- /d/{gallery_id}/ covers an entire private gallery — proven to work with
-- ?token_path= included in signing_data, and only that spelling.
--
-- The checksum in the path is what makes derivatives immutable. Reprocessing
-- writes to a new path; the old one simply ages out of the CDN. That is why
-- there is no cache-purge step anywhere in this design.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- The ladder columns
-- ---------------------------------------------------------------------------
alter table public.photos
  -- First 8 hex of sha256(original). Part of the derivative path, so changing
  -- the source file changes every URL and nothing stale can be served.
  add column checksum8 text
    check (checksum8 is null or checksum8 ~ '^[0-9a-f]{8}$'),

  -- ThumbHash, base64. ~25 bytes, decodes client-side to a blurred preview
  -- with the right colours and aspect. Replaces blur_data_url (dropped below),
  -- which held ~12 KB per photo because Bunny's resizer would not go small.
  add column thumbhash text,

  -- What actually exists on disk: [{"w":720,"a":41233,"p":58120}, ...]
  --   w = width, a = avif bytes, p = webp bytes
  -- The renderer builds its srcset from this, so a photo can never advertise
  -- a URL the worker did not write. Empty array = nothing built yet.
  add column variants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(variants) = 'array'),

  -- Size of the delivery JPEG, so the download UI can say "4.2 MB" without a
  -- HEAD request. Path is derivable from the columns above.
  add column delivery_bytes bigint check (delivery_bytes is null or delivery_bytes >= 0),

  -- Bump to force a rebuild after changing widths or encoder settings. The
  -- worker re-enqueues anything whose ladder_rev is behind the current one.
  add column ladder_rev int not null default 1,

  -- Worker state machine. Existing rows default to 'pending', which is
  -- correct: none of them have derivatives yet.
  add column status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed')),

  add column attempts int not null default 0 check (attempts >= 0),

  -- Set when a worker picks the row up. Not for concurrency control — there is
  -- exactly one worker, run by hand — but so a crashed or interrupted run can
  -- be recovered: anything 'processing' for longer than a sane encode is stale
  -- and safe to retry. Encoding 400 photos over a home connection WILL be
  -- interrupted at some point.
  add column claimed_at timestamptz,

  -- Last failure, for the operator. Keep messages free of keys and tokens:
  -- public.photos is readable by the anon role under the existing RLS policy,
  -- and albums.ts selects photos(*), so anything written here reaches the
  -- browser on album pages.
  add column error text;


-- ---------------------------------------------------------------------------
-- Drop the old placeholder
--
-- Safe: measured 2026-09-01, count(blur_data_url) = 0 across every row. The
-- backfill script never successfully ran, and it is obsolete either way —
-- scripts/backfill-blur.mjs can be deleted along with this column.
-- ---------------------------------------------------------------------------
alter table public.photos drop column if exists blur_data_url;


-- ---------------------------------------------------------------------------
-- Worker queue index
--
-- Partial, because 'ready' rows are the overwhelming majority once the
-- backfill finishes and there is no reason to index them. Mirrors the
-- photos_queue_idx pattern from the original migration.
-- ---------------------------------------------------------------------------
create index photos_ladder_queue_idx
  on public.photos (status, created_at)
  where status in ('pending', 'processing');

-- Lets the renderer ask "is this whole gallery ready?" without a sequential
-- scan, which is the check that gates turning the Optimizer off.
create index photos_gallery_status_idx
  on public.photos (gallery_id, status);


-- ---------------------------------------------------------------------------
-- Stale-claim recovery
--
-- Deliberately NOT the claim_photos() / FOR UPDATE SKIP LOCKED function from
-- the reference architecture. That exists to stop several always-on workers
-- claiming the same job; there is one worker here and it runs when Marshall
-- runs it. A plain reset is all the recovery this needs, and it is one
-- obvious statement instead of a stored procedure to keep in step.
-- ---------------------------------------------------------------------------
create or replace function public.reset_stale_photo_claims(older_than interval default '30 minutes')
returns integer
language sql
security invoker
set search_path = ''
as $$
  with reset as (
    update public.photos
       set status = 'pending', claimed_at = null
     where status = 'processing'
       and claimed_at < now() - older_than
    returning 1
  )
  select count(*)::int from reset;
$$;

comment on function public.reset_stale_photo_claims is
  'Requeues photos left in processing by an interrupted worker run.';


-- ---------------------------------------------------------------------------
-- Notes deliberately left in the schema
-- ---------------------------------------------------------------------------
comment on column public.photos.variants is
  'Built derivatives: [{"w":720,"a":<avif bytes>,"p":<webp bytes>}]. Empty until the worker runs.';
comment on column public.photos.checksum8 is
  'First 8 hex of sha256(original). Appears in the derivative path, making derivative URLs immutable.';
comment on column public.photos.thumbhash is
  'ThumbHash, base64, ~25 bytes. Inline placeholder; replaced blur_data_url.';
comment on column public.photos.ladder_rev is
  'Bump to force a rebuild after changing ladder widths or encoder settings.';
