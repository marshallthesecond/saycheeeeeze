-- bookings.package_id stops being a foreign key to packages(id).
--
-- THE BUG THIS FIXES: every booking through the current route failed with
--
--   23503  insert or update on table "bookings" violates foreign key
--          constraint "bookings_package_id_fkey"
--          Key (package_id)=(session-1h) is not present in table "packages".
--
-- and the route turned that into a 503 the client read as "Something went
-- wrong." Not one booking has ever been written, because the constraint
-- rejects all 44 catalogue ids — every service tier AND all five graduation
-- tiers, which is why the graduation page never worked either.
--
-- WHY DROPPING IT IS RIGHT, not a workaround.
--
-- The 2026-09-08 refactor moved the price list into services.ts on purpose:
-- one module renders the price and validates it, in the same deployment, so
-- the two cannot drift. `packages` kept four generic rows for the /book form
-- and nothing else. The foreign key is the last piece of the OLD design still
-- being enforced — it demands that every bookable tier also exist as a row in
-- `packages`, which is precisely the second source of truth that refactor
-- removed. Satisfying it would mean seeding 44 duplicate price rows and
-- keeping them in step by hand for ever.
--
-- What we give up: referential integrity on a column whose authority lives in
-- code. There is nothing in the database left to reference. `package_id` is
-- now what it has actually been since September — a stable label recording
-- which tier was sold, resolved by findCatalogItem() at read time.
--
-- Rollback: re-add the constraint. Any booking taken in the meantime with a
-- catalogue id will block it until those rows are seeded or deleted.
--
--   alter table public.bookings
--     add constraint bookings_package_id_fkey
--     foreign key (package_id) references public.packages (id);

alter table public.bookings
  drop constraint if exists bookings_package_id_fkey;

-- Not null and not empty is the integrity that remains meaningful: a booking
-- must record WHAT was sold, even though the database can no longer say which
-- of the two catalogues the id came from.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_package_id_present'
  ) then
    alter table public.bookings
      add constraint bookings_package_id_present
      check (package_id is not null and length(trim(package_id)) > 0);
  end if;
end $$;

comment on column public.bookings.package_id is
  'Which tier was sold. A services.ts catalogue id (grad-campus-90m, portraits-1h, session-90m, …) or one of the four generic packages.id. NOT a foreign key: the catalogue lives in code, see claude/booking-flow.md. Resolve with findCatalogItem().';

-- Verify, after running:
--
--   select conname, contype, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'bookings'::regclass
--    order by conname;
--
-- bookings_package_id_fkey should be gone and bookings_one_live_per_day should
-- read `WHERE status = ANY (ARRAY['pending','confirmed'])`. If it does NOT
-- carry that WHERE clause, a declined or expired booking keeps holding its
-- date and expireStalePending() cannot release it —
-- scripts/diagnose-booking-insert.mjs step 4 tests exactly that.
