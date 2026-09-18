// Why does the booking INSERT fail? Asks Postgres directly and prints the raw
// error the route swallows into a 503.
//
//   node --env-file=.env.local scripts/diagnose-booking-insert.mjs
//   node --env-file=.env.local scripts/diagnose-booking-insert.mjs --keep
//
// Three steps, cheapest first:
//
//   1. COLUMN DIFF. PostgREST publishes an OpenAPI document at the REST root
//      listing every column of every table. Diffed against the exact keys
//      createBooking() writes, that names a missing column instantly — and a
//      missing column is the most likely cause, because `bookings` was created
//      by hand in the SQL editor rather than by a migration in this repo, so
//      nothing has ever forced the two into agreement.
//   2. THE REAL INSERT, with the payload the route sends, printing code,
//      message, details and hint verbatim.
//   3. BISECTION. If the insert failed, retry without the fields most likely
//      to be constrained — package_id, addons, status — to say which one it is
//      rather than guessing.
//
// The test row is deleted afterwards unless --keep. It uses a date 300 days
// out so it cannot collide with anything real, and a ref prefixed SC-DIAG.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const KEEP = process.argv.includes("--keep");

if (!URL_ || !KEY) {
  console.error("Missing Supabase env. Run with --env-file=.env.local");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const ref = `SC-DIAG${Math.floor(Math.random() * 90 + 10)}`;

/**
 * A date this many days out, one per variant.
 *
 * The first version of this script gave every variant the SAME date, so the
 * moment one of them inserted successfully the rest failed with 23505 on the
 * unique day constraint — three misleading "failures" that were really the
 * script colliding with itself. A bisection that cannot isolate one variable
 * is not a bisection.
 */
const dayOut = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const sessionDate = dayOut(300);

// EXACTLY what createBooking() writes. Keep in step with src/lib/bookings.ts —
// a diff against a stale copy of this list proves nothing.
const payload = {
  ref,
  session_date: sessionDate,
  start_time: "10:00",
  duration_minutes: 60,
  package_id: "session-1h",
  package_name: { en: "Photo session — 1 hour" },
  price_uzs: 250000,
  base_price_uzs: 250000,
  people_count: null,
  addons: [{ id: "location-wiut", qty: 1, unitPriceUzs: 0, people: 0 }],
  service_slug: null,
  location_id: "wiut",
  location_custom: null,
  client_name: "Insert Diagnostic",
  telegram_username: null,
  phone: "+998901112233",
  notes: "scripts/diagnose-booking-insert.mjs",
  locale: "en",
  source: "diagnostic",
  ip_hash: "diagnostic",
};

const show = (e) => {
  console.log(`     code    ${e.code ?? "—"}`);
  console.log(`     message ${e.message ?? "—"}`);
  if (e.details) console.log(`     details ${e.details}`);
  if (e.hint) console.log(`     hint    ${e.hint}`);
};

// 1. Column diff

console.log("\n1. Columns the table actually has\n");

let tableColumns = null;
try {
  const res = await fetch(`${URL_.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  const spec = await res.json();
  const props = spec?.definitions?.bookings?.properties;
  if (props) tableColumns = Object.keys(props);
} catch (e) {
  console.log(`     could not read the OpenAPI spec: ${String(e)}`);
}

if (!tableColumns) {
  console.log("     unavailable — skipping the diff, the insert below still tells us.");
} else {
  const writes = Object.keys(payload);
  const missing = writes.filter((c) => !tableColumns.includes(c));
  console.log(`     table has ${tableColumns.length} columns; the route writes ${writes.length}`);
  if (missing.length === 0) {
    console.log("     ✓  every column the route writes exists");
  } else {
    console.log(`     ✗  THE ROUTE WRITES COLUMNS THAT DO NOT EXIST: ${missing.join(", ")}`);
    console.log("");
    console.log("     That is the bug. PostgREST rejects the whole insert when any key is");
    console.log("     unknown, so no booking has ever been written. Add them:");
    console.log("");
    for (const c of missing) console.log(`       alter table bookings add column if not exists ${c} <type>;`);
  }
  // Columns the table requires that we never send would fail differently, so
  // they are worth naming too.
  const unsent = tableColumns.filter((c) => !writes.includes(c));
  if (unsent.length) console.log(`     (not written, presumably defaulted: ${unsent.join(", ")})`);
}

// 2. The real insert

console.log("\n2. The insert the route performs\n");

const attempt = async (body, label) => {
  const { data, error } = await db.from("bookings").insert(body).select().single();
  if (error) {
    console.log(`     ✗  ${label} failed`);
    show(error);
    return { ok: false, error };
  }
  console.log(`     ✓  ${label} succeeded — row ${data.ref}`);
  return { ok: true, data };
};

const first = await attempt(payload, "full payload");

// 3. Bisection

if (!first.ok) {
  console.log("\n3. Which field is it?\n");

  const variants = [
    ["package_id = 'graduation' (an id from the packages table)",
      { ...payload, ref: ref + "A", session_date: dayOut(301), package_id: "graduation" }],
    ["no addons",
      { ...payload, ref: ref + "B", session_date: dayOut(302), addons: [] }],
    ["explicit status 'pending'",
      { ...payload, ref: ref + "C", session_date: dayOut(303), status: "pending" }],
    ["bare minimum (package_name omitted \u2014 expected to fail, it is NOT NULL)", {
      ref: ref + "D",
      session_date: dayOut(304),
      start_time: "11:00",
      duration_minutes: 60,
      package_id: "session-1h",
      price_uzs: 250000,
      client_name: "Insert Diagnostic",
    }],
  ];

  const survivors = [];
  for (const [label, body] of variants) {
    const r = await attempt(body, label);
    if (r.ok) survivors.push({ label, ref: body.ref });
  }

  console.log("");
  if (survivors.length === 0) {
    console.log("     Every variant failed, including the minimum. The problem is not a");
    console.log("     single field — read the message above; it is most likely a missing");
    console.log("     column (step 1) or a NOT NULL with no default.");
  } else {
    console.log("     These worked, so the difference between them and the full payload is");
    console.log("     the cause:");
    for (const s of survivors) console.log(`       - ${s.label}`);
  }

  await probePartialIndex();

  if (!KEEP) {
    for (const s of survivors) await db.from("bookings").delete().eq("ref", s.ref);
    console.log("\n     (test rows removed)");
  }
  console.log();
  process.exit(1);
}

await probePartialIndex();

/**
 * Is the one-booking-per-day constraint PARTIAL?
 *
 * Everything about releasing a day assumes it is scoped to
 * status IN ('pending','confirmed') — that is what lets expireStalePending()
 * free a date by flipping the status to 'expired', and what lets a declined
 * booking stop holding its day. If the constraint covers every row regardless
 * of status, then neither works: an expired or declined booking blocks that
 * date forever and nothing in the app can unblock it.
 *
 * Tested rather than read, because the table was created in the SQL editor and
 * there is no migration in this repo to read it from. Insert, decline, insert
 * again on the same day: the second insert succeeding proves it is partial.
 */
async function probePartialIndex() {
  console.log("\n4. Does a declined booking still hold its day?\n");
  const date = dayOut(320);
  const a1 = `${ref}P1`;
  const a2 = `${ref}P2`;

  // package_id 'graduation' — the only kind the FK currently permits, so this
  // test works whether or not the foreign key has been dropped yet.
  const base = { ...payload, package_id: "graduation", session_date: date };

  const one = await db.from("bookings").insert({ ...base, ref: a1 }).select("ref").single();
  if (one.error) {
    console.log(`     could not set up the test: ${one.error.message}`);
    return;
  }

  await db.from("bookings").update({ status: "declined" }).eq("ref", a1);

  const two = await db.from("bookings").insert({ ...base, ref: a2, start_time: "14:00" }).select("ref").single();

  if (two.error?.code === "23505") {
    console.log("     ✗  NO — the constraint is NOT partial.");
    console.log("");
    console.log("     A declined or expired booking keeps holding its date, and nothing in");
    console.log("     the app can release it. expireStalePending() flips the status and the");
    console.log("     day stays blocked. Fix it with:");
    console.log("");
    console.log("       alter table bookings drop constraint bookings_one_live_per_day;");
    console.log("       create unique index bookings_one_live_per_day");
    console.log("         on bookings (session_date)");
    console.log("         where status in ('pending', 'confirmed');");
  } else if (two.error) {
    console.log(`     inconclusive: ${two.error.code} ${two.error.message}`);
  } else {
    console.log("     ✓  YES — the constraint is partial. A declined booking frees its day,");
    console.log("        so expireStalePending() does what it claims.");
  }

  if (!KEEP) {
    await db.from("bookings").delete().in("ref", [a1, a2]);
  }
}

// It worked.

console.log("\n   The insert works. So the 503 is not the insert itself —");
console.log("   re-run scripts/probe-booking.mjs and check the Vercel log line");
console.log("   \"Booking insert failed:\" for what the deployed build actually said.");
console.log("   A deployed build older than this checkout would explain the difference.");

if (!KEEP) {
  await db.from("bookings").delete().eq("ref", ref);
  console.log("\n   (test row removed)");
} else {
  console.log(`\n   Kept as ${ref} — remember it holds ${sessionDate}.`);
}
console.log();
