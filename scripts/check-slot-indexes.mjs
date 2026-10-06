// Is the mini-session slot migration actually applied?
//
//   node --env-file=.env.local scripts/check-slot-indexes.mjs
//   node --env-file=.env.local scripts/check-slot-indexes.mjs --cleanup-only
//
// WHY A BEHAVIOURAL PROBE RATHER THAN READING pg_indexes. Two reasons, and the
// second is the real one.
//
// The practical reason: supabase-js cannot run `select … from pg_indexes`. It
// speaks to PostgREST, which only exposes tables, views and RPCs — so checking
// the index DEFINITION from a script means either a direct Postgres connection
// string (which is not in .env.local) or adding an RPC, which is itself a
// migration and leaves you checking whether THAT one is applied.
//
// The better reason: an index definition that looks right is not the same as a
// database that behaves right. What actually matters is three facts, and this
// asks the database for all three in the only language that cannot be
// misinterpreted — by trying:
//
//   1. a second ordinary booking on a taken date is REJECTED   (day index)
//   2. two mini-sessions on one date at different times SUCCEED (slot index)
//   3. a second mini-session at a time already sold is REJECTED (slot index)
//
// Before the migration, probe 2 fails: the day index has no `package_id not
// like 'mini-%'` predicate, so it rejects mini-session number two with
// "bookings_one_live_per_day" — the exact bug the migration exists to fix, and
// the one that would have shown up live as the second client of the day being
// told the day was just taken.
//
// SAFETY. Everything is written on a date in 2099 with refs beginning SC-IDXQ,
// and the cleanup runs in a `finally` so an exception still takes the rows with
// it. The script re-reads the table afterwards and refuses to exit quietly if
// anything is left behind, because a stray probe row on a real date would
// silently block a real booking. 2099 also means that if cleanup somehow fails
// AND the warning is missed, nothing a client can book is affected.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!URL_ || !KEY) {
  console.error("\n  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("  Run with:  node --env-file=.env.local scripts/check-slot-indexes.mjs\n");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const PROBE_DATE = "2099-01-03";
const REF = "SC-IDXQ";
const UNIQUE_VIOLATION = "23505";

/** The smallest row the table accepts. Mirrors createBooking()'s NOT NULLs. */
const row = (ref, packageId, startTime) => ({
  ref: `${REF}${ref}`,
  session_date: PROBE_DATE,
  start_time: startTime,
  duration_minutes: 25,
  package_id: packageId,
  package_name: { en: "index probe — safe to delete" },
  price_uzs: 1,
  client_name: "index probe",
});

async function insert(r) {
  const { error } = await db.from("bookings").insert(r);
  return error;
}

async function cleanup() {
  const { error } = await db.from("bookings").delete().like("ref", `${REF}%`);
  if (error) return { ok: false, message: error.message };
  const { data } = await db.from("bookings").select("ref").like("ref", `${REF}%`);
  return { ok: (data ?? []).length === 0, left: (data ?? []).map((x) => x.ref) };
}

if (process.argv.includes("--cleanup-only")) {
  const c = await cleanup();
  console.log(c.ok ? "\n  Probe rows cleared.\n" : `\n  STILL THERE: ${JSON.stringify(c)}\n`);
  process.exit(c.ok ? 0 : 1);
}

// A probe row left over from an interrupted run would make probe 1 fail for the
// wrong reason, so clear first and say so rather than reporting a false result.
{
  const { data } = await db.from("bookings").select("ref").like("ref", `${REF}%`);
  if ((data ?? []).length > 0) {
    console.log(`\n  Clearing ${data.length} row(s) left by an earlier run.`);
    await cleanup();
  }
}

const results = [];
const note = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}`);
  if (detail) console.log(`          ${detail}`);
};

console.log("");
try {
  // 1 — the day index still does its job for ordinary products.
  {
    const first = await insert(row("01", "portraits-90m", "10:00"));
    const second = await insert(row("02", "portraits-90m", "14:00"));
    note(
      "a second ordinary booking on a taken date is refused",
      !first && second?.code === UNIQUE_VIOLATION,
      first
        ? `the FIRST insert failed, which is not about the indexes: ${first.message}`
        : second
          ? `rejected by ${(second.message.match(/"([^"]+)"/) ?? [, "?"])[1]}`
          : "IT WAS ACCEPTED — the day index is missing entirely",
    );
  }

  // 2 — the one the migration is for.
  {
    await cleanup();
    const a = await insert(row("11", "mini-probe-25m", "15:00"));
    const b = await insert(row("12", "mini-probe-25m", "15:35"));
    const which = b ? (b.message.match(/"([^"]+)"/) ?? [, "?"])[1] : null;
    note(
      "two mini-sessions on one date at different times both succeed",
      !a && !b,
      a
        ? `the first failed: ${a.message}`
        : b
          ? which === "bookings_one_live_per_day"
            ? "REJECTED BY THE DAY INDEX — the migration is NOT applied. " +
              "Run supabase/migrations/20260925090000_mini_session_slots.sql."
            : `rejected by ${which}: ${b.message}`
          : "",
    );
  }

  // 3 — and it is still a lock, not an opening.
  {
    const dup = await insert(row("13", "mini-probe-25m", "15:00"));
    const which = dup ? (dup.message.match(/"([^"]+)"/) ?? [, "?"])[1] : null;
    note(
      "a second mini-session at a time already sold is refused",
      dup?.code === UNIQUE_VIOLATION && which === "bookings_one_live_per_slot",
      dup
        ? which === "bookings_one_live_per_slot"
          ? null
          : `rejected by ${which} rather than the slot index — unexpected`
        : "IT WAS ACCEPTED — the slot index is missing, and slots can be sold twice",
    );
  }
} finally {
  const c = await cleanup();
  if (!c.ok) {
    console.log("");
    console.log(`  COULD NOT REMOVE THE PROBE ROWS: ${JSON.stringify(c)}`);
    console.log(`  Delete them by hand:  delete from bookings where ref like '${REF}%';`);
    process.exitCode = 1;
  }
}

const failed = results.filter((r) => !r.pass);
console.log("");
if (failed.length === 0) {
  console.log("  All three hold. The slot migration is applied and working.\n");
} else {
  console.log(`  ${failed.length} of ${results.length} failed.`);
  console.log("");
  console.log("  If probe 2 failed with bookings_one_live_per_day, the migration has not");
  console.log("  been run. Paste the WHOLE of");
  console.log("  supabase/migrations/20260925090000_mini_session_slots.sql into the SQL");
  console.log("  editor and run it once — between its DROP and its CREATE there is no");
  console.log("  double-booking protection at all, so it must go in as one transaction.");
  console.log("");
  console.log("  Then record it so `supabase db push` does not try again:");
  console.log("");
  console.log("    insert into supabase_migrations.schema_migrations (version, name)");
  console.log("    values ('20260925090000', 'mini_session_slots')");
  console.log("    on conflict (version) do nothing;");
  console.log("");
  process.exitCode = 1;
}
