-- Several bookings on one date — for the fixed-slot events, and only those.
--
-- THE PROBLEM. `bookings_one_live_per_day` is a partial unique index on
-- session_date, and it is the lock the whole booking route is built around:
-- the INSERT is the check, so two people clicking at once cannot take the same
-- day. That is exactly right for a photographer who shoots one session a day.
--
-- It is wrong for one Sunday. The CCA mini-sessions sell EIGHT blocks of
-- 27 September 2026. Under the current index the first booking succeeds and
-- bookings two through eight are rejected with
--
--   23505  duplicate key value violates unique constraint
--          "bookings_one_live_per_day"
--
-- which the route turns into "that day was just taken" — a message that would
-- be true and useless, because the day is not taken, the 15:00 slot is.
--
-- THE FIX. Two partial indexes that between them cover every row:
--
--   package_id NOT LIKE 'mini-%'   one live booking per DATE        (unchanged)
--   package_id LIKE 'mini-%'       one live booking per DATE + TIME (new)
--
-- WHY THE PREDICATE KEYS ON package_id RATHER THAN A NEW COLUMN. A `slot_kind`
-- column would be the more orthodox answer and it is the right one if this
-- stops being an occasional thing. Today it would mean changing the insert in
-- createBooking(), the payload the route builds, the diagnostic script's
-- column diff and the table's shape, to express something a prefix already
-- says. The prefix is not an accident: src/lib/mini-sessions.ts exports
-- MINI_PACKAGE_PREFIX and every id it can produce starts with it.
--
-- KEEP THE TWO IN STEP. Rename the prefix in the app without renaming it here
-- and the day index silently starts rejecting the second mini-session of the
-- day — the old bug, back, and only visible to the second client.
--
-- RUN THE WHOLE FILE AT ONCE, INCLUDING begin/commit. `drop index` takes an
-- ACCESS EXCLUSIVE lock on the table and holds it to commit, so inside the
-- transaction there is no window where a booking can slip past an index that
-- is not there yet. Run the statements one at a time and that window is real.
--
-- RE-RUNNABLE, as of 2026-10-06. It was not: the second index had no `drop if
-- exists` beside it, so running the file twice stopped with
--
--   ERROR: 42P07: relation "bookings_one_live_per_slot" already exists
--
-- which aborts the transaction and rolls back EVERYTHING — including the drop
-- of the day index three lines above. The database is unchanged, which is the
-- safe outcome, but the message reads like a half-finished migration and it is
-- impossible to tell from the editor which index predicate actually survived.
-- Both are now dropped and rebuilt together, so running this file always ends
-- with both indexes in the state written below, whatever they were before.

begin;

-- Each has been both an index and a constraint over its life, so drop
-- whichever it is now. Dropping BOTH is what makes the file re-runnable.
alter table public.bookings drop constraint if exists bookings_one_live_per_day;
drop index if exists public.bookings_one_live_per_day;
alter table public.bookings drop constraint if exists bookings_one_live_per_slot;
drop index if exists public.bookings_one_live_per_slot;

-- Unchanged behaviour for every normal product: one live booking per date.
-- 'pending' counts, which is what makes a hold a hold; expireStalePending()
-- flips it to 'expired' and the day frees itself.
create unique index bookings_one_live_per_day
  on public.bookings (session_date)
  where status in ('pending', 'confirmed')
    and package_id not like 'mini-%';

-- Events: one live booking per date AND start time. Eight rows on one Sunday
-- are fine; two at 16:45 are not.
create unique index bookings_one_live_per_slot
  on public.bookings (session_date, start_time)
  where status in ('pending', 'confirmed')
    and package_id like 'mini-%';

comment on index public.bookings_one_live_per_day is
  'One live booking per date, for everything except the fixed-slot events. The INSERT is the lock — see src/app/api/booking/route.ts.';

comment on index public.bookings_one_live_per_slot is
  'Fixed-slot events only (package_id like ''mini-%''): one live booking per date AND start time. Paired with MINI_PACKAGE_PREFIX in src/lib/mini-sessions.ts.';

commit;

-- VERIFY, AFTER RUNNING — and prefer the script, which tests the behaviour
-- rather than the text:
--
--   node --env-file=.env.local scripts/check-slot-indexes.mjs
--
-- It exits 0 only when all four of these hold: a second ordinary booking on a
-- taken date is refused, two mini-sessions at different times on one date both
-- succeed, a duplicate slot is refused, and an ordinary booking and a
-- mini-session can share a date. The last one is the one that catches a day
-- index left at its old predicate while the slot index exists — a state the
-- two definitions below look fine in.
--
-- The definitions, if you want to read them:
--
--   select indexname, indexdef
--     from pg_indexes
--    where tablename = 'bookings'
--      and indexname like 'bookings_one_live%';
--
-- And prove it end to end — two mini-session rows on the same date at
-- different times must both insert, and a third at a time already used must
-- fail with 23505:
--
--   insert into bookings (ref, session_date, start_time, duration_minutes,
--                         package_id, package_name, price_uzs, base_price_uzs,
--                         client_name)
--   values ('SC-SLOT01', '2099-01-03', '15:00', 25, 'mini-probe-25m',
--           '{"en":"slot test"}', 170000, 170000, 'slot test'),
--          ('SC-SLOT02', '2099-01-03', '15:35', 25, 'mini-probe-25m',
--           '{"en":"slot test"}', 170000, 170000, 'slot test');
--
--   -- expected: 23505 on bookings_one_live_per_slot
--   insert into bookings (ref, session_date, start_time, duration_minutes,
--                         package_id, package_name, price_uzs, base_price_uzs,
--                         client_name)
--   values ('SC-SLOT03', '2099-01-03', '15:00', 25, 'mini-probe-25m',
--           '{"en":"slot test"}', 170000, 170000, 'slot test');
--
--   delete from bookings where ref like 'SC-SLOT%';
--
-- A 2099 date, not the event's own: a leftover test row on a real date blocks
-- a real booking, and these are easy to forget.
