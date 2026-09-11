// scripts/diagnose-bunny.mjs
//
// Works out WHY a pull zone returns 403 to this machine when the same file
// loads fine in your browser. Run it and paste the whole output back.
//
//     node scripts/diagnose-bunny.mjs
//     node scripts/diagnose-bunny.mjs --path "WIUT-Fashion-Show-2026/3M0A1775.png"
//     node scripts/diagnose-bunny.mjs --referer http://localhost:3001
//
// Reads nothing, writes nothing, changes nothing.
//
// ── On referrers, for an app that isn't deployed ─────────────
// Hotlink protection compares the Referer header against an allow-list you set
// in the Bunny dashboard. There is no production domain yet, so the only
// referrer that has ever legitimately hit this zone is your dev server —
// http://localhost:3000. That's the default here.
//
// This matters as a diagnostic in its own right: if images already render at
// localhost:3000, then either hotlink protection is off or localhost is
// allowed, which makes hotlinking an unlikely explanation for the 403 and
// points at token authentication instead.
//
// ── The three things that produce a 403 here ─────────────────
//  1. Hotlink protection — the request needs a Referer this zone accepts.
//  2. Token authentication on the PUBLIC zone — every URL needs signing, not
//     just the private zone's.
//  3. Optimizer restricted to predefined image classes — the plain file is
//     served but ?width= / ?format= are refused.

import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* absent file is fine */
  }
}

const ZONE = (process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE ?? "").replace(/\/$/, "");
if (!ZONE) {
  console.error("NEXT_PUBLIC_BUNNY_PULL_ZONE is not set in .env.local.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : fallback;
};

const TEST_PATH = flag("path", "WIUT/5I9A3029.png");

// Where the app actually runs today. NOT a production domain — there isn't one.
const DEV_ORIGIN = flag("referer", "http://localhost:3000");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

/** Referrers worth trying, in the order most likely to be allowed. */
const REFERERS = [
  { label: "none (bare script)", value: null },
  { label: DEV_ORIGIN, value: `${DEV_ORIGIN.replace(/\/$/, "")}/` },
];
if (process.env.NEXT_PUBLIC_SITE_URL) {
  const site = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (!REFERERS.some((r) => r.value === `${site}/`)) {
    REFERERS.push({ label: `${site} (NEXT_PUBLIC_SITE_URL)`, value: `${site}/` });
  }
}

function encodePath(p) {
  return `/${String(p).replace(/^\/+/, "")}`.split("/").map(encodeURIComponent).join("/");
}

const base = `${ZONE}${encodePath(TEST_PATH)}`;

async function probe(url, referer) {
  const headers = { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" };
  if (referer) headers.Referer = referer;
  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    const type = res.headers.get("content-type") ?? "—";
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).trim().slice(0, 140).replace(/\s+/g, " ");
      return { ok: false, status: res.status, type, bytes: 0, body };
    }
    const bytes = Buffer.from(await res.arrayBuffer()).length;
    return { ok: true, status: res.status, type, bytes, body: "" };
  } catch (e) {
    return { ok: false, status: 0, type: "—", bytes: 0, body: `network error: ${e.message}` };
  }
}

console.log(`\nZone:  ${ZONE}`);
console.log(`Path:  ${TEST_PATH}`);
console.log(`URL:   ${base}\n`);

// ── Phase 1: can we get the plain file at all, and under what referrer? ──
console.log("Phase 1 — plain file, no Optimizer parameters\n");

let workingReferer = undefined; // undefined = none worked yet
let plain = null;

for (const ref of REFERERS) {
  const r = await probe(base, ref.value);
  console.log(`  Referer: ${ref.label}`);
  console.log(`    ${r.status}  ${r.type}  ${r.ok ? `${r.bytes} bytes` : r.body}\n`);
  if (r.ok && workingReferer === undefined) {
    workingReferer = ref.value;
    plain = r;
  }
}

if (workingReferer === undefined) {
  console.log("─".repeat(64));
  console.log(
    "\n  The plain file is refused under EVERY referrer, so this is not\n" +
      "  hotlink protection.\n\n" +
      "  Most likely: Token Authentication is enabled on the public pull zone\n" +
      `  (${ZONE.replace(/^https?:\/\//, "")}), so every URL needs signing —\n` +
      "  not just the private zone's. Check Pull Zone → Security →\n" +
      "  Token Authentication.\n\n" +
      "  Before assuming that, confirm two things:\n" +
      "    1. Does this exact URL open in your browser?\n" +
      `       ${base}\n` +
      "    2. Do images render when you run `npm run dev` and open the site?\n" +
      "       If they do, the browser is getting through where this script\n" +
      "       isn't, and the difference is a header — tell me and I'll widen\n" +
      "       the referrer list.\n" +
      "    If the URL 404s in the browser too, the storage path in Supabase is\n" +
      "    wrong and no amount of headers will fix it.\n",
  );
  process.exit(0);
}

// ── Phase 2: do Optimizer parameters survive? ──
console.log("Phase 2 — Optimizer parameters\n");

const withWidth = await probe(`${base}?width=24`, workingReferer);
console.log(`  ?width=24`);
console.log(`    ${withWidth.status}  ${withWidth.type}  ${withWidth.ok ? `${withWidth.bytes} bytes` : withWidth.body}\n`);

const full = await probe(`${base}?width=24&quality=45&format=webp`, workingReferer);
console.log(`  ?width=24&quality=45&format=webp`);
console.log(`    ${full.status}  ${full.type}  ${full.ok ? `${full.bytes} bytes` : full.body}\n`);

// ── Interpretation ───────────────────────────────────────────
console.log("─".repeat(64));
console.log("\nReading:\n");

const refLabel =
  workingReferer === null ? "no Referer at all" : `Referer ${workingReferer}`;

if (workingReferer !== null) {
  console.log(
    `  HOTLINK PROTECTION is on. The file is served with ${refLabel} and\n` +
      "  refused without one. The backfill needs to send that header —\n" +
      `  set BUNNY_REFERER=${workingReferer.replace(/\/$/, "")} in .env.local.\n`,
  );
}

if (!withWidth.ok) {
  console.log(
    "  OPTIMIZER PARAMETERS REJECTED. The plain file is served but ?width= is\n" +
      "  refused. That is Bunny set to allow only predefined image classes, or\n" +
      "  Optimizer not actually enabled on this zone.\n" +
      "  Check Pull Zone → Optimizer.\n",
  );
} else if (!full.ok) {
  console.log(
    "  ?width= works but ?format= is refused. Drop the explicit format and\n" +
      "  rely on Accept-header negotiation: set FORMAT = null in\n" +
      "  src/lib/image-variants.ts, and remove format from blurUrl() in\n" +
      "  scripts/backfill-blur.mjs.\n",
  );
} else {
  console.log(`  Optimizer works. 24px variant: ${full.type}, ${full.bytes} bytes.\n`);
  if (!full.type.includes("webp")) {
    console.log(
      "  ⚠  That is not image/webp, so format conversion is NOT taking effect.\n" +
        "     Since quality has no effect on lossless output, your PNGs are\n" +
        "     being resized and handed back as PNGs. Check Pull Zone → Optimizer.\n",
    );
  }
  if (plain && plain.bytes && full.bytes > plain.bytes * 0.25) {
    console.log(
      `  ⚠  The 24px variant (${full.bytes} B) is not much smaller than the\n` +
        `     original (${plain.bytes} B). Resizing may not be applied either.\n`,
    );
  }
}