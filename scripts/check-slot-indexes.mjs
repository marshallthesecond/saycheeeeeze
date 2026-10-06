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
// database that behaves right. `create unique index` reports "already exists"
// whether the existing one carries the right predicate or an older one, so the
// SQL editor cannot tell you the answer either. What matters is four facts,
// and this asks the database for all four in the only language that cannot be
// misinterpreted — by trying:
//
//   1. a second ordinary booking on a taken date is REJECTED   (day index)
//   2. two mini-sessions on one date at different times SUCCEED (slot index)
//   3. a second mini-session at a time already sold is REJECTED (slot index)
//   4. an ordinary booking and a mini-session SHARE a date      (the predicate)
//
// Probe 4 is the one that catches a HALF-APPLIED migration: if the slot index
// was created but the day index still lacks `and package_id not like 'mini-%'`,
// probes 1-3 can all pass while the two indexes overlap, and the failure shows
// up live as a client being told the day is taken when it is not.
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
const NOT_NULL_VIOLATION = "23502";
const UNDEFINED_COLUMN = "42703";
const CHECK_VIOLATION = "23514";

/**
 * A complete booking, mirroring createBooking() in src/lib/bookings.ts.
 *
 * EVERY FIELD THE APP SENDS, and the reason is that there is no other source of
 * truth. `bookings` is not created by any migration in this repo — it predates
 * them — so the only description of it available locally is
 * `database.types.ts`, which is generated and gives columns and nullability but
 * says NOTHING about CHECK constraints.
 *
 * Two failures taught that the hard way, both on the first insert:
 *
 *   23502  base_price_uzs      a NOT NULL column, missed because this row was
 *                              first copied from a COMMENT in the migration
 *                              that predated the column
 *   23514  contact_required    a CHECK constraint that no generated type can
 *                              show, requiring a telegram handle or a phone
 *
 * Guessing a field at a time finds the next constraint one failed run later.
 * Mirroring the application's own insert ends that: whatever `bookings`
 * requires, a real booking satisfies it, because real bookings go in through
 * exactly these columns. Keep this in step with createBooking() and it stays
 * true; the preflight below is what tells you when it has stopped being.
 */
const row = (ref, packageId, startTime) => ({
  ref: `${REF}${ref}`,
  session_date: PROBE_DATE,
  start_time: startTime,
  duration_minutes: 25,
  package_id: packageId,
  package_name: { en: "index probe — safe to delete" },
  price_uzs: 1,
  base_price_uzs: 1,
  people_count: 1,
  addons: [],
  service_slug: "index-probe",
  // NOTHING OPTIONAL IS LEFT NULL, and that is the point.
  //
  // The second draft mirrored createBooking()'s COLUMN LIST but filled the
  // nullable ones with null — which is how `location_required` was found one
  // run after `contact_required`, both of them "at least one of this pair".
  // A null is a value this table may have an opinion about; every constraint
  // discovered so far has been satisfied by simply having something there.
  //
  // Both halves of each pair are set, because which half satisfies the check
  // is not something this script should need to know.
  location_id: "wiut",
  location_custom: "index probe",
  client_name: "index probe",
  telegram_username: "@indexprobe",
  phone: "+998000000000",
  notes: "index probe — safe to delete",
  locale: "en",
  source: "index-probe",
  ip_hash: "indexprobe",
  // The partial indexes are `where status in ('pending','confirmed')`, so a
  // probe row has to be live to be seen by them at all. Spelt out rather than
  // left to the column default, because the default is one more thing that
  // could change without this script noticing.
  status: "pending",
});

/**
 * What an insert's outcome actually means.
 *
 * The distinction that matters: a 23505 is the database ANSWERING the question,
 * anything else is the probe being broken. Conflating the two is how the last
 * version turned its own bug into three confident wrong verdicts.
 */
function classify(error) {
  if (!error) return { kind: "accepted" };
  if (error.code === UNIQUE_VIOLATION) {
    const index = (error.message.match(/unique constraint "([^"]+)"/) ?? [, null])[1];
    return { kind: "rejected", index, message: error.message };
  }
  return { kind: "broken", code: error.code, message: error.message };
}

async function insert(r) {
  const { error } = await db.from("bookings").insert(r);
  return classify(error);
}

/** A probe that could not run tells you about this script, not the database. */
function abortBroken(where, outcome) {
  console.log("");
  console.log(`  The probe could not run — this is about the script, not your indexes.`);
  console.log(`  ${where}: ${outcome.code} ${outcome.message}`);
  console.log("");
  if (outcome.code === NOT_NULL_VIOLATION || outcome.code === UNDEFINED_COLUMN) {
    console.log("  The `bookings` table has columns this script does not set.");
    console.log("  Add them to row() above, and keep it mirroring createBooking() in");
    console.log("  src/lib/bookings.ts — that insert is the only complete description of");
    console.log("  this table anywhere in the repo.");
    console.log("");
  }
  if (outcome.code === CHECK_VIOLATION) {
    console.log("  A CHECK constraint, which no generated type can show — `bookings` is not");
    console.log("  created by any migration in this repo, so nothing here describes it.");
    console.log("");
    console.log("  Rather than guess one constraint at a time, list them all. Run this in");
    console.log("  the SQL editor and make row() above satisfy everything it prints:");
    console.log("");
    console.log("    select con.conname, pg_get_constraintdef(con.oid) as definition");
    console.log("      from pg_constraint con");
    console.log("      join pg_class rel on rel.oid = con.conrelid");
    console.log("      join pg_namespace ns on ns.oid = rel.relnamespace");
    console.log("     where ns.nspname = 'public' and rel.relname = 'bookings'");
    console.log("       and con.contype = 'c'");
    console.log("     order by con.conname;");
    console.log("");
  }
  process.exitCode = 1;
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

/**
 * Can this script write a booking at all?
 *
 * Asked once, before any index reasoning, because a row the table rejects
 * produces a cascade of probe failures that all look like index problems and
 * none of which are. Both times this script has been wrong, the answer was
 * here.
 */
{
  const pre = await insert(row("00", "portraits-90m", "09:00"));
  if (pre.kind === "broken") {
    abortBroken("the preflight insert", pre);
    await cleanup();
    process.exit(1);
  }
  if (pre.kind === "rejected") {
    console.log("");
    console.log(`  The preflight row was rejected by ${pre.index} on an empty 2099 date.`);
    console.log("  Something else is using the probe's date or refs — clear them and retry:");
    console.log(`    node --env-file=.env.local scripts/check-slot-indexes.mjs --cleanup-only`);
    console.log("");
    await cleanup();
    process.exit(1);
  }
  await cleanup();
}

const results = [];
const note = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}`);
  if (detail) console.log(`          ${detail}`);
};

let broken = false;
console.log("");
try {
  // 1 — the day index still does its job for ordinary products.
  {
    const first = await insert(row("01", "portraits-90m", "10:00"));
    if (first.kind === "broken") { abortBroken("the very first insert", first); broken = true; }
    else {
      const second = await insert(row("02", "portraits-90m", "14:00"));
      if (second.kind === "broken") { abortBroken("the second insert", second); broken = true; }
      else {
        note(
          "a second ordinary booking on a taken date is refused",
          second.kind === "rejected",
          second.kind === "rejected"
            ? `rejected by ${second.index}`
            : "IT WAS ACCEPTED — the day index is missing entirely",
        );
      }
    }
  }

  // 2 — the one the migration is for.
  if (!broken) {
    await cleanup();
    const a = await insert(row("11", "mini-probe-25m", "15:00"));
    const b = await insert(row("12", "mini-probe-25m", "15:35"));
    if (a.kind === "broken" || b.kind === "broken") {
      abortBroken("a mini-session insert", a.kind === "broken" ? a : b);
      broken = true;
    } else {
      note(
        "two mini-sessions on one date at different times both succeed",
        a.kind === "accepted" && b.kind === "accepted",
        a.kind === "rejected"
          ? `the FIRST was rejected by ${a.index}, which should not happen on an empty date`
          : b.kind === "rejected"
            ? b.index === "bookings_one_live_per_day"
              ? "REJECTED BY THE DAY INDEX — the migration is NOT applied, or its day " +
                "index is the old one without `and package_id not like 'mini-%'`."
              : `rejected by ${b.index}`
            : "",
      );
    }
  }

  // 3 — and it is still a lock, not an opening.
  if (!broken) {
    const dup = await insert(row("13", "mini-probe-25m", "15:00"));
    if (dup.kind === "broken") { abortBroken("the duplicate-slot insert", dup); broken = true; }
    else {
      note(
        "a second mini-session at a time already sold is refused",
        dup.kind === "rejected" && dup.index === "bookings_one_live_per_slot",
        dup.kind === "accepted"
          ? "IT WAS ACCEPTED — the slot index is missing, and slots can be sold twice"
          : dup.index === "bookings_one_live_per_slot"
            ? null
            : `rejected by ${dup.index} rather than the slot index`,
      );
    }
  }

  // 4 — the two indexes must not overlap. Catches a half-applied migration.
  if (!broken) {
    await cleanup();
    const mini = await insert(row("21", "mini-probe-25m", "15:00"));
    const normal = await insert(row("22", "portraits-90m", "15:00"));
    if (mini.kind === "broken" || normal.kind === "broken") {
      abortBroken("the overlap probe", mini.kind === "broken" ? mini : normal);
      broken = true;
    } else {
      note(
        "an ordinary booking and a mini-session can share a date",
        mini.kind === "accepted" && normal.kind === "accepted",
        normal.kind === "rejected"
          ? `the ordinary booking was rejected by ${normal.index} — the two indexes ` +
            "OVERLAP. The slot index exists but the day index is still the old one."
          : mini.kind === "rejected"
            ? `the mini-session was rejected by ${mini.index}`
            : "",
      );
    }
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

if (broken) process.exit(1);

const failed = results.filter((r) => !r.pass);
console.log("");
if (failed.length === 0) {
  console.log("  All four hold. The slot migration is applied and working.\n");
} else {
  console.log(`  ${failed.length} of ${results.length} failed.`);
  console.log("");
  console.log("  The migration is not applied, or only half of it is. Paste the WHOLE of");
  console.log("  supabase/migrations/20260925090000_mini_session_slots.sql into the SQL");
  console.log("  editor and run it once — between its DROP and its CREATE there is no");
  console.log("  double-booking protection at all, so it must go in as one transaction.");
  console.log("");
  console.log("  If it stops with 42P07 \"bookings_one_live_per_slot already exists\", the");
  console.log("  whole transaction rolled back and NOTHING changed — including the drop.");
  console.log("  Add `drop index if exists public.bookings_one_live_per_slot;` next to the");
  console.log("  other drop at the top and run it again, so both indexes are rebuilt from");
  console.log("  scratch rather than one being left at whatever it was.");
  console.log("");
  console.log("  Then record it so `supabase db push` does not try again:");
  console.log("");
  console.log("    insert into supabase_migrations.schema_migrations (version, name)");
  console.log("    values ('20260925090000', 'mini_session_slots')");
  console.log("    on conflict (version) do nothing;");
  console.log("");
  process.exitCode = 1;
}
