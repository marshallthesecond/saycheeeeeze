// scripts/backfill-blur.mjs
//
// Generates the inline blur placeholder for every photo and writes it to
// photos.blur_data_url.
//
// Run it after applying supabase/migrations/0001_photo_blur_placeholder.sql:
//
//     node scripts/backfill-blur.mjs            # fill in what's missing
//     node scripts/backfill-blur.mjs --force    # regenerate everything
//     node scripts/backfill-blur.mjs --dry-run  # report, write nothing
//     node scripts/backfill-blur.mjs --limit 20 # try a handful first
//
// It is safe to run repeatedly, safe to interrupt, and safe to run against
// production: it only ever writes blur_data_url, and it skips rows that
// already have one unless you pass --force.
//
// ── No native dependencies ───────────────────────────────────
// There's no sharp, no canvas, no image library. Bunny already has an image
// pipeline, so the script asks the CDN for a 24px WebP and stores those bytes
// verbatim. The blur itself is a CSS filter in PhotoGrid, which is how
// Next.js's own blur placeholder works.
//
// Explicit `format=webp` matters here. Bunny's `quality` parameter has no
// effect on lossless output, and ~98% of this library is PNG — without the
// format switch you'd get a 24px PNG at several times the size, and Node's
// fetch doesn't send the Accept header that triggers Bunny's automatic
// negotiation the way a browser does.

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Environment ──────────────────────────────────────────────
// Reads .env.local the same way Next does, so there's nothing extra to set up.
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Absent file is fine — the variables may come from the shell.
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_ZONE = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE;
const PRIVATE_ZONE = process.env.BUNNY_PRIVATE_PULL_ZONE;
const PRIVATE_KEY = process.env.BUNNY_PRIVATE_TOKEN_KEY;

// Pull zones often have hotlink protection, which passes a browser (it sends a
// Referer) and rejects a bare script (it doesn't) with a 403 that looks exactly
// like a permissions problem.
//
// The app is not deployed, so there is no production domain to claim to be
// coming from. The only referrer that has legitimately hit this zone is the dev
// server. Set BUNNY_REFERER in .env.local to whatever your Bunny allow-list
// actually contains — diagnose-bunny.mjs prints the value that works.
//
// Set BUNNY_REFERER="" to send no Referer at all, which is correct when hotlink
// protection is off.
const REFERER =
  process.env.BUNNY_REFERER ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const REQUEST_HEADERS = {
  Accept: "image/webp,image/*,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (compatible; saycheeeeeze-backfill/1.0)",
};
if (REFERER) REQUEST_HEADERS.Referer = REFERER.replace(/\/$/, "") + "/";

const missing = [];
if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!PUBLIC_ZONE) missing.push("NEXT_PUBLIC_BUNNY_PULL_ZONE");
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("Add them to .env.local, or export them before running.");
  process.exit(1);
}

// ── Flags ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");
const limitFlag = argv.indexOf("--limit");
const LIMIT = limitFlag !== -1 ? Number(argv[limitFlag + 1]) : null;

// Keep in step with src/lib/image-variants.ts.
const BLUR_WIDTH = 24;
const BLUR_QUALITY = 45;

/** How many photos to fetch from Bunny at once. Polite, and plenty fast. */
const CONCURRENCY = 8;
/** Anything larger than this suggests the format switch didn't take effect. */
const SIZE_WARN_BYTES = 4000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Bunny URL construction ───────────────────────────────────
// Mirrors src/lib/bunny-sign.ts. Kept as a copy rather than an import because
// that module is "server-only" and importing it from a plain node script pulls
// in the whole Next runtime.

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalisePath(p) {
  return `/${String(p).replace(/^\/+/, "")}`;
}

function encodePath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

function blurUrl(storagePath, isPrivate) {
  const params = {
    format: "webp",
    quality: String(BLUR_QUALITY),
    width: String(BLUR_WIDTH),
  };

  if (!isPrivate) {
    const base = PUBLIC_ZONE.replace(/\/$/, "");
    const q = new URLSearchParams(params);
    return `${base}${encodePath(normalisePath(storagePath))}?${q}`;
  }

  if (!PRIVATE_ZONE || !PRIVATE_KEY) {
    throw new Error(
      "This gallery is private but BUNNY_PRIVATE_PULL_ZONE / BUNNY_PRIVATE_TOKEN_KEY are not set.",
    );
  }

  // Bunny token auth v2. The signature covers the query string, sorted and
  // decoded, which is why the params object above is built before signing.
  const path = normalisePath(storagePath);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const token = `HS256-${base64url(
    createHmac("sha256", PRIVATE_KEY).update(`${path}${expires}${signingData}`, "utf8").digest(),
  )}`;

  const q = new URLSearchParams(params);
  q.set("token", token);
  q.set("expires", String(expires));
  return `${PRIVATE_ZONE.replace(/\/$/, "")}${encodePath(path)}?${q}`;
}

// ── Work ─────────────────────────────────────────────────────

async function makeBlur(storagePath, isPrivate) {
  const url = blurUrl(storagePath, isPrivate);
  const res = await fetch(url, { headers: REQUEST_HEADERS });
  if (!res.ok) {
    // Include the query string — a 403 on the parameters means something very
    // different from a 403 on the file, and the old message hid which it was.
    const body = (await res.text().catch(() => "")).trim().slice(0, 120);
    throw new Error(`HTTP ${res.status} — ${url}${body ? ` — ${body}` : ""}`);
  }

  const type = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("empty response");

  return {
    dataUrl: `data:${type.startsWith("image/") ? type : "image/webp"};base64,${buf.toString("base64")}`,
    bytes: buf.length,
    type,
  };
}

async function main() {
  console.log(
    `\nBlur backfill — ${DRY_RUN ? "DRY RUN, nothing will be written" : "writing to Supabase"}${
      FORCE ? ", regenerating ALL rows" : ""
    }\n`,
  );

  // gallery_id → visibility, so each photo is fetched from the right zone.
  const { data: galleries, error: gErr } = await db
    .from("galleries")
    .select("id, visibility, slug");
  if (gErr) throw new Error(`Could not read galleries: ${gErr.message}`);

  const visibilityOf = new Map(galleries.map((g) => [g.id, g.visibility]));

  let query = db
    .from("photos")
    .select("id, storage_path, gallery_id, width, height, aspect_ratio, blur_data_url")
    .order("created_at", { ascending: true });
  if (!FORCE) query = query.is("blur_data_url", null);
  if (LIMIT) query = query.limit(LIMIT);

  const { data: photos, error: pErr } = await query;
  if (pErr) {
    if (/blur_data_url/.test(pErr.message)) {
      console.error(
        "The blur_data_url column doesn't exist yet.\n" +
          "Apply supabase/migrations/0001_photo_blur_placeholder.sql first.",
      );
      process.exit(1);
    }
    throw new Error(`Could not read photos: ${pErr.message}`);
  }

  if (photos.length === 0) {
    console.log("Nothing to do — every photo already has a placeholder.\n");
    return;
  }

  // The grid can lay itself out without loading anything ONLY when these are
  // present, so it's worth knowing about gaps even though this script can't
  // fill them from a 24px thumbnail.
  const noDimensions = photos.filter((p) => !p.aspect_ratio && !(p.width && p.height));

  console.log(`${photos.length} photo${photos.length === 1 ? "" : "s"} to process.\n`);

  let done = 0;
  let failed = 0;
  let totalBytes = 0;
  let sawNonWebp = false;
  const updates = [];
  const failures = [];

  const queue = [...photos];
  async function worker() {
    for (;;) {
      const photo = queue.shift();
      if (!photo) return;

      const isPrivate = visibilityOf.get(photo.gallery_id) === "private";
      try {
        const { dataUrl, bytes, type } = await makeBlur(photo.storage_path, isPrivate);
        if (!type.includes("webp")) sawNonWebp = true;
        totalBytes += bytes;
        updates.push({ id: photo.id, blur_data_url: dataUrl });
        done += 1;
      } catch (e) {
        failed += 1;
        failures.push(`${photo.storage_path} — ${e.message}`);
      }
      if ((done + failed) % 10 === 0 || queue.length === 0) {
        process.stdout.write(`\r  ${done + failed}/${photos.length}   `);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\r");

  if (!DRY_RUN && updates.length) {
    // Chunked upsert. onConflict on the primary key turns this into an UPDATE
    // of the one column; nothing else on the row is touched.
    for (let i = 0; i < updates.length; i += 100) {
      const chunk = updates.slice(i, i + 100);
      const { error } = await db.from("photos").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`Write failed at row ${i}: ${error.message}`);
      process.stdout.write(`\r  writing ${Math.min(i + 100, updates.length)}/${updates.length}   `);
    }
    process.stdout.write("\r");
  }

  const forbidden = failures.filter((f) => f.includes("HTTP 403")).length;
  if (forbidden) {
    console.log(
      `\n⚠  ${forbidden} request${forbidden === 1 ? "" : "s"} returned 403.\n` +
        `   Referer sent: ${REQUEST_HEADERS.Referer ?? "(none)"}\n` +
        "   Run  node scripts/diagnose-bunny.mjs  to find out which of hotlink\n" +
        "   protection, token auth on the public zone, or restricted Optimizer\n" +
        "   parameters is responsible. It tests each one separately.",
    );
  }

  const avg = done ? Math.round(totalBytes / done) : 0;
  console.log(`\nGenerated ${done}, failed ${failed}.`);
  console.log(`Average placeholder: ${avg} bytes. Total added to page payloads: ~${Math.round((totalBytes * 1.37) / 1024)} KB across all galleries.`);

  if (avg > SIZE_WARN_BYTES) {
    console.log(
      `\n⚠  ${avg} bytes is far larger than expected for a 24px WebP.\n` +
        "   Bunny Optimizer may not be enabled on the pull zone, in which case\n" +
        "   ?format= and ?width= are ignored and you just downloaded 24px-named\n" +
        "   full-size originals. Check Pull Zone → Optimizer.",
    );
  }
  if (sawNonWebp) {
    console.log(
      "\n⚠  At least one response was not image/webp. Same likely cause as above.",
    );
  }
  if (noDimensions.length) {
    console.log(
      `\n⚠  ${noDimensions.length} photo${noDimensions.length === 1 ? " has" : "s have"} no width/height/aspect_ratio.\n` +
        "   Those tiles fall back to measuring on load, which is the old reflowing\n" +
        "   behaviour. Fill those columns to get the zero-shift layout everywhere.",
    );
  }
  if (failures.length) {
    console.log(`\nFailures:\n${failures.slice(0, 20).map((f) => `  ${f}`).join("\n")}`);
    if (failures.length > 20) console.log(`  …and ${failures.length - 20} more.`);
  }
  if (DRY_RUN) console.log("\nDry run — nothing was written.");
  console.log();
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});