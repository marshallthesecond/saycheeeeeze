// scripts/build-ladder.mjs
//
// Phase 3. Turns originals into the derivative ladder.
//
//   node --env-file=.env.local scripts/build-ladder.mjs --check           # prove write access
//   node --env-file=.env.local scripts/build-ladder.mjs --prune-legacy    # remove orphans
//                                       from an older path layout (--dry-run first)
//   node --env-file=.env.local scripts/build-ladder.mjs --gallery Sara --limit 1
//   node --env-file=.env.local scripts/build-ladder.mjs --gallery Sara
//   node --env-file=.env.local scripts/build-ladder.mjs              # everything pending
//   node --env-file=.env.local scripts/build-ladder.mjs --dry-run    # encode, upload nothing
//   node --env-file=.env.local scripts/build-ladder.mjs --retry-failed
//   node --env-file=.env.local scripts/build-ladder.mjs --retry-failed --retry-stale --stale-after 1
//   node --env-file=.env.local scripts/build-ladder.mjs --force --gallery Sara
//
// Needs:  npm i -D sharp thumbhash
//
// For each photo it writes, to the storage zone:
//
//   {prefix}/{width}.avif   ×6
//   {prefix}/{width}.webp   ×6
//   {prefix}/share.jpg      ×1
//   {prefix}/download.jpg   ×1
//
// where {prefix} is
//
//   d/{gallery_id}/{photo_id}/{checksum8}/v{LADDER_REV}           album
//   clients/_d/{gallery_id}/{photo_id}/{checksum8}/v{LADDER_REV}  client gallery
//
// See derivativePrefix() for why the root is keyed on gallery kind rather than
// visibility, and why the revision has to be in the path rather than only in a
// column.
//
// ...then records checksum8, thumbhash, variants, delivery_bytes and the true
// intrinsic dimensions on the row and flips status to 'ready'.
//
// ── Safe to interrupt ────────────────────────────────────────
// Ctrl-C at any point loses at most the photo in flight. Rows are only marked
// 'ready' after every byte is uploaded, so a half-finished photo stays
// 'processing' and `--retry-stale` puts it back in the queue. Derivative paths
// contain the content hash and the ladder revision, so re-running never serves
// a stale mix: anything that changes the output changes the directory, and the
// old one is simply orphaned.
//
// ── Measured cost, so you can plan a backfill ────────────────
// Profiled on a 24 MP photo-like source, 2 cores:
//
//   thumbhash raster            0.3 s
//   master (single downscale)   0.4 s
//   12 derivatives (avif+webp)  2.7 s
//   download.jpg q92            2.2 s
//   ────────────────────────────────
//   ~5.6 s per photo, and less on more cores
//
// Encoding is NOT the bottleneck. Downloading a 38 MB original over a domestic
// connection dwarfs it, so the wall-clock cost of a backfill is your link, not
// your CPU. Expect a few minutes for a gallery of small files and considerably
// longer for the 30 MB+ PNGs — the progress line will tell you which you are in.
//
// --read-ahead overlaps the next download with the current encode. It is off by
// default because on a constrained uplink it starves this photo's own uploads;
// see the note on readAhead() below.
//
// ── Why this is not the reference architecture's worker ──────
// No queue service, no FOR UPDATE SKIP LOCKED, no long-lived container. There
// is exactly one worker and it runs when you run it, so the concurrency
// machinery would be ceremony. `reset_stale_photo_claims()` in the Phase 2
// migration is the entire recovery story.

import { createHash } from "node:crypto";
import process from "node:process";

import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";
import { createClient } from "@supabase/supabase-js";

// ── Ladder ───────────────────────────────────────────────────
// Grid tiles are never displayed above ~720 CSS px even on a large screen;
// lightbox frames go to the display width. Generating 3840 for a grid tile is
// waste, generating only grid sizes makes the lightbox mushy.
//
// Trimmed deliberately (decided 2026-09-01): no 2560, no 3840. Every device a
// client actually opens their gallery on is covered by 2048, and each width
// dropped is ~8% off encode time, storage and bandwidth. Bump LADDER_REV in
// the database if you ever change this list.
const GRID_WIDTHS = [240, 480, 720];
const FULL_WIDTHS = [1080, 1440, 2048];
const ALL_WIDTHS = [...GRID_WIDTHS, ...FULL_WIDTHS];

const ENCODERS = {
  // AVIF is the primary. effort 4 is the knee of the curve — effort 6 costs
  // roughly double the CPU for low single-digit percent extra compression.
  avif: { quality: 50, effort: 4, chromaSubsampling: "4:2:0" },
  // WebP is the only fallback worth shipping. AVIF covers Chrome, Firefox and
  // Safari 16+; JPEG as a third source is dead weight.
  webp: { quality: 78, effort: 5 },
};

// What the client downloads. Full resolution, visually indistinguishable from
// the 37 MB PNG original, roughly a tenth the size — which is the difference
// between a 300-photo gallery being an 11 GB download and a 1.5 GB one.
const DELIVERY = { quality: 92, mozjpeg: true, chromaSubsampling: "4:2:0" };

// The light download — "For sharing" in the client's chooser.
//
// Derived from the MASTER, not the original, which is the opposite of the
// decision above and for the opposite reason: this is the one output whose
// entire purpose is to be small. The master is already at the widest rung
// (2048 unless the original is narrower, which withoutEnlargement handles), so
// this costs one extra encode and no extra decode of the full-size file.
//
// q82 rather than q92 because it will be looked at on a phone, recompressed by
// whatever app it is posted to, and never printed. The difference between this
// and the full-quality file is roughly 4 MB against 500 KB.
const SHARE_JPEG = { quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" };

// Deliberately low. Bunny is in Falkenstein and this runs from Tashkent on a
// domestic connection; four parallel uploads do not go four times faster, they
// just take sockets away from the download that is running at the same time.
const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY ?? 2);

// ── On timeouts, and why there are two of them ───────────────
// A single whole-request deadline cannot serve both halves of this job. A
// 300 KB upload that takes 60 s is broken; a 38 MB download that takes 60 s is
// completely normal on a domestic link. Using one number for both meant every
// large original was guaranteed to fail no matter how healthy the connection.
//
// So: uploads get a fixed deadline, because they are small and bounded.
// Downloads get a STALL timeout instead — the clock resets on every chunk that
// arrives, so a slow-but-progressing transfer runs as long as it needs and only
// a genuinely dead connection is killed.
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS ?? 120_000);
const DOWNLOAD_STALL_MS = Number(process.env.DOWNLOAD_STALL_MS ?? 45_000);

// 4xx are never retried — they mean the request is wrong, and repeating it
// only delays finding out.
const MAX_ATTEMPTS = 3;

// ── Environment ──────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY;
const STORAGE_HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const LADDER_REV = Number(process.env.LADDER_REV ?? 1);

{
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
  if (!STORAGE_ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!STORAGE_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Run with:  node --env-file=.env.local scripts/build-ladder.mjs");
    process.exit(1);
  }
}

// ── Flags ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d = null) => {
  const i = argv.indexOf(`--${f}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const GALLERY = val("gallery");
const LIMIT = val("limit") ? Number(val("limit")) : null;
const DRY_RUN = has("dry-run");
const FORCE = has("force");
const RETRY_FAILED = has("retry-failed");
const RETRY_STALE = has("retry-stale");
const CHECK = has("check");
const READ_AHEAD = has("read-ahead");
const PRUNE = has("prune-legacy");
const ADD_SHARE = has("add-share");

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Bunny Storage ────────────────────────────────────────────

function storageUrl(path) {
  return `https://${STORAGE_HOST}/${STORAGE_ZONE}/${String(path).replace(/^\/+/, "")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Node's fetch throws a bare TypeError("fetch failed") and hides the actual
 * reason — ECONNRESET, ETIMEDOUT, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT — one or
 * more levels down the `cause` chain. Unwrapping it is the difference between
 * "fetch failed" and "the connection was reset", which are very different
 * problems with very different fixes.
 */
function describeNetworkError(err) {
  const parts = [];
  const seen = new Set();
  let e = err;
  while (e && !seen.has(e)) {
    seen.add(e);
    if (e.code) parts.push(e.code);
    else if (e.message && e.message !== "fetch failed") parts.push(e.message);
    e = e.cause;
  }
  return parts.join(" ← ") || String(err?.message ?? err);
}

/** Marks an error as not worth another attempt. */
function permanent(err) {
  err.permanent = true;
  return err;
}

/** Retries `fn` on anything not marked permanent, with exponential backoff. */
async function withRetries(label, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err?.permanent) throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
}

/** Turns a non-ok response into an error, marking 4xx as permanent. */
async function httpError(label, res) {
  const body = (await res.text().catch(() => ""))
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 140);
  const err = new Error(`${label} HTTP ${res.status}${body ? ` — ${body}` : ""}`);
  const retryable = res.status >= 500 || res.status === 429;
  return retryable ? err : permanent(err);
}

/**
 * Streams a file down with a STALL watchdog rather than a total deadline.
 *
 * The watchdog is re-armed on every chunk, so a 38 MB original crawling in over
 * four minutes is fine and a connection that has genuinely died is killed after
 * DOWNLOAD_STALL_MS of silence.
 *
 * Note the body is consumed HERE, inside the guarded region. An earlier version
 * returned the Response and let the caller await res.arrayBuffer() outside the
 * timeout's error handling — which is why large files reported a raw "The
 * operation was aborted due to timeout" instead of a useful message.
 */
async function download(storagePath, onProgress) {
  const label = `GET ${storagePath}`;
  const url = storageUrl(storagePath);

  return withRetries(label, async () => {
    const controller = new AbortController();
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => controller.abort(new Error("stalled")),
        DOWNLOAD_STALL_MS,
      );
    };

    arm();
    try {
      const res = await fetch(url, {
        headers: { AccessKey: STORAGE_KEY },
        signal: controller.signal,
      });
      if (!res.ok) throw await httpError(label, res);
      if (!res.body) throw permanent(new Error(`${label} returned no body`));

      const expected = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        chunks.push(value);
        total += value.byteLength;
        onProgress?.(total, expected);
      }

      return Buffer.concat(chunks);
    } catch (err) {
      if (err?.permanent) throw err;
      if (err?.name === "AbortError") {
        throw new Error(
          `${label} stalled — no data for ${DOWNLOAD_STALL_MS / 1000}s`,
        );
      }
      throw new Error(`${label} network error: ${describeNetworkError(err)}`);
    } finally {
      clearTimeout(timer);
    }
  });
}

async function upload(path, body, contentType) {
  if (DRY_RUN) return;
  const label = `PUT ${path}`;
  const url = storageUrl(path);

  return withRetries(label, async () => {
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          AccessKey: STORAGE_KEY,
          "Content-Type": contentType,
          "Content-Length": String(body.length),
          // Bunny Storage does not persist this to the edge — the pull zone's
          // Cache Expiration setting is what decides browser cache lifetime.
          // Sent anyway because it documents intent; set "Override cache time
          // = 1 year" on the pull zone in Phase 4 for it to mean anything.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        body,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!res.ok) throw await httpError(label, res);
      return res;
    } catch (err) {
      if (err?.permanent) throw err;
      if (err?.name === "TimeoutError") {
        throw new Error(`${label} timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`);
      }
      throw new Error(`${label} network error: ${describeNetworkError(err)}`);
    }
  });
}

/**
 * A Supabase write, retried.
 *
 * supabase-js does not throw on a failed fetch — it returns the error in
 * `error`, which is how "Supabase update: TypeError: fetch failed" appeared in
 * the first backfill run. Losing a 50-second encode because a 200-byte HTTP
 * request lost its connection is pure waste, so these get the same treatment as
 * everything else that crosses the network.
 */
async function updateRow(id, patch, what) {
  return withRetries(`Supabase ${what}`, async () => {
    const { error } = await db.from("photos").update(patch).eq("id", id);
    if (error) throw new Error(`Supabase ${what}: ${error.message}`);
  });
}

async function remove(path) {
  const label = `DELETE ${path}`;
  return withRetries(label, async () => {
    try {
      const res = await fetch(storageUrl(path), {
        method: "DELETE",
        headers: { AccessKey: STORAGE_KEY },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!res.ok) throw await httpError(label, res);
      return res;
    } catch (err) {
      if (err?.permanent) throw err;
      throw new Error(`${label} network error: ${describeNetworkError(err)}`);
    }
  });
}

/**
 * Proves write access before spending an evening encoding. Uploads a few
 * bytes, reads them back, deletes them, and reports exactly which step broke.
 */
async function healthCheck() {
  const path = `d/.ladder-healthcheck-${Date.now()}.txt`;
  const payload = Buffer.from("saycheeeeeze ladder write test\n");

  console.log(`Health check against ${STORAGE_ZONE} @ ${STORAGE_HOST}\n`);
  console.log(`  PUT    ${path}`);
  await upload(path, payload, "text/plain");
  console.log("         ok");

  console.log(`  GET    ${path}`);
  const back = await download(path);
  console.log(`         ok, ${back.length} bytes back`);

  console.log(`  DELETE ${path}`);
  await remove(path);
  console.log("         ok\n");
  console.log("Storage credentials can read, write and delete. Ladder is safe to run.\n");
}

/** Runs tasks with a fixed ceiling on how many are in flight. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ── Safety ───────────────────────────────────────────────────

/**
 * photos.error is readable by the anon role (albums.ts selects photos(*)), so
 * anything written there reaches the browser on album pages. Storage keys and
 * signed URLs must never survive into it.
 */
function sanitize(message) {
  return String(message)
    .replace(new RegExp(STORAGE_KEY, "g"), "[key]")
    .replace(/AccessKey[^\s]*/gi, "[key]")
    .replace(/([?&])(token|expires|AccessKey)=[^&\s]*/gi, "$1$2=[redacted]")
    .slice(0, 400);
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── The actual work ──────────────────────────────────────────

/**
 * Where a photo's derivatives live.
 *
 * Keyed on galleries.kind, NOT on galleries.visibility, and that distinction is
 * the whole security model:
 *
 *   album         → d/{gallery}/{photo}/{checksum8}/…            public zone
 *   client        → clients/_d/{gallery}/{photo}/{checksum8}/…   private zone only
 *
 * The public pull zone carries an edge rule that blocks any request URL
 * containing "/clients/" (wildcard on both sides). Nesting client derivatives
 * under clients/ therefore means the CDN refuses them without a token — the
 * same mechanism that already protects the originals, rather than a second one
 * to keep in step.
 *
 * Visibility would have been the obvious key and is the wrong one. It is a
 * column you flip from a dashboard; keying paths on it means every flip either
 * exposes files or breaks them until someone remembers to re-run this script.
 * `kind` never changes — an album does not become a client gallery — so files
 * never have to move. Visibility now decides only whether a passkey is needed.
 *
 * ── Why LADDER_REV is in the path and not just in a column ───
 * checksum8 hashes the ORIGINAL file, and nothing else. That covers a new photo
 * and a replaced original, but NOT a change to the encoder settings below:
 * raising AVIF quality from 50 to 60 and re-running would rewrite the very same
 * paths with different bytes.
 *
 * These files are served with a one-year immutable cache, because the whole
 * point of a content-addressed path is that you never purge the CDN. Silently
 * changing what lives at an immutable URL is the one thing that breaks that
 * promise, and the only escape would be exactly the purge this design exists to
 * avoid. So the revision travels in the path: bump LADDER_REV, rebuild, and the
 * new files land at new URLs while the old ones simply age out.
 *
 * KEEP IN STEP with the resolver in the app (src/lib/…). Duplicated rather than
 * imported for the same reason verify-private-zone.mjs duplicates its signing:
 * a plain node script cannot import a "server-only" TypeScript module, and a
 * shared implementation could only prove the two agree with each other.
 */
function kindOf(photo) {
  // supabase-js returns an embedded to-one relation as an object, but has
  // shipped it as a single-element array before now. Accept either.
  const rel = photo.galleries;
  return Array.isArray(rel) ? rel[0]?.kind : rel?.kind;
}

/**
 * The prefix builder, with the revision passed in explicitly.
 *
 * Split out from derivativePrefix() because the --add-share top-up writes
 * ALONGSIDE files that already exist, so it must use the revision recorded on
 * the row rather than whatever LADDER_REV happens to be in the environment
 * today. Getting that wrong would drop share.jpg into an empty v2 directory
 * next to a live v1 ladder, and the app — which resolves from the row — would
 * never look there.
 */
function prefixFor(kind, galleryId, photoId, checksum8, rev) {
  // Fail CLOSED. Defaulting an unknown kind to the public path would mean a
  // change to the query — dropping the join, renaming the column — silently
  // publishing client work rather than breaking loudly. The selects use
  // !inner, so an absent kind means something is wrong upstream and this run
  // should stop.
  if (kind !== "album" && kind !== "client") {
    throw permanent(
      new Error(
        `gallery kind missing or unrecognised (${JSON.stringify(kind)}) — ` +
          "refusing to guess a derivative path",
      ),
    );
  }

  const root = kind === "client" ? "clients/_d" : "d";
  return `${root}/${galleryId}/${photoId}/${checksum8}/v${rev}`;
}

function derivativePrefix(photo, checksum8) {
  return prefixFor(
    kindOf(photo),
    photo.gallery_id,
    photo.id,
    checksum8,
    LADDER_REV,
  );
}

/** Live progress for anything big enough that silence looks like a hang. */
function downloadProgress(total, expected) {
  if (expected && expected < 4 * 1024 * 1024) return;
  const of = expected ? ` / ${human(expected)}` : "";
  const pct = expected ? `  ${Math.round((total / expected) * 100)}%` : "";
  process.stdout.write(`\r      downloading ${human(total)}${of}${pct}      `);
}

function clearProgress() {
  process.stdout.write(`\r${" ".repeat(60)}\r`);
}

/**
 * Rejections are folded into the resolved value so an abandoned prefetch can
 * never surface as an unhandled rejection if the loop exits early.
 */
function fetchOriginal(photo, withProgress) {
  return download(
    photo.storage_path,
    withProgress ? downloadProgress : undefined,
  ).then(
    (buf) => ({ buf }),
    (err) => ({ err }),
  );
}

/**
 * One-slot read-ahead — OPT-IN, and off by default.
 *
 * The idea was that download and encode cost about the same and use different
 * resources, so overlapping them halves wall-clock. That holds on a fat link.
 * On a domestic connection it is actively harmful: prefetching the next 38 MB
 * original saturates the uplink that the current photo's own uploads need, and
 * they start failing with UND_ERR_CONNECT_TIMEOUT — which is exactly what
 * happened on the first real backfill run.
 *
 * Turn it on with --read-ahead if your connection has headroom to spare.
 */
function readAhead(photo) {
  if (!READ_AHEAD || !photo) return null;
  return fetchOriginal(photo, false);
}

async function processPhoto(photo, src) {
  const checksum8 = createHash("sha256").update(src).digest("hex").slice(0, 8);

  // .rotate() with NO argument bakes EXIF orientation into the pixels and then
  // drops the tag. Skip it and a third of phone uploads come out sideways —
  // and unlike a wrong colour profile, nobody notices until a client does.
  const base = sharp(src, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (!srcWidth || !srcHeight) throw new Error("could not read image dimensions");

  // ThumbHash from a 100px RGBA raster. ~25 bytes, decodes client-side to a
  // blurred preview with the right aspect and average colour. This is what
  // replaced blur_data_url, which Bunny's resizer was returning at ~12 KB.
  const { data: rgba, info } = await base
    .clone()
    .resize(100, 100, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const thumbhash = Buffer.from(
    rgbaToThumbHash(info.width, info.height, rgba),
  ).toString("base64");

  // Never upscale. A 900px original gets 240/480/720 and stops; if it is
  // smaller than even the narrowest rung, emit its own width so the photo
  // still has exactly one variant to render.
  let targets = ALL_WIDTHS.filter((w) => w <= srcWidth);
  if (targets.length === 0) targets = [srcWidth];

  // Decode-once. Every rung is derived from a master already reduced to the
  // widest target rather than from the 37 MB original, which avoids re-decoding
  // a 24 MP PNG twelve times. The quality difference is not visible; the time
  // difference very much is.
  const master = await base
    .clone()
    .resize({ width: Math.max(...targets), withoutEnlargement: true })
    .toColourspace("srgb")
    .png({ compressionLevel: 0 })
    .toBuffer();

  const prefix = derivativePrefix(photo, checksum8);
  const uploads = [];
  const variants = [];

  for (const w of targets) {
    const step = sharp(master).resize({ width: w, withoutEnlargement: true });
    const [avif, webp] = await Promise.all([
      step.clone().avif(ENCODERS.avif).toBuffer(),
      step.clone().webp(ENCODERS.webp).toBuffer(),
    ]);
    uploads.push(
      { path: `${prefix}/${w}.avif`, body: avif, type: "image/avif" },
      { path: `${prefix}/${w}.webp`, body: webp, type: "image/webp" },
    );
    variants.push({ w, a: avif.length, p: webp.length });
  }

  // The light download. One more encode off the master, which is already
  // decoded and already at the widest rung — see SHARE_JPEG.
  const share = await sharp(master).jpeg(SHARE_JPEG).toBuffer();
  uploads.push({
    path: `${prefix}/share.jpg`,
    body: share,
    type: "image/jpeg",
  });

  // The download deliverable. Full resolution, from the ORIGINAL rather than
  // the master, because this is the one output where downscaling would be a
  // real loss.
  const delivery = await base.clone().jpeg(DELIVERY).toBuffer();
  uploads.push({
    path: `${prefix}/download.jpg`,
    body: delivery,
    type: "image/jpeg",
  });

  await pool(uploads, UPLOAD_CONCURRENCY, (u) => upload(u.path, u.body, u.type));

  const totalOut = uploads.reduce((n, u) => n + u.body.length, 0);

  return {
    checksum8,
    thumbhash,
    variants,
    delivery_bytes: delivery.length,
    share_bytes: share.length,
    width: srcWidth,
    height: srcHeight,
    srcBytes: src.length,
    totalOut,
    fileCount: uploads.length,
  };
}

// ── Queue ────────────────────────────────────────────────────

async function selectQueue() {
  // ONE string literal — supabase-js parses this at the type level and its
  // parser only understands literals. Same rule as the select in
  // client-galleries.ts; a concatenation makes every field come back as
  // GenericStringError.
  let q = db
    .from("photos")
    .select("id, gallery_id, storage_path, status, checksum8, variants, galleries!inner(slug, kind)")
    .order("created_at", { ascending: true });

  // --force ignores status entirely and rebuilds whatever matches, which is
  // how you apply a new LADDER_REV. Pair it with --gallery unless you really
  // mean the whole library.
  if (!FORCE) {
    const statuses = RETRY_FAILED ? ["pending", "failed"] : ["pending"];
    q = q.in("status", statuses);
  }
  if (GALLERY) q = q.eq("galleries.slug", GALLERY);
  if (LIMIT) q = q.limit(LIMIT);

  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data ?? [];
}

/**
 * Deletes derivatives left behind by an OLDER PATH LAYOUT.
 *
 * Two layout changes have happened, and this clears up after both:
 *
 *   1. Everything used to go to d/… regardless of gallery kind, so client
 *      derivatives sat where the public zone would serve them untokened. A
 *      stale public copy is precisely the hole the kind-keyed path closes —
 *      the day a gallery is switched to private, the app serves the signed
 *      path while the unsigned one quietly keeps working.
 *
 *   2. Paths gained a /v{ladder_rev}/ segment. Everything built before that
 *      is orphaned at the un-versioned path.
 *
 * So for every photo it deletes both possible OLD prefixes — public and
 * client roots, without the version segment. The current path always contains
 * /v{n}/, so nothing this deletes can be live.
 *
 * Filenames are recoverable from `variants` plus download.jpg, so it only ever
 * deletes files it can name. 404s are expected and mean the file was not there.
 */
async function pruneLegacyDerivatives() {
  let q = db
    .from("photos")
    .select("id, gallery_id, checksum8, variants, galleries!inner(slug, kind)")
    .not("checksum8", "is", null);
  if (GALLERY) q = q.eq("galleries.slug", GALLERY);

  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);

  const rows = data ?? [];
  console.log(
    `Pruning pre-versioned derivatives for ${rows.length} photo(s)` +
      `${DRY_RUN ? " — DRY RUN, deleting nothing" : ""}\n`,
  );

  let deleted = 0;
  let absent = 0;
  let failed = 0;

  for (const p of rows) {
    const widths = (Array.isArray(p.variants) ? p.variants : []).map((v) => v.w);
    // Both roots, no version segment. A photo only ever lived under one of
    // them, so the other simply 404s and is counted as absent.
    const oldPrefixes = [
      `d/${p.gallery_id}/${p.id}/${p.checksum8}`,
      `clients/_d/${p.gallery_id}/${p.id}/${p.checksum8}`,
    ];
    const paths = oldPrefixes.flatMap((legacy) => [
      ...widths.flatMap((w) => [`${legacy}/${w}.avif`, `${legacy}/${w}.webp`]),
      `${legacy}/download.jpg`,
    ]);

    for (const path of paths) {
      if (DRY_RUN) {
        console.log(`  would delete  ${path}`);
        continue;
      }
      try {
        await remove(path);
        deleted++;
      } catch (err) {
        if (/HTTP 404/.test(err.message)) absent++;
        else {
          failed++;
          console.warn(`  could not delete ${path}: ${sanitize(err.message)}`);
        }
      }
    }
  }

  if (!DRY_RUN) {
    console.log(
      `\nDeleted ${deleted}, already absent ${absent}, failed ${failed}.\n` +
        (failed > 0
          ? "Re-run to clear the failures — deletion is idempotent.\n"
          : "No client derivatives remain on the public path.\n"),
    );
    if (failed > 0) process.exitCode = 1;
  }
}

/**
 * Top-up pass: writes the ONE missing file for photos whose ladder is already
 * complete, and touches nothing else.
 *
 * share.jpg arrived after the first backfill had already run. It is a NEW path
 * under an existing prefix rather than a rewrite of a published file, so it
 * needs no LADDER_REV bump and invalidates nothing at the edge — which means a
 * full --force run would re-encode twelve derivatives and re-upload thirteen
 * files per photo in order to produce one new one. At ~400 photos that is the
 * difference between about forty minutes and about ten.
 *
 * Three things this is careful about:
 *
 *   The prefix uses the ROW's ladder_rev, never the environment's. This writes
 *   alongside files that already exist, wherever they landed.
 *
 *   It re-hashes the original and refuses any photo whose checksum has moved.
 *   A changed checksum means the source was replaced, every other file under
 *   that prefix is from different pixels, and the honest fix is a real rebuild
 *   — not a share.jpg quietly assembled from a newer photograph.
 *
 *   It writes share_bytes and source_bytes and NOTHING else. status, variants,
 *   thumbhash and checksum8 are left exactly as the real build left them.
 */
async function addShareTier() {
  console.log(
    `\nShare tier top-up — ${DRY_RUN ? "DRY RUN, uploading nothing" : "writing to Bunny + Supabase"}`,
  );
  console.log(`Zone    ${STORAGE_ZONE} @ ${STORAGE_HOST}\n`);

  // ONE string literal — see the note on selectQueue().
  let q = db
    .from("photos")
    .select("id, gallery_id, storage_path, checksum8, ladder_rev, galleries!inner(slug, kind)")
    .eq("status", "ready")
    .order("created_at", { ascending: true });

  // Without --force this is strictly a backfill: only photos that have no
  // share tier yet. With it, every matching photo is rewritten, which is how
  // you apply a change to SHARE_JPEG.
  if (!FORCE) q = q.is("share_bytes", null);
  if (GALLERY) q = q.eq("galleries.slug", GALLERY);
  if (LIMIT) q = q.limit(LIMIT);

  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) {
    console.log("Nothing to do — every ready photo already has a share tier.\n");
    return;
  }

  console.log(`${rows.length} photo(s) to top up\n`);

  let ok = 0;
  let failed = 0;
  let bytesOut = 0;
  const startedAll = Date.now();

  for (const [i, photo] of rows.entries()) {
    const label = `${String(i + 1).padStart(3)}/${rows.length}  ${photo.storage_path}`;
    const started = Date.now();

    try {
      const src = await download(photo.storage_path, downloadProgress);
      clearProgress();

      const checksum8 = createHash("sha256").update(src).digest("hex").slice(0, 8);
      if (photo.checksum8 && checksum8 !== photo.checksum8) {
        throw permanent(
          new Error(
            `original has changed (${photo.checksum8} → ${checksum8}) — ` +
              "rebuild this photo properly instead of topping it up",
          ),
        );
      }

      // .rotate() for the same reason as processPhoto: EXIF orientation has to
      // be baked in, or a third of phone uploads come out sideways.
      const base = sharp(src, { failOn: "none" }).rotate();
      const meta = await base.metadata();
      const srcWidth = meta.width ?? 0;
      if (!srcWidth) throw new Error("could not read image dimensions");

      // Same rung the master would have been built at, so this file is
      // identical to the one a full build would have produced. No master here
      // — one output does not justify the intermediate PNG.
      let targets = ALL_WIDTHS.filter((w) => w <= srcWidth);
      if (targets.length === 0) targets = [srcWidth];

      const share = await base
        .resize({ width: Math.max(...targets), withoutEnlargement: true })
        .toColourspace("srgb")
        .jpeg(SHARE_JPEG)
        .toBuffer();

      const prefix = prefixFor(
        kindOf(photo),
        photo.gallery_id,
        photo.id,
        checksum8,
        photo.ladder_rev ?? 1,
      );

      await upload(`${prefix}/share.jpg`, share, "image/jpeg");

      if (!DRY_RUN) {
        await updateRow(
          photo.id,
          { share_bytes: share.length, source_bytes: src.length },
          "share top-up",
        );
      }

      bytesOut += share.length;
      ok++;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${label}\n      ${human(src.length)} → share.jpg ${human(share.length)}  ${secs}s`,
      );
    } catch (err) {
      failed++;
      clearProgress();
      const message = sanitize(err instanceof Error ? err.message : String(err));
      console.error(`${label}\n      FAILED  ${message}`);
      // Deliberately NOT marked failed in the database. This pass does not own
      // photo status — the row still has a perfectly good ladder, it is just
      // missing one optional file, and flipping it to 'failed' would put it in
      // the queue for a full rebuild it does not need.
    }
  }

  const mins = ((Date.now() - startedAll) / 1000 / 60).toFixed(1);
  console.log(
    `\nDone in ${mins} min — ${ok} topped up, ${failed} failed, ` +
      `${human(bytesOut)} written.\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  if (CHECK) {
    await healthCheck();
    return;
  }

  if (PRUNE) {
    await pruneLegacyDerivatives();
    return;
  }

  if (ADD_SHARE) {
    await addShareTier();
    return;
  }

  console.log(
    `\nLadder build — ${DRY_RUN ? "DRY RUN, uploading nothing" : "writing to Bunny + Supabase"}`,
  );
  console.log(
    `Widths  ${ALL_WIDTHS.join(", ")}  ×  avif + webp,  plus share.jpg + download.jpg`,
  );
  console.log(`Zone    ${STORAGE_ZONE} @ ${STORAGE_HOST}\n`);

  if (RETRY_STALE) {
    // The SQL function defaults to 30 minutes, which is right for "a worker
    // died yesterday" and wrong for "the run I just stopped two minutes ago".
    // --stale-after lets you say which situation you are in.
    const minutes = Number(val("stale-after", "30"));
    const { data, error } = await db.rpc("reset_stale_photo_claims", {
      older_than: `${minutes} minutes`,
    });
    if (error) console.warn(`  could not reset stale claims: ${error.message}\n`);
    else console.log(`  requeued ${data ?? 0} photo(s) stuck in processing\n`);
  }

  const queue = await selectQueue();
  if (queue.length === 0) {
    console.log("Nothing to do — every photo already has its ladder.\n");
    return;
  }

  console.log(`${queue.length} photo(s) to build\n`);

  let ok = 0;
  let failed = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  const startedAll = Date.now();

  // Kick off the first download before entering the loop; from then on each
  // iteration starts the NEXT one before doing its own encoding.
  let pending = readAhead(queue[0]);

  for (const [i, photo] of queue.entries()) {
    const label = `${String(i + 1).padStart(3)}/${queue.length}  ${photo.storage_path}`;
    const started = Date.now();

    // Without --read-ahead, `pending` is always null and the download happens
    // inline, with a progress line so a slow big file does not look like a hang.
    const incoming = pending ?? fetchOriginal(photo, true);
    pending = readAhead(queue[i + 1]);

    if (!DRY_RUN) {
      // Not fatal if it fails — a row that never got claimed simply stays
      // 'pending' and gets picked up again.
      await updateRow(
        photo.id,
        { status: "processing", claimed_at: new Date().toISOString() },
        "claim",
      ).catch((e) => console.warn(`      (could not claim: ${sanitize(e.message)})`));
    }

    try {
      const got = await incoming;
      clearProgress();
      if (got.err) throw got.err;
      const r = await processPhoto(photo, got.buf);

      if (!DRY_RUN) {
        await updateRow(
          photo.id,
          {
            checksum8: r.checksum8,
            thumbhash: r.thumbhash,
            variants: r.variants,
            delivery_bytes: r.delivery_bytes,
            share_bytes: r.share_bytes,
            source_bytes: r.srcBytes,
            width: r.width,
            height: r.height,
            ladder_rev: LADDER_REV,
            status: "ready",
            error: null,
            claimed_at: null,
          },
          "update",
        );
      }

      bytesIn += r.srcBytes;
      bytesOut += r.totalOut;
      ok++;

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${label}\n      ${r.width}×${r.height}  ${human(r.srcBytes)} → ` +
          `${r.fileCount} files, ${human(r.totalOut)}  ` +
          `(share ${human(r.share_bytes)}, full ${human(r.delivery_bytes)})  ${secs}s`,
      );
    } catch (err) {
      failed++;
      clearProgress();
      const message = sanitize(err instanceof Error ? err.message : String(err));
      console.error(`${label}\n      FAILED  ${message}`);

      if (!DRY_RUN) {
        // attempts is incremented by reading first — there is one worker, so
        // there is no race to lose here.
        const { data: row } = await db
          .from("photos")
          .select("attempts")
          .eq("id", photo.id)
          .maybeSingle();

        // If even THIS write cannot reach Supabase, the row is left sitting in
        // 'processing'. Say so plainly, because --retry-failed will not find it
        // and --retry-stale is what recovers it.
        await updateRow(
          photo.id,
          {
            status: "failed",
            error: message,
            attempts: (row?.attempts ?? 0) + 1,
            claimed_at: null,
          },
          "mark failed",
        ).catch(() =>
          console.warn(
            "      (could not record the failure — this row is stuck in " +
              "'processing'; recover it with --retry-stale)",
          ),
        );
      }
    }
  }

  const mins = ((Date.now() - startedAll) / 1000 / 60).toFixed(1);
  console.log(
    `\nDone in ${mins} min — ${ok} built, ${failed} failed.\n` +
      `Downloaded ${human(bytesIn)} of originals, produced ${human(bytesOut)} of derivatives` +
      `${bytesIn > 0 ? ` (${((bytesOut / bytesIn) * 100).toFixed(1)}% of source)` : ""}.\n`,
  );

  if (failed > 0) {
    console.log("Re-run with --retry-failed once you have looked at the errors above.\n");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${sanitize(err instanceof Error ? err.message : String(err))}\n`);
  process.exit(1);
});
