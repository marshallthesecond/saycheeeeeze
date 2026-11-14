-- Accounts, members, and "whose row is this" on every table.
--
-- Step 1 of the admin panel (the Studio). Nothing a visitor sees changes: no
-- column is removed or renamed, and no existing rule is loosened or tightened.
--
-- WHAT IT ADDS
--
--   accounts            one row per photographer. Yours is created here.
--   account_members     which login may work in which account.
--   reserved_usernames  words nobody may take as a username.
--   account_id          on galleries, photos, bookings, booking_attempts,
--                       blackout_dates and packages.
--   two read rules      a signed-in member can read the galleries and photos
--                       of their own account, including private and
--                       unpublished ones. That is what the Studio lists.
--
-- WHY account_id HAS A DEFAULT. The live site, reseed.ts, build-ladder.mjs and
-- the booking route all write rows without knowing accounts exist. The default
-- is your account, so every one of them keeps writing valid rows untouched.
-- Remove the default only when a second photographer is about to be created,
-- and only after every writer sets the column itself.
--
-- WHY photos HAS A TRIGGER AS WELL. A photo's account is its gallery's
-- account, always. The trigger copies it on insert, so the default can never
-- put a photo in the wrong account once there is more than one.
--
-- WHY THE GRANTS ARE SPELLED OUT. Supabase no longer exposes a new table to
-- the API roles by itself (see supabase/config.toml, auto_expose_new_tables).
-- A table created here is unreachable until it is granted, and on an older
-- project it is the opposite: reachable by everyone until revoked. Both are
-- handled, so the result is the same either way.
--
-- WRITES ARE NOT OPENED HERE. Members can read. Creating and editing galleries
-- from the Studio arrives with step 3 and its own migration.
--
-- RUN THE WHOLE FILE AT ONCE, including begin/commit. It is re-runnable.
-- Then record it, or a later `supabase db push` runs it again:
--
--   insert into supabase_migrations.schema_migrations (version, name)
--   values ('20261114190000', 'accounts_and_members');
--
-- AFTERWARDS, by hand, once (see claude/studio-setup.md in the project):
--   1. Dashboard > Authentication: turn OFF "Allow new users to sign up".
--   2. Dashboard > Authentication > Users: add your user (email + password).
--   3. Make that user the owner of your account:
--
--        insert into public.account_members (account_id, user_id, role)
--        select '6d16e09c-144c-43d7-aa82-040f3f609ae7', id, 'owner'
--          from auth.users where email = 'YOUR-EMAIL';

begin;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id                  uuid primary key default gen_random_uuid(),

  -- The public name in addresses. 3 to 30 characters: lowercase letters,
  -- digits and single hyphens, starting and ending with a letter or digit.
  -- Renaming is not offered yet; when it is, old names must redirect.
  username            text not null unique
                        check (username ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
                               and username !~ '--'),

  display_name        text not null check (char_length(display_name) between 1 and 120),

  status              text not null default 'active'
                        check (status in ('active', 'suspended', 'closed')),
  plan                text not null default 'free',

  -- Where this account's files live. One shared zone ('main') and a folder
  -- per photographer; '' means the zone root, which is where your files
  -- already are. A big studio can get its own zone later by changing these
  -- two values and copying its files.
  storage_zone        text not null default 'main',
  storage_prefix      text not null default ''
                        check (storage_prefix !~ '^/' and storage_prefix !~ '/$'),

  -- Kept up to date by the worker (step 4). NULL quota = no limit.
  storage_used_bytes  bigint not null default 0 check (storage_used_bytes >= 0),
  storage_quota_bytes bigint check (storage_quota_bytes is null or storage_quota_bytes >= 0),

  default_locale      text not null default 'ru'
                        check (default_locale in ('en', 'ru', 'uz')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

comment on table public.accounts is
  'One row per photographer. Every other table points here through account_id.';

-- ---------------------------------------------------------------------------
-- reserved usernames
--
-- Usernames will sit in the address right after the domain, next to the
-- site's own pages. A photographer called "portfolio" or "api" would shadow a
-- real page, and "admin" or "support" would be a gift to an impostor.
-- ---------------------------------------------------------------------------
create table if not exists public.reserved_usernames (
  username text primary key
);

insert into public.reserved_usernames (username) values
  -- the site's own pages and folders
  ('about'), ('album'), ('albums'), ('api'), ('book'), ('booking'), ('bookings'),
  ('client'), ('clients'), ('download'), ('downloads'), ('galleries'), ('gallery'),
  ('landing'), ('mini'), ('portfolio'), ('service'), ('services'), ('studio'),
  ('upload'), ('uploads'),
  -- accounts and access
  ('account'), ('accounts'), ('admin'), ('administrator'), ('auth'), ('dashboard'),
  ('login'), ('logout'), ('platform'), ('register'), ('settings'), ('signin'),
  ('signup'), ('user'), ('users'),
  -- things an impostor would want
  ('billing'), ('contact'), ('help'), ('legal'), ('official'), ('pay'), ('payment'),
  ('plans'), ('pricing'), ('privacy'), ('root'), ('security'), ('status'),
  ('support'), ('system'), ('terms'),
  -- technical
  ('app'), ('assets'), ('blog'), ('cdn'), ('docs'), ('favicon'), ('icon'), ('next'),
  ('null'), ('private'), ('public'), ('robots'), ('sitemap'), ('static'),
  ('undefined'), ('vercel'), ('www')
on conflict (username) do nothing;

create or replace function public.accounts_refuse_reserved_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.reserved_usernames r where r.username = new.username) then
    raise exception 'username "%" is reserved', new.username
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_refuse_reserved_username on public.accounts;
create trigger accounts_refuse_reserved_username
  before insert or update of username on public.accounts
  for each row execute function public.accounts_refuse_reserved_username();

-- ---------------------------------------------------------------------------
-- Your account. The id is fixed because the column defaults below name it.
-- The username is the value galleries.photographer_handle already holds.
-- ---------------------------------------------------------------------------
insert into public.accounts (id, username, display_name, plan)
values ('6d16e09c-144c-43d7-aa82-040f3f609ae7', 'saycheeeeeze', 'saycheeeeeze', 'founder')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- account_members
-- ---------------------------------------------------------------------------
create table if not exists public.account_members (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists account_members_user_idx
  on public.account_members (user_id);

comment on table public.account_members is
  'Which Supabase Auth user may work in which account, and as what.';

-- ---------------------------------------------------------------------------
-- my_account_ids(): the accounts the signed-in user belongs to.
--
-- SECURITY DEFINER so the rules below can ask it without first needing a rule
-- on account_members that would have to ask it back. It reads one thing, the
-- caller's own memberships, and takes no argument, so there is nothing to
-- trick it with. Called as `account_id in (select public.my_account_ids())`
-- Postgres runs it once per statement rather than once per row.
-- ---------------------------------------------------------------------------
create or replace function public.my_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.account_id
    from public.account_members m
   where m.user_id = (select auth.uid());
$$;

revoke all on function public.my_account_ids() from public, anon;
grant execute on function public.my_account_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- account_id on the existing tables
-- ---------------------------------------------------------------------------
alter table public.galleries
  add column if not exists account_id uuid not null
    default '6d16e09c-144c-43d7-aa82-040f3f609ae7'
    references public.accounts(id);

alter table public.photos
  add column if not exists account_id uuid not null
    default '6d16e09c-144c-43d7-aa82-040f3f609ae7'
    references public.accounts(id);

alter table public.bookings
  add column if not exists account_id uuid not null
    default '6d16e09c-144c-43d7-aa82-040f3f609ae7'
    references public.accounts(id);

alter table public.booking_attempts
  add column if not exists account_id uuid not null
    default '6d16e09c-144c-43d7-aa82-040f3f609ae7'
    references public.accounts(id);

alter table public.blackout_dates
  add column if not exists account_id uuid not null
    default '6d16e09c-144c-43d7-aa82-040f3f609ae7'
    references public.accounts(id);

alter table public.packages
  add column if not exists account_id uuid not null
    default '6d16e09c-144c-43d7-aa82-040f3f609ae7'
    references public.accounts(id);

create index if not exists galleries_account_idx
  on public.galleries (account_id, sort_order, created_at desc);

create index if not exists photos_account_idx
  on public.photos (account_id);

-- Two photographers may both want /albums/wedding-2026. The site-wide unique
-- constraint on slug stays for now, because addresses do not carry the
-- username yet; this one is what remains when it is dropped.
create unique index if not exists galleries_account_slug_key
  on public.galleries (account_id, slug);

-- A photo belongs to its gallery's account. Set on insert and whenever a photo
-- is moved to another gallery, whatever the writer sent.
create or replace function public.photos_set_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select g.account_id into strict new.account_id
    from public.galleries g
   where g.id = new.gallery_id;
  return new;
end;
$$;

drop trigger if exists photos_set_account on public.photos;
create trigger photos_set_account
  before insert or update of gallery_id on public.photos
  for each row execute function public.photos_set_account();

-- And if a gallery ever changes hands, its photos follow.
create or replace function public.galleries_carry_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.photos p
     set account_id = new.account_id
   where p.gallery_id = new.id
     and p.account_id is distinct from new.account_id;
  return null;
end;
$$;

drop trigger if exists galleries_carry_account on public.galleries;
create trigger galleries_carry_account
  after update of account_id on public.galleries
  for each row
  when (old.account_id is distinct from new.account_id)
  execute function public.galleries_carry_account();

-- Trigger functions cannot be called through the API at all, but there is no
-- reason for them to be listed there either.
revoke all on function
  public.accounts_refuse_reserved_username(),
  public.photos_set_account(),
  public.galleries_carry_account()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.accounts           enable row level security;
alter table public.account_members    enable row level security;
alter table public.reserved_usernames enable row level security;

-- Start from nothing, then grant exactly what is used.
revoke all on public.accounts, public.account_members, public.reserved_usernames
  from anon, authenticated;

grant select on public.accounts, public.account_members to authenticated;
grant all on public.accounts, public.account_members, public.reserved_usernames
  to service_role;

-- A member sees the accounts they belong to. Nobody else sees any account
-- through the API; public profile pages will read through the server.
drop policy if exists "accounts: members read their accounts" on public.accounts;
create policy "accounts: members read their accounts"
  on public.accounts for select
  to authenticated
  using (id in (select public.my_account_ids()));

-- A user sees their own memberships, not who else is in the account.
drop policy if exists "account_members: users read their own memberships" on public.account_members;
create policy "account_members: users read their own memberships"
  on public.account_members for select
  to authenticated
  using (user_id = (select auth.uid()));

-- reserved_usernames has no policy on purpose: the service role only.

-- Members read everything in their own account: private, unpublished and
-- client galleries included. These sit beside the two visitor rules from the
-- first migration and do not replace them; Postgres allows a row when ANY
-- rule does.
grant select on public.galleries, public.photos to authenticated;

drop policy if exists "galleries: members read their account" on public.galleries;
create policy "galleries: members read their account"
  on public.galleries for select
  to authenticated
  using (account_id in (select public.my_account_ids()));

drop policy if exists "photos: members read their account" on public.photos;
create policy "photos: members read their account"
  on public.photos for select
  to authenticated
  using (account_id in (select public.my_account_ids()));

commit;

-- ---------------------------------------------------------------------------
-- Checks, read-only. Run after the file.
--
--   -- one account, yours
--   select id, username, display_name, plan from public.accounts;
--
--   -- every existing row landed in it (each count should equal the table's)
--   select 'galleries' as t, count(*) filter (where account_id = '6d16e09c-144c-43d7-aa82-040f3f609ae7') as mine, count(*) as total from public.galleries
--   union all select 'photos',   count(*) filter (where account_id = '6d16e09c-144c-43d7-aa82-040f3f609ae7'), count(*) from public.photos
--   union all select 'bookings', count(*) filter (where account_id = '6d16e09c-144c-43d7-aa82-040f3f609ae7'), count(*) from public.bookings;
--
--   -- after step 3 of AFTERWARDS: you are the owner
--   select m.role, u.email from public.account_members m join auth.users u on u.id = m.user_id;
-- ---------------------------------------------------------------------------
