-- Download tiers
--
-- Lets a client choose what they actually take away, and lets the app say
-- honestly what each choice costs before they tap it.
--
-- ── Why three, and why these three ───────────────────────────
-- There is already a full-resolution q92 JPEG at {prefix}/download.jpg, and
-- there is already the untouched original at storage_path. What was missing
-- was a genuinely light file — the one a client sends to Instagram or
-- Telegram, where a 4 MB frame is 4 MB of someone's mobile data for no visible
-- gain. So the ladder gains {prefix}/share.jpg and the app gains three tiers:
--
--   share     ~400-600 KB   2048px wide, q82      posting, messaging
--   full      ~3-5 MB       full resolution, q92  printing, cropping, keeping
--   original  5-30 MB       untouched source      archive, retoucher
--
-- share.jpg is a NEW path under an existing prefix, not a rewrite of a file
-- already published, so it needs no ladder_rev bump and invalidates nothing at
-- the edge. See scripts/build-ladder.mjs --add-share.
--
-- ── Why the sizes are stored rather than probed ──────────────
-- The whole point of the chooser is that a client sees "24.6 MB" next to
-- "Original file" and picks deliberately. Discovering that with a HEAD request
-- per photo per tier would be hundreds of round trips to build one sheet, and
-- every one of them would need a signed URL. The worker already knows all
-- three numbers at encode time; it just was not writing two of them down.

begin;

-- ── photos ───────────────────────────────────────────────────

-- The ORIGINAL file's size. bigint rather than integer because a 16-bit TIFF
-- off a medium-format back goes past 2 GB, and a column that silently cannot
-- hold the value is worse than a wide one.
alter table public.photos
  add column if not exists source_bytes bigint;

-- share.jpg's size. Nullable on purpose: null means "this photo predates the
-- share tier", which is exactly the queue --add-share works from.
alter table public.photos
  add column if not exists share_bytes integer;

comment on column public.photos.source_bytes is
  'Bytes of the original at storage_path. Shown against the "Original file" download option.';
comment on column public.photos.share_bytes is
  'Bytes of {prefix}/share.jpg. NULL means the share tier has not been built for this photo yet.';

-- ── galleries ────────────────────────────────────────────────

-- Which tiers this gallery offers. Default is share + full: the two that cost
-- nothing to give away. Originals are added per gallery, deliberately, because
-- "you also get the raw files" is a thing you decide per client rather than a
-- property of the software.
--
-- This does NOT replace download_enabled. That column is the off switch for a
-- gallery where nothing at all may be taken; this one says what may be taken
-- when downloading is allowed. Collapsing them would mean "downloads off" and
-- "no tiers selected" were the same state, and they read very differently in a
-- dashboard.
alter table public.galleries
  add column if not exists download_tiers text[] not null
    default array['share', 'full']::text[];

-- <@ is "contained by", so this rejects a typo like 'origional' outright
-- rather than letting it sit in the column and silently offer nothing. At
-- least one tier is required — an empty array would be a second, subtler way
-- of expressing download_enabled = false.
alter table public.galleries
  drop constraint if exists galleries_download_tiers_valid;
alter table public.galleries
  add constraint galleries_download_tiers_valid check (
    download_tiers <@ array['share', 'full', 'original']::text[]
    and coalesce(array_length(download_tiers, 1), 0) >= 1
  );

comment on column public.galleries.download_tiers is
  'Which download tiers this gallery offers: any of share, full, original. Gated by download_enabled.';

commit;
