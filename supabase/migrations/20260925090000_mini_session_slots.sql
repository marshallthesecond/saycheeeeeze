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
-- RUN THE WHOLE FILE AT ONCE. Between the DROP and the CREATE there is no
-- double-booking protection at all. In a migration that is one transaction; in
-- the SQL editor, paste all of it and press run once.

begin;

-- It has been both over its life, so drop whichever it is now.
alter table public.bookings drop constraint if exists bookings_one_live_per_day;
drop index if exists public.bookings_one_live_per_day;

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

-- Verify, after running. Both should be listed, with the predicates above:
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
--                         package_id, package_name, price_uzs, client_name)
--   values ('SC-SLOT01', '2026-09-27', '15:00', 25, 'mini-cca-25m',
--           '{"en":"slot test"}', 170000, 'slot test'),
--          ('SC-SLOT02', '2026-09-27', '15:35', 25, 'mini-cca-25m',
--           '{"en":"slot test"}', 170000, 'slot test');
--
--   -- expected: 23505 on bookings_one_live_per_slot
--   insert into bookings (ref, session_date, start_time, duration_minutes,
--                         package_id, package_name, price_uzs, client_name)
--   values ('SC-SLOT03', '2026-09-27', '15:00', 25, 'mini-cca-25m',
--           '{"en":"slot test"}', 170000, 'slot test');
--
--   delete from bookings where ref like 'SC-SLOT%';
