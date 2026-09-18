// Submits a real booking to the deployed route and prints what actually came
// back — the status code and the body, not the form's "Something went wrong".
//
//   node --env-file=.env.local scripts/probe-booking.mjs
//   node --env-file=.env.local scripts/probe-booking.mjs --base http://localhost:3000
//   node --env-file=.env.local scripts/probe-booking.mjs --package portraits-90m
//   node --env-file=.env.local scripts/probe-booking.mjs --date 2026-12-14
//
// The form collapses every non-409 failure into one message, which is right
// for a client and useless for debugging: a 400 "bad package", a 429 rate
// limit and a 503 failed insert all look identical from the browser. This
// asks the same question the form asks and shows the answer.
//
// IT CREATES A REAL BOOKING if the route accepts it. The reference is printed;
// decline it from Telegram, or:
//   update bookings set status = 'declined' where ref = 'SC-XXXXX';
//
// The date defaults to 60 days out, which is inside maxAdvanceDays (120) and
// far enough ahead not to collide with anything you actually have.

import process from "node:process";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const BASE = (flag("--base") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("No base URL. Set NEXT_PUBLIC_SITE_URL or pass --base http://localhost:3000");
  process.exit(1);
}

const when = flag("--date") ?? (() => {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
})();

const packageId = flag("--package") ?? "session-1h";

const payload = {
  packageId,
  peopleCount: null,
  serviceSlug: null,
  isoDate: when,
  startTime: flag("--time") ?? "10:00",
  locationIds: ["wiut"],
  locationId: "wiut",
  locationCustom: null,
  name: "Probe Test",
  telegram: null,
  phone: "+998901112233",
  notes: "Automated probe from scripts/probe-booking.mjs — safe to decline.",
  locale: "en",
  consent: true,
  // Deliberately omitted: quotedPriceUzs. Sending a wrong one produces a 409
  // priceChanged, which would mask whatever the real failure is.
  website: "",
};

console.log(`\n  POST ${BASE}/api/booking`);
console.log(`  package ${packageId} · ${when} ${payload.startTime} · wiut\n`);

let res, body, raw;
try {
  res = await fetch(`${BASE}/api/booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  raw = await res.text();
  try { body = JSON.parse(raw); } catch { body = null; }
} catch (e) {
  console.error(`  Request failed outright: ${String(e)}`);
  console.error("  The site is unreachable, or the function timed out.\n");
  process.exit(1);
}

console.log(`  HTTP ${res.status}`);
console.log(`  ${raw.slice(0, 600)}\n`);

const err = body?.error;

if (res.ok) {
  console.log(`  Accepted. Reference ${body.reference}, status ${body.status}.`);
  console.log(`  Price ${body.priceLabel}, ${body.durationMinutes} minutes.`);
  console.log(body.botLink ? `  Client link: ${body.botLink}` : "  NO botLink — TELEGRAM_BOT_USERNAME is unset on the server.");
  console.log("\n  The admin notification is fire-and-forget; if it did not arrive,");
  console.log("  the reason is in the Vercel logs for /api/booking, not in this response.\n");
  process.exit(0);
}

// The route's own error vocabulary, mapped to what to do about it.
const EXPLAIN = {
  package: "The package id did not resolve. findCatalogItem() and the packages table both said no.\n  If this is a session-* or a <service>-* id, the deployed build predates the catalogue change.",
  name: "Server-side name validation. Not reachable from the real form.",
  contact: "Neither telegram nor phone was accepted.",
  telegram: "The telegram handle failed TELEGRAM_RE on the server.",
  phone: "The phone failed the 7-15 digit check.",
  location: "No location, too many, or a surcharged one typed instead of picked.",
  consent: "consent !== true.",
  date: "isoDate was not YYYY-MM-DD.",
  dayTaken: "That day already has a pending or confirmed booking.\n  If you do not recognise it, it is a stale hold — expireStalePending should have cleared it.\n  Check: select ref, status, created_at from bookings where session_date = '" + when + "';",
  dayClosed: "Outside the weekly hours, blacked out, or outside the lead/advance window.",
  runsPastClose: "The session would run past closing time on that weekday.",
  inThePast: "That start time has already passed.",
  badTime: "Not one of the offered start times, or an unparseable time.",
  outsideWindow: "Earlier than the day's opening time.",
  tooMany: "Rate limited — 10 submissions per IP hash per 24h. Wait, or clear booking_attempts.",
  priceChanged: "The server priced it differently from the quote sent. Not possible here — no quote was sent.",
  server: "THE INSERT FAILED. This is the interesting one.\n  createBooking() got a database error that was not a unique violation.\n  The message is in the Vercel logs: \"Booking insert failed: ...\"\n  Most likely a constraint on bookings — a CHECK or a foreign key on\n  package_id that the new session-*/<service>-* ids do not satisfy.",
};

console.log("  " + (EXPLAIN[err] ?? `Unrecognised error code: ${JSON.stringify(err)}`));
if (body?.message) console.log(`  Server said: ${body.message}`);
console.log();
process.exit(1);
