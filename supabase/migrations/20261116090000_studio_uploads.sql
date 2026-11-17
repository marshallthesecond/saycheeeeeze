-- Uploading photographs from the Studio: the tables, the queue and the rules.
--
-- Step 4 of the admin panel. Nothing a visitor sees changes, and nothing the
-- scripts do changes: reseed.ts, build-ladder.mjs and /api/sync keep working
-- exactly as before, and stay as repair tools.
--
-- HOW AN UPLOAD WORKS
--
--   1. The Studio asks studio_create_upload_batch() for a ticket per file.
--      The database checks the gallery is yours, gives every file a name in
--      the gallery's folder that nothing else uses, reserves the photo's id,
--      and answers with the address of the worker (the "upload door") and a
--      one-off ticket per file.
--   2. The browser sends the files to the worker in pieces, with the ticket.
--   3. The worker has the whole file: worker_upload_received() skips it if
--      the gallery already has the same photograph, otherwise queues a job.
--   4. The worker builds the same 14 files as build-ladder.mjs, puts them and
--      the original in storage, then worker_complete_upload() inserts the
--      photos row, already 'ready', sets a cover if there is none, and counts
--      the bytes against the account.
--   5. When the last file of the drop is done, a finish_batch job puts the
--      gallery back in file-name order and refreshes the site's cache.
--
-- WHY THE PHOTO ROW COMES LAST. Pages read photos and nothing on the read
-- path filters by status, so a row without its files would show as a broken
-- or full-size image. Everything in flight lives in uploads instead.
--
-- WHY uploads HOLDS THE PRIVATE THINGS. A visitor can read every column of
-- photos in a public album. The original file name, the checksum and the
-- ticket stay in uploads, which only the account's members can read, and the
-- ticket's hash not even them.
--
-- WHY THE TICKETS ARE IN THE DATABASE. The worker checks a ticket by its hash
-- here, with the service key it already uses. So no new secret has to be
-- shared between Vercel and the laptop.
--
-- WHO WRITES WHAT
--   members (the Studio)  read their batches and uploads; everything else
--                         through the four studio_ functions below.
--   the worker            the service key, and the worker_ functions, which
--                         only the service key may call.
--   visitors              nothing here at all.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit, AFTER
-- 20261115100000_studio_gallery_writes.sql. It is re-runnable. Then record it:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261116090000', 'studio_uploads');

begin;

-- ---------------------------------------------------------------------------
-- Stop early, changing nothing, if this database is not what the file expects.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.accounts') is null then
    raise exception 'Run 20261114190000_accounts_and_members.sql first.';
  end if;
  if to_regprocedure('public.studio_set_cover(uuid, uuid)') is null then
    raise exception 'Run 20261115100000_studio_gallery_writes.sql first.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'gen_random_bytes' and n.nspname in ('public', 'extensions')
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'digest' and n.nspname in ('public', 'extensions')
  ) then
    raise exception 'pgcrypto is not installed in public or extensions. Tickets need gen_random_bytes() and digest().';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- workers: the machines that receive and process files. Today, the laptop.
-- ---------------------------------------------------------------------------
create table if not exists public.workers (
  -- Chosen by the worker (WORKER_NAME, or the computer's name).
  name              text primary key
                      check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'),
  version           text not null default '' check (char_length(version) <= 40),
  -- Where a browser sends files. http://127.0.0.1:7811 for the laptop itself;
  -- a tunnel address later.
  upload_url        text check (upload_url is null or upload_url ~ '^https?://[^[:space:]]{1,200}$'),
  accepting_uploads boolean not null default false,
  started_at        timestamptz not null default now(),
  -- Every 20 seconds while it runs. Older than 90 seconds = offline.
  last_seen_at      timestamptz not null default now()
);

comment on table public.workers is
  'Machines that receive uploads and run jobs. Online = last_seen_at within 90 seconds.';

-- ---------------------------------------------------------------------------
-- upload_batches: one drop of files into one gallery.
-- ---------------------------------------------------------------------------
create table if not exists public.upload_batches (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id),
  gallery_id      uuid not null references public.galleries(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  file_count      integer not null check (file_count between 1 and 500),
  total_bytes     bigint  not null check (total_bytes >= 0),
  -- Kept by a trigger on uploads; nothing writes these by hand.
  status          text not null default 'uploading'
                    check (status in ('uploading', 'processing', 'done', 'cancelled')),
  ready_count     integer not null default 0 check (ready_count >= 0),
  failed_count    integer not null default 0 check (failed_count >= 0),
  skipped_count   integer not null default 0 check (skipped_count >= 0),
  cancelled_count integer not null default 0 check (cancelled_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);

drop trigger if exists upload_batches_set_updated_at on public.upload_batches;
create trigger upload_batches_set_updated_at
  before update on public.upload_batches
  for each row execute function public.set_updated_at();

create index if not exists upload_batches_gallery_idx
  on public.upload_batches (gallery_id, created_at desc);
create index if not exists upload_batches_account_idx
  on public.upload_batches (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- uploads: one file.
--
--   waiting     ticket given out, nothing received yet
--   uploading   part of the file is on the worker
--   queued      all of it is on the worker, a job is waiting
--   processing  the worker is building it
--   ready       the photos row exists
--   failed      gave up; Retry is possible (error says why)
--   skipped     the gallery already has this photograph (error 'duplicate')
--   cancelled   the photographer took it out
-- ---------------------------------------------------------------------------
create table if not exists public.uploads (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.upload_batches(id) on delete cascade,
  account_id        uuid not null references public.accounts(id),
  gallery_id        uuid not null references public.galleries(id) on delete cascade,
  -- Reserved now because the derivative paths contain it; becomes photos.id.
  photo_id          uuid not null unique default gen_random_uuid(),
  original_name     text not null check (char_length(original_name) between 1 and 255),
  -- The original's place in storage: the gallery's folder and the file name
  -- given out here, which may differ from the original name ("-2" for a name
  -- already used, Latin letters only).
  storage_path      text not null
                      check (storage_path !~ '^/' and char_length(storage_path) <= 400),
  content_type      text not null check (content_type in ('image/jpeg', 'image/png')),
  size_bytes        bigint not null check (size_bytes between 1 and 104857600),
  bytes_received    bigint not null default 0,
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  sort_order        integer not null default 0,
  status            text not null default 'waiting'
                      check (status in ('waiting', 'uploading', 'queued', 'processing',
                                        'ready', 'failed', 'skipped', 'cancelled')),
  -- A short reason the Studio turns into a sentence, and the details for you.
  error             text check (error is null or error ~ '^[a-z_]{1,40}$'),
  error_detail      text check (error_detail is null or char_length(error_detail) <= 500),
  attempts          integer not null default 0 check (attempts >= 0),
  -- The worker holding the bytes. Only it can process them.
  worker            text,
  -- sha256 of the ticket, hex. The ticket itself is never stored. Kept after
  -- the file is done or cancelled, so the worker can answer a late request
  -- with what happened instead of "wrong ticket"; it expires anyway.
  ticket_hash       text check (ticket_hash is null or ticket_hash ~ '^[0-9a-f]{64}$'),
  ticket_expires_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  received_at       timestamptz,
  finished_at       timestamptz,
  constraint uploads_bytes_received_range check (bytes_received between 0 and size_bytes)
);

drop trigger if exists uploads_set_updated_at on public.uploads;
create trigger uploads_set_updated_at
  before update on public.uploads
  for each row execute function public.set_updated_at();

create index if not exists uploads_batch_idx on public.uploads (batch_id, sort_order);
create index if not exists uploads_gallery_idx on public.uploads (gallery_id);
create index if not exists uploads_gallery_sha_idx
  on public.uploads (gallery_id, sha256) where sha256 is not null;

-- Two files on their way into one gallery can never be given the same name.
-- Bunny paths are case-sensitive, Windows is not, so compare in lower case.
create unique index if not exists uploads_gallery_path_live_key
  on public.uploads (gallery_id, lower(storage_path))
  where status not in ('ready', 'skipped', 'cancelled');

comment on table public.uploads is
  'One file sent from the Studio. Private to the account: original name, checksum, ticket.';

-- ---------------------------------------------------------------------------
-- photos.upload_id: which upload made this photo. NULL = made by the scripts.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists upload_id uuid references public.uploads(id) on delete set null;

create index if not exists photos_upload_idx
  on public.photos (upload_id) where upload_id is not null;

-- ---------------------------------------------------------------------------
-- jobs: the queue the worker works through.
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id           bigint generated always as identity primary key,
  -- delete_files and backup_db arrive with step 6; listed now so that step
  -- needs no change to this table.
  kind         text not null
                 check (kind in ('process_upload', 'finish_batch', 'delete_files', 'backup_db')),
  payload      jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Only this worker may run the job (it holds the file). NULL = any worker.
  worker       text,
  status       text not null default 'queued'
                 check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  run_after    timestamptz not null default now(),
  attempts     integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  claimed_by   text,
  claimed_at   timestamptz,
  heartbeat_at timestamptz,
  error        text check (error is null or char_length(error) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create index if not exists jobs_queue_idx on public.jobs (run_after, id) where status = 'queued';
create index if not exists jobs_running_idx on public.jobs (claimed_by) where status = 'running';

-- One live job per file, and one waiting finish per drop.
create unique index if not exists jobs_process_upload_live_key
  on public.jobs ((payload->>'upload_id'))
  where kind = 'process_upload' and status in ('queued', 'running');
create unique index if not exists jobs_finish_batch_queued_key
  on public.jobs ((payload->>'batch_id'))
  where kind = 'finish_batch' and status = 'queued';

-- ---------------------------------------------------------------------------
-- A drop's counts and status follow its files.
--
-- Counted again from the rows on every change rather than added up, so a
-- missed or repeated event can never leave the numbers wrong. A drop has at
-- most 500 files.
-- ---------------------------------------------------------------------------
create or replace function public.uploads_sync_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch  uuid := coalesce(new.batch_id, old.batch_id);
  v_old    text;
  v_status text;
  c        record;
begin
  select b.status into v_old
    from public.upload_batches b
   where b.id = v_batch
     for update;
  -- The drop itself is being deleted (its gallery went). Nothing to count.
  if not found then
    return null;
  end if;

  select count(*)                                              as total,
         count(*) filter (where u.status = 'ready')            as ready,
         count(*) filter (where u.status = 'failed')           as failed,
         count(*) filter (where u.status = 'skipped')          as skipped,
         count(*) filter (where u.status = 'cancelled')        as cancelled,
         count(*) filter (where u.status in ('waiting', 'uploading')) as sending
    into c
    from public.uploads u
   where u.batch_id = v_batch;

  v_status := case
    when c.total > 0 and c.cancelled = c.total then 'cancelled'
    when c.ready + c.failed + c.skipped + c.cancelled = c.total then 'done'
    when c.sending = 0 then 'processing'
    else 'uploading'
  end;

  update public.upload_batches b
     set ready_count     = c.ready,
         failed_count    = c.failed,
         skipped_count   = c.skipped,
         cancelled_count = c.cancelled,
         status          = v_status,
         finished_at     = case when v_status in ('done', 'cancelled')
                                then coalesce(b.finished_at, now()) end
   where b.id = v_batch;

  -- The drop has just finished with something new in it: put the gallery in
  -- order and refresh the site, once. A retry that finishes it again later
  -- queues another.
  if v_status = 'done' and v_old is distinct from 'done' and c.ready > 0 then
    insert into public.jobs (kind, payload)
    select 'finish_batch', jsonb_build_object('batch_id', v_batch)
     where not exists (
       select 1 from public.jobs j
        where j.kind = 'finish_batch' and j.status = 'queued'
          and j.payload->>'batch_id' = v_batch::text
     );
  end if;

  return null;
end;
$$;

drop trigger if exists uploads_sync_batch on public.uploads;
create trigger uploads_sync_batch
  after insert or update of status or delete on public.uploads
  for each row execute function public.uploads_sync_batch();

-- ---------------------------------------------------------------------------
-- Storage used: start from what is already there.
--
-- Until now nothing counted it, so every account reads 0. Only an account
-- still at 0 is filled in, so running this file again changes nothing. From
-- here on the worker adds what it stores.
-- ---------------------------------------------------------------------------
update public.accounts a
   set storage_used_bytes = coalesce((
         select sum(
                  coalesce(p.source_bytes, p.bytes, 0)
                  + coalesce(p.delivery_bytes, 0)
                  + coalesce(p.share_bytes, 0)
                  + coalesce((
                      select sum(
                               case when jsonb_typeof(v->'a') = 'number' then (v->>'a')::numeric else 0 end
                             + case when jsonb_typeof(v->'p') = 'number' then (v->>'p')::numeric else 0 end)
                        from jsonb_array_elements(p.variants) v
                    ), 0)
                )::bigint
           from public.photos p
          where p.account_id = a.id
       ), 0)
 where a.storage_used_bytes = 0;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants
--
-- Start from nothing, then grant exactly what is used, so the result is the
-- same under the old Supabase default (new tables open to everyone) and the
-- new one (new tables open to no one).
-- ---------------------------------------------------------------------------
alter table public.workers        enable row level security;
alter table public.upload_batches enable row level security;
alter table public.uploads        enable row level security;
alter table public.jobs           enable row level security;

revoke all on public.workers, public.upload_batches, public.uploads, public.jobs
  from anon, authenticated;
grant all on public.workers, public.upload_batches, public.uploads, public.jobs
  to service_role;

-- Members see whether a worker is on, not where it listens.
grant select (name, version, accepting_uploads, started_at, last_seen_at)
  on public.workers to authenticated;
drop policy if exists "workers: members read" on public.workers;
create policy "workers: members read"
  on public.workers for select
  to authenticated
  using (exists (select 1 from public.account_members m where m.user_id = (select auth.uid())));

grant select on public.upload_batches to authenticated;
drop policy if exists "upload_batches: members read their account" on public.upload_batches;
create policy "upload_batches: members read their account"
  on public.upload_batches for select
  to authenticated
  using (account_id in (select public.my_account_ids()));

-- Everything but the ticket's hash and the checksum.
grant select (
  id, batch_id, account_id, gallery_id, photo_id, original_name, storage_path,
  content_type, size_bytes, bytes_received, sort_order, status, error,
  error_detail, attempts, worker, ticket_expires_at, created_at, updated_at,
  received_at, finished_at
) on public.uploads to authenticated;
drop policy if exists "uploads: members read their account" on public.uploads;
create policy "uploads: members read their account"
  on public.uploads for select
  to authenticated
  using (account_id in (select public.my_account_ids()));

-- jobs: no policy and no grant for members or visitors. The service key only.

-- ---------------------------------------------------------------------------
-- The upload door: the worker a browser should send files to now.
-- ---------------------------------------------------------------------------
create or replace function public.upload_door()
returns table (name text, upload_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, w.upload_url
    from public.workers w
   where w.accepting_uploads
     and w.upload_url is not null
     and w.last_seen_at > now() - interval '90 seconds'
   order by w.last_seen_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- The Studio's four functions
--
-- SECURITY DEFINER, search_path pinned, every table named with its schema,
-- and the caller's membership checked first, the same way as step 3's.
-- Refusals are raised as 'studio:<reason>'.
-- ---------------------------------------------------------------------------

-- studio_create_upload_batch -------------------------------------------------
--
-- p_files: [{ "name": "IMG_0042.JPG", "file": "IMG_0042.jpg",
--             "type": "image/jpeg", "size": 61234567 }, ...]
--
-- "name" is the file's own name, kept for the photographer. "file" is the
-- name to store it under, already made safe by the Studio (Latin letters,
-- digits, dot, hyphen, underscore; a lower-case .jpg, .jpeg or .png). It is
-- checked again here, and given "-2", "-3"... if the gallery already uses it.
-- Files are kept in the order given, which is the order they will show in.
--
-- Answers { batch_id, door, worker, expires_at,
--           uploads: [{ id, name, file, size, token }] }.
-- The tokens are shown once: only their hashes are kept.
create or replace function public.studio_create_upload_batch(
  p_gallery_id uuid,
  p_files      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_gallery record;
  v_account record;
  v_door    record;
  v_folder  text;
  v_count   integer;
  v_total   bigint := 0;
  v_base    integer;
  v_batch   uuid;
  v_file    jsonb;
  v_name    text;
  v_stem    text;
  v_ext     text;
  v_try     text;
  v_n       integer;
  v_taken   text[] := '{}';
  v_token   text;
  v_expires timestamptz := now() + interval '12 hours';
  v_id      uuid;
  v_out     jsonb := '[]'::jsonb;
  v_i       integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  -- Locked: two drops into one gallery at the same moment must not be given
  -- the same file name.
  select g.id, g.account_id, g.kind, g.bunny_folder into v_gallery
    from public.galleries g
   where g.id = p_gallery_id
     and g.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  select a.status, a.storage_used_bytes, a.storage_quota_bytes into v_account
    from public.accounts a
   where a.id = v_gallery.account_id;
  if v_account.status is distinct from 'active' then
    raise exception using errcode = 'P0001', message = 'studio:not_member';
  end if;

  -- A hand-curated gallery has no folder of its own, and a folder inside the
  -- ladder's own output would be read as derivatives.
  v_folder := btrim(coalesce(v_gallery.bunny_folder, ''), '/');
  if v_folder = '' or v_folder ~* '^(d|clients/_d)(/|$)' then
    raise exception using errcode = 'P0001', message = 'studio:no_folder';
  end if;
  -- A client gallery's originals must sit under clients/, which the public
  -- zone refuses to serve. Anywhere else they would be public.
  if v_gallery.kind = 'client' and ('/' || lower(v_folder) || '/') not like '%/clients/%' then
    raise exception using errcode = 'P0001', message = 'studio:folder_not_private';
  end if;

  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception using errcode = 'P0001', message = 'studio:files';
  end if;
  v_count := jsonb_array_length(p_files);
  if v_count < 1 then
    raise exception using errcode = 'P0001', message = 'studio:files';
  end if;
  if v_count > 500 then
    raise exception using errcode = 'P0001', message = 'studio:too_many_files';
  end if;

  for v_file in select f.value from jsonb_array_elements(p_files) f loop
    if jsonb_typeof(v_file) <> 'object'
       or char_length(coalesce(v_file->>'name', '')) not between 1 and 255
       or coalesce(v_file->>'file', '') !~ '^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?\.(jpg|jpeg|png)$' then
      raise exception using errcode = 'P0001', message = 'studio:file_name';
    end if;
    if coalesce(v_file->>'type', '') not in ('image/jpeg', 'image/png')
       or ((v_file->>'type') = 'image/png') <> ((v_file->>'file') ~ '\.png$') then
      raise exception using errcode = 'P0001', message = 'studio:file_type';
    end if;
    if jsonb_typeof(v_file->'size') <> 'number'
       or (v_file->>'size') !~ '^[0-9]{1,12}$'
       or (v_file->>'size')::bigint not between 1 and 104857600 then
      raise exception using errcode = 'P0001', message = 'studio:file_size';
    end if;
    v_total := v_total + (v_file->>'size')::bigint;
  end loop;

  if v_account.storage_quota_bytes is not null
     and v_account.storage_used_bytes + v_total > v_account.storage_quota_bytes then
    raise exception using errcode = 'P0001', message = 'studio:quota';
  end if;

  select d.name, d.upload_url into v_door from public.upload_door() d;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:worker_offline';
  end if;

  -- After everything already in the gallery or on its way. finish_batch puts
  -- the gallery in file-name order once the drop is done.
  select greatest(
           coalesce((select max(p.sort_order) from public.photos p
                      where p.gallery_id = p_gallery_id), -1),
           coalesce((select max(u.sort_order) from public.uploads u
                      where u.gallery_id = p_gallery_id
                        and u.status not in ('skipped', 'cancelled')), -1)
         ) + 1
    into v_base;

  insert into public.upload_batches (account_id, gallery_id, created_by, file_count, total_bytes)
  values (v_gallery.account_id, p_gallery_id, v_uid, v_count, v_total)
  returning id into v_batch;

  for v_file in
    select f.value from jsonb_array_elements(p_files) with ordinality f(value, i) order by f.i
  loop
    v_name := v_file->>'file';
    v_ext  := substring(v_name from '\.([a-z]+)$');
    v_stem := left(v_name, char_length(v_name) - char_length(v_ext) - 1);
    v_try  := v_name;
    v_n    := 1;
    loop
      exit when not (lower(v_folder || '/' || v_try) = any (v_taken))
        and not exists (
          select 1 from public.photos p
           where p.gallery_id = p_gallery_id
             and lower(p.storage_path) = lower(v_folder || '/' || v_try))
        and not exists (
          select 1 from public.uploads u
           where u.gallery_id = p_gallery_id
             and u.status not in ('ready', 'skipped', 'cancelled')
             and lower(u.storage_path) = lower(v_folder || '/' || v_try));
      v_n := v_n + 1;
      if v_n > 999 then
        raise exception using errcode = 'P0001', message = 'studio:file_name';
      end if;
      v_try := left(v_stem, 94) || '-' || v_n || '.' || v_ext;
    end loop;
    v_taken := v_taken || lower(v_folder || '/' || v_try);

    v_token := encode(gen_random_bytes(24), 'hex');

    insert into public.uploads (
      batch_id, account_id, gallery_id, original_name, storage_path, content_type,
      size_bytes, sort_order, worker, ticket_hash, ticket_expires_at
    ) values (
      v_batch, v_gallery.account_id, p_gallery_id, v_file->>'name', v_folder || '/' || v_try,
      v_file->>'type', (v_file->>'size')::bigint, v_base + v_i, v_door.name,
      encode(digest(v_token, 'sha256'), 'hex'), v_expires
    )
    returning id into v_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'name', v_file->>'name',
      'file', v_try,
      'size', (v_file->>'size')::bigint,
      'token', v_token
    ));
    v_i := v_i + 1;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch,
    'door', v_door.upload_url,
    'worker', v_door.name,
    'expires_at', v_expires,
    'uploads', v_out
  );
end;
$$;

-- studio_renew_upload_tickets ------------------------------------------------
--
-- New tickets for the files of a drop that have not finished arriving: after
-- 12 hours, or when the worker changed. A file half sent to another worker
-- starts again from nothing, because its first half is on the other machine.
create or replace function public.studio_renew_upload_tickets(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_door    record;
  v_expires timestamptz := now() + interval '12 hours';
  v_token   text;
  v_out     jsonb := '[]'::jsonb;
  u         record;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  perform 1 from public.upload_batches b
   where b.id = p_batch_id
     and b.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  select d.name, d.upload_url into v_door from public.upload_door() d;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:worker_offline';
  end if;

  for u in
    select x.id, x.worker, x.bytes_received
      from public.uploads x
     where x.batch_id = p_batch_id
       and x.status in ('waiting', 'uploading')
     order by x.sort_order
       for update
  loop
    v_token := encode(gen_random_bytes(24), 'hex');
    update public.uploads x
       set ticket_hash       = encode(digest(v_token, 'sha256'), 'hex'),
           ticket_expires_at = v_expires,
           worker            = v_door.name,
           bytes_received    = case when u.worker is distinct from v_door.name then 0 else x.bytes_received end,
           status            = case when u.worker is distinct from v_door.name then 'waiting' else x.status end
     where x.id = u.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', u.id,
      'token', v_token,
      'bytes_received', case when u.worker is distinct from v_door.name then 0 else u.bytes_received end
    ));
  end loop;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'door', v_door.upload_url,
    'worker', v_door.name,
    'expires_at', v_expires,
    'uploads', v_out
  );
end;
$$;

-- studio_retry_upload --------------------------------------------------------
--
-- A failed file again. If the worker still has all of it, it is simply built
-- again ({ status: 'queued' }). Otherwise it has to be sent again, and the
-- answer carries a new ticket ({ status: 'waiting', door, token }).
-- A file that is not a JPEG or PNG fails the same way every time, so it is
-- refused.
create or replace function public.studio_retry_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  u       record;
  v_door  record;
  v_token text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  select x.id, x.status, x.error, x.worker, x.size_bytes, x.bytes_received, x.sha256 into u
    from public.uploads x
   where x.id = p_upload_id
     and x.account_id in (select public.my_account_ids())
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;
  if u.status <> 'failed' then
    raise exception using errcode = 'P0001', message = 'studio:not_failed';
  end if;
  if u.error in ('not_an_image', 'type_mismatch', 'too_large') then
    raise exception using errcode = 'P0001', message = 'studio:cannot_retry';
  end if;

  if u.bytes_received = u.size_bytes and u.sha256 is not null
     and coalesce(u.error, '') not in ('file_missing', 'checksum') then
    update public.uploads x
       set status = 'queued', error = null, error_detail = null, attempts = 0, finished_at = null
     where x.id = u.id;
    insert into public.jobs (kind, payload, worker)
    values ('process_upload', jsonb_build_object('upload_id', u.id), u.worker);
    return jsonb_build_object('id', u.id, 'status', 'queued');
  end if;

  select d.name, d.upload_url into v_door from public.upload_door() d;
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:worker_offline';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  update public.uploads x
     set status            = 'waiting',
         bytes_received    = 0,
         sha256            = null,
         received_at       = null,
         finished_at       = null,
         error             = null,
         error_detail      = null,
         attempts          = 0,
         worker            = v_door.name,
         ticket_hash       = encode(digest(v_token, 'sha256'), 'hex'),
         ticket_expires_at = now() + interval '12 hours'
   where x.id = u.id;

  return jsonb_build_object(
    'id', u.id,
    'status', 'waiting',
    'door', v_door.upload_url,
    'worker', v_door.name,
    'token', v_token
  );
end;
$$;

-- studio_cancel_uploads ------------------------------------------------------
--
-- Takes files out of a drop: all of it, or the ones named. A file the worker
-- is building right now, or one already in the gallery, is left alone.
create or replace function public.studio_cancel_uploads(
  p_batch_id   uuid,
  p_upload_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if (select auth.uid()) is null then
    raise exception using errcode = 'P0001', message = 'studio:not_signed_in';
  end if;

  perform 1 from public.upload_batches b
   where b.id = p_batch_id
     and b.account_id in (select public.my_account_ids());
  if not found then
    raise exception using errcode = 'P0001', message = 'studio:not_found';
  end if;

  with c as (
    update public.uploads x
       set status = 'cancelled', finished_at = now()
     where x.batch_id = p_batch_id
       and (p_upload_ids is null or x.id = any (p_upload_ids))
       and x.status in ('waiting', 'uploading', 'queued', 'failed')
    returning x.id
  )
  select coalesce(array_agg(c.id), '{}') into v_ids from c;

  update public.jobs j
     set status = 'cancelled', finished_at = now()
   where j.kind = 'process_upload'
     and j.status = 'queued'
     and (j.payload->>'upload_id')::uuid = any (v_ids);

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- The worker's functions. The service key only.
-- ---------------------------------------------------------------------------

-- worker_heartbeat: "I am here", every 20 seconds.
create or replace function public.worker_heartbeat(
  p_name       text,
  p_version    text,
  p_upload_url text,
  p_accepting  boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.workers (name, version, upload_url, accepting_uploads, last_seen_at)
  values (p_name, coalesce(p_version, ''), p_upload_url, coalesce(p_accepting, false), now())
  on conflict (name) do update
     set version           = excluded.version,
         upload_url        = excluded.upload_url,
         accepting_uploads = excluded.accepting_uploads,
         last_seen_at      = now();
$$;

-- worker_start: a worker that starts was not running a moment ago, so
-- whatever it had claimed goes back in the queue.
create or replace function public.worker_start(p_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs integer;
begin
  update public.jobs j
     set status = 'queued', claimed_by = null, claimed_at = null, heartbeat_at = null
   where j.status = 'running' and j.claimed_by = p_name;
  get diagnostics v_jobs = row_count;

  update public.uploads u
     set status = 'queued'
   where u.status = 'processing' and u.worker = p_name;

  update public.workers w set started_at = now() where w.name = p_name;
  return v_jobs;
end;
$$;

-- worker_claim_job: the next job this worker may run, or nothing.
create or replace function public.worker_claim_job(p_name text, p_kinds text[])
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A job whose worker went quiet for 15 minutes is somebody's again.
  update public.jobs j
     set status = 'queued', claimed_by = null, claimed_at = null, heartbeat_at = null
   where j.status = 'running'
     and j.heartbeat_at < now() - interval '15 minutes';

  return query
  update public.jobs j
     set status       = 'running',
         claimed_by   = p_name,
         claimed_at   = now(),
         heartbeat_at = now(),
         attempts     = j.attempts + 1
   where j.id = (
     select q.id
       from public.jobs q
      where q.status = 'queued'
        and q.run_after <= now()
        and q.kind = any (p_kinds)
        and (q.worker is null or q.worker = p_name)
      order by q.run_after, q.id
      limit 1
        for update skip locked
   )
  returning j.*;
end;
$$;

-- worker_job_heartbeat: "still on it", every 30 seconds of a long job.
create or replace function public.worker_job_heartbeat(p_job_id bigint, p_name text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with h as (
    update public.jobs j
       set heartbeat_at = now()
     where j.id = p_job_id and j.status = 'running' and j.claimed_by = p_name
    returning 1
  )
  select exists (select 1 from h);
$$;

-- worker_finish_job: done, try again in p_retry_in seconds, or give up.
-- Answers the job's new status. A job this worker no longer owns is left as
-- it is.
create or replace function public.worker_finish_job(
  p_job_id   bigint,
  p_name     text,
  p_ok       boolean,
  p_error    text default null,
  p_retry_in integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
begin
  select x.status, x.claimed_by, x.attempts, x.max_attempts into j
    from public.jobs x where x.id = p_job_id for update;
  if not found then
    return 'missing';
  end if;
  if j.status <> 'running' or j.claimed_by is distinct from p_name then
    return j.status;
  end if;

  if p_ok then
    update public.jobs x
       set status = 'done', finished_at = now(), error = null
     where x.id = p_job_id;
    return 'done';
  end if;

  if p_retry_in is not null and j.attempts < j.max_attempts then
    update public.jobs x
       set status = 'queued',
           run_after = now() + make_interval(secs => greatest(p_retry_in, 0)),
           claimed_by = null, claimed_at = null, heartbeat_at = null,
           error = left(p_error, 500)
     where x.id = p_job_id;
    return 'queued';
  end if;

  update public.jobs x
     set status = 'failed', finished_at = now(), error = left(p_error, 500)
   where x.id = p_job_id;
  return 'failed';
end;
$$;

-- worker_upload_received: the whole file is on the worker.
--
-- Skips it ('skipped') when the gallery already holds the same photograph, or
-- another file of the same content is on its way in; otherwise queues the job
-- that builds it ('queued'). Calling it again for a file already handled
-- answers that file's status and changes nothing.
--
-- "Already holds": the same first 8 hex of sha256 (photos.checksum8) AND the
-- same size. Photos made by the scripts have only those two to compare.
create or replace function public.worker_upload_received(
  p_upload_id uuid,
  p_name      text,
  p_sha256    text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
begin
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'worker_upload_received: sha256 must be 64 lower-case hex characters';
  end if;

  select x.id, x.gallery_id, x.status, x.size_bytes into u
    from public.uploads x where x.id = p_upload_id for update;
  if not found then
    return 'missing';
  end if;
  if u.status not in ('waiting', 'uploading') then
    return u.status;
  end if;

  -- One duplicate check at a time per gallery, so two identical files that
  -- arrive together cannot both pass it.
  perform 1 from public.galleries g where g.id = u.gallery_id for update;

  if exists (
       select 1 from public.photos p
        where p.gallery_id = u.gallery_id
          and p.checksum8 = left(p_sha256, 8)
          and coalesce(p.source_bytes, p.bytes) = u.size_bytes
     ) or exists (
       select 1 from public.uploads o
        where o.gallery_id = u.gallery_id
          and o.id <> u.id
          and o.sha256 = p_sha256
          and o.status in ('queued', 'processing')
     ) then
    update public.uploads x
       set status = 'skipped', error = 'duplicate', sha256 = p_sha256,
           bytes_received = x.size_bytes, received_at = now(), finished_at = now(),
           worker = p_name
     where x.id = u.id;
    return 'skipped';
  end if;

  update public.uploads x
     set status = 'queued', sha256 = p_sha256, bytes_received = x.size_bytes,
         received_at = now(), worker = p_name
   where x.id = u.id;

  insert into public.jobs (kind, payload, worker)
  values ('process_upload', jsonb_build_object('upload_id', u.id), p_name);

  return 'queued';
end;
$$;

-- worker_complete_upload: the files are in storage; the photo goes live.
--
-- In one transaction: inserts the photos row (born 'ready'), marks the upload
-- ready, sets the gallery's cover if it has none, and adds p_stored_bytes
-- (original + derivatives) to the account. Calling it again after a lost
-- answer returns the same photo and counts nothing twice.
--
-- If reseed.ts or /api/sync saw the original in the seconds before this and
-- made a 'pending' row for it, that row is replaced: it has no derivatives,
-- and its id is not the one in the derivative paths.
create or replace function public.worker_complete_upload(
  p_upload_id    uuid,
  p_name         text,
  p_photo        jsonb,
  p_stored_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  u        record;
  v_other  record;
begin
  select x.id, x.status, x.gallery_id, x.account_id, x.photo_id, x.storage_path,
         x.size_bytes, x.sort_order
    into u
    from public.uploads x where x.id = p_upload_id for update;
  if not found then
    raise exception 'worker_complete_upload: no upload %', p_upload_id;
  end if;

  if u.status = 'ready' and exists (select 1 from public.photos p where p.id = u.photo_id) then
    return u.photo_id;
  end if;
  if u.status <> 'processing' then
    raise exception 'worker_complete_upload: upload % is %, not processing', p_upload_id, u.status;
  end if;

  perform 1 from public.galleries g where g.id = u.gallery_id for update;

  select p.id, p.status into v_other
    from public.photos p
   where p.gallery_id = u.gallery_id
     and p.storage_path = u.storage_path
     and p.id <> u.photo_id;
  if found then
    if v_other.status = 'ready' then
      raise exception 'worker_complete_upload: % is already a ready photo', u.storage_path;
    end if;
    delete from public.photos p where p.id = v_other.id;
  end if;

  insert into public.photos (
    id, gallery_id, storage_path, alt, width, height, bytes, source_bytes,
    checksum8, thumbhash, variants, delivery_bytes, share_bytes, ladder_rev,
    status, attempts, error, claimed_at, sort_order, upload_id
  ) values (
    u.photo_id, u.gallery_id, u.storage_path,
    nullif(p_photo->>'alt', ''),
    (p_photo->>'width')::integer,
    (p_photo->>'height')::integer,
    u.size_bytes,
    u.size_bytes,
    p_photo->>'checksum8',
    p_photo->>'thumbhash',
    coalesce(p_photo->'variants', '[]'::jsonb),
    (p_photo->>'delivery_bytes')::bigint,
    (p_photo->>'share_bytes')::integer,
    coalesce((p_photo->>'ladder_rev')::integer, 1),
    'ready', 0, null, null, u.sort_order, u.id
  )
  on conflict (id) do nothing;

  update public.uploads x
     set status = 'ready', error = null, error_detail = null, finished_at = now(),
         worker = p_name
   where x.id = u.id;

  update public.galleries g
     set cover_path = u.storage_path
   where g.id = u.gallery_id and g.cover_path is null;

  update public.accounts a
     set storage_used_bytes = a.storage_used_bytes + greatest(coalesce(p_stored_bytes, 0), 0)
   where a.id = u.account_id;

  return u.photo_id;
end;
$$;

-- worker_set_photo_order: the gallery's photos in the order given (file-name
-- order, worked out by the worker the same way reseed.ts does it).
create or replace function public.worker_set_photo_order(p_gallery_id uuid, p_photo_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.photos p
     set sort_order = x.ord - 1
    from unnest(p_photo_ids) with ordinality as x(id, ord)
   where p.id = x.id
     and p.gallery_id = p_gallery_id
     and p.sort_order is distinct from (x.ord - 1)::integer;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function
  public.uploads_sync_batch(),
  public.upload_door()
  from public, anon, authenticated;

revoke all on function
  public.studio_create_upload_batch(uuid, jsonb),
  public.studio_renew_upload_tickets(uuid),
  public.studio_retry_upload(uuid),
  public.studio_cancel_uploads(uuid, uuid[])
  from public, anon;
grant execute on function
  public.studio_create_upload_batch(uuid, jsonb),
  public.studio_renew_upload_tickets(uuid),
  public.studio_retry_upload(uuid),
  public.studio_cancel_uploads(uuid, uuid[])
  to authenticated, service_role;

revoke all on function
  public.worker_heartbeat(text, text, text, boolean),
  public.worker_start(text),
  public.worker_claim_job(text, text[]),
  public.worker_job_heartbeat(bigint, text),
  public.worker_finish_job(bigint, text, boolean, text, integer),
  public.worker_upload_received(uuid, text, text),
  public.worker_complete_upload(uuid, text, jsonb, bigint),
  public.worker_set_photo_order(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function
  public.worker_heartbeat(text, text, text, boolean),
  public.worker_start(text),
  public.worker_claim_job(text, text[]),
  public.worker_job_heartbeat(bigint, text),
  public.worker_finish_job(bigint, text, boolean, text, integer),
  public.worker_upload_received(uuid, text, text),
  public.worker_complete_upload(uuid, text, jsonb, bigint),
  public.worker_set_photo_order(uuid, uuid[])
  to service_role;

grant execute on function public.upload_door() to service_role;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- Checks, read-only. Run after the file.
--
--   -- the four tables and the twelve functions
--   select to_regclass('public.workers'), to_regclass('public.upload_batches'),
--          to_regclass('public.uploads'), to_regclass('public.jobs');
--   select proname from pg_proc
--    where proname like 'studio\_%upload%' or proname like 'worker\_%'
--       or proname in ('upload_door', 'uploads_sync_batch')
--    order by 1;
--
--   -- storage counted so far, per account
--   select username, pg_size_pretty(storage_used_bytes) from public.accounts;
--
--   -- once the worker has run: is it online?
--   select name, version, accepting_uploads, now() - last_seen_at as quiet_for
--     from public.workers;
-- ---------------------------------------------------------------------------
