// Turns originals into the derivative ladder. Needs sharp and thumbhash.
//
//   node --env-file=.env.local scripts/build-ladder.mjs --check        # prove write access
//   node --env-file=.env.local scripts/build-ladder.mjs                # everything pending
//   node --env-file=.env.local scripts/build-ladder.mjs --gallery Sara --limit 1
//   node --env-file=.env.local scripts/build-ladder.mjs --dry-run      # encode, upload nothing
//   node --env-file=.env.local scripts/build-ladder.mjs --retry-failed --retry-stale --stale-after 1
//   node --env-file=.env.local scripts/build-ladder.mjs --force --gallery Sara
//   node --env-file=.env.local scripts/build-ladder.mjs --prune-legacy # orphans from an
//                                       older path layout (--dry-run first)
//
// For each photo it writes {width}.avif ×6, {width}.webp ×6, share.jpg and
// download.jpg under
//
//   d/{gallery_id}/{photo_id}/{checksum8}/v{LADDER_REV}           album
//   clients/_d/{gallery_id}/{photo_id}/{checksum8}/v{LADDER_REV}  client gallery
//
// then records checksum8, thumbhash, variants, delivery_bytes and the true
// intrinsic dimensions on the row and flips status to 'ready'. See
// derivativePrefix() for why the root is keyed on gallery kind and why the
// revision travels in the path.
//
// Safe to interrupt: Ctrl-C loses at most the photo in flight. Rows go 'ready'
// only after every byte is uploaded, so a half-finished photo stays
// 'processing' and --retry-stale requeues it. Paths carry the content hash and
// the ladder revision, so a re-run can never serve a stale mix — anything that
// changes the output changes the directory.
//
// Roughly 5.6 s of CPU per 24 MP photo on 2 cores, but encoding is not the
// bottleneck: downloading a 38 MB original dwarfs it, so a backfill costs your
// link rather than your CPU. --read-ahead overlaps the next download with the
// current encode; it is off by default because on a constrained uplink it
// starves this photo's own uploads (see readAhead()).

import { createHash } from "node:crypto";
import process from "node:process";

import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";
import { createClient } from "@supabase/supabase-js";

// Grid tiles never display above ~720 CSS px; lightbox frames go to the
// display width. So 3840 for a grid tile is waste and grid sizes alone leave
// the lightbox mushy. No 2560 or 3840 on purpose — 2048 covers every device a
// client actually opens their gallery on, and each width dropped is ~8% off
// encode time, storage and bandwidth. Bump LADDER_REV if you change this list.
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
// From the master rather than the original, because this is the one output
// whose whole purpose is to be small: the master is already at the widest rung
// so this costs one extra encode and no extra decode of the full-size file.
// q82 rather than q92 because it will be seen on a phone, recompressed by
// whatever app it is posted to, and never printed — roughly 500 KB against
// 4 MB.
const SHARE_JPEG = { quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" };

// Deliberately low. Bunny is in Falkenstein and this runs from Tashkent on a
// domestic connection; four parallel uploads do not go four times faster, they
// just take sockets away from the download that is running at the same time.
const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY ?? 2);

// Two timeouts, because one whole-request deadline cannot serve both halves of
// this job: a 300 KB upload taking 60 s is broken, a 38 MB download taking
// 60 s is normal on a domestic link. Uploads get a fixed deadline, being small
// and bounded. Downloads get a stall timeout — the clock resets on every chunk
// — so a slow but progressing transfer runs as long as it needs and only a
// dead connection is killed.
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS ?? 120_000);
const DOWNLOAD_STALL_MS = Number(process.env.DOWNLOAD_STALL_MS ?? 45_000);

// 4xx are never retried — they mean the request is wrong, and repeating it
// only delays finding out.
const MAX_ATTEMPTS = 3;

// Environment
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

// Flags
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

// Bunny Storage

function storageUrl(path) {
  return `https://${STORAGE_HOST}/${STORAGE_ZONE}/${String(path).replace(/^\/+/, "")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Node's fetch throws a bare TypeError("fetch failed") and buries the real
 *  reason — ECONNRESET, ETIMEDOUT, UND_ERR_CONNECT_TIMEOUT — down the `cause`
 *  chain. Unwrapping it is the difference between "fetch failed" and "the
 *  connection was reset", which have very different fixes. */
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
 * Streams a file down with a stall watchdog rather than a total deadline. The
 * watchdog re-arms on every chunk, so a 38 MB original crawling in over four
 * minutes is fine and only DOWNLOAD_STALL_MS of silence kills it.
 *
 * The body is consumed here, inside the guarded region. Returning the Response
 * and letting the caller await res.arrayBuffer() puts the read outside the
 * timeout's error handling, which is how large files end up reporting a raw
 * "operation was aborted due to timeout".
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

/** A Supabase write, retried. supabase-js doesn't throw on a failed fetch, it
 *  returns the error in `error` — and losing a 50-second encode because a
 *  200-byte request dropped its connection is pure waste. */
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

// Safety

/** photos.error is readable by the anon role (albums.ts selects photos(*)),
 *  so anything written there reaches the browser. Storage keys and signed URLs
 *  must never survive into it. */
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

// The actual work

/**
 * Where a photo's derivatives live.
 *
 *   album   → d/{gallery}/{photo}/{checksum8}/…            public zone
 *   client  → clients/_d/{gallery}/{photo}/{checksum8}/…   private zone only
 *
 * Keyed on galleries.kind, not visibility, and that distinction is the whole
 * security model. The public pull zone blocks any URL containing "/clients/",
 * so nesting client derivatives there means the CDN refuses them without a
 * token — the same mechanism that protects the originals rather than a second
 * one to keep in step. Visibility is a column you flip from a dashboard;
 * keying paths on it would make every flip either expose files or break them
 * until someone re-ran this script. `kind` never changes, so files never move.
 *
 * LADDER_REV is in the path because checksum8 hashes the original and nothing
 * else — it covers a new or replaced photo, but not a change to the encoder
 * settings below. These files carry a one-year immutable cache, and silently
 * changing what lives at an immutable URL is the one thing that breaks the
 * promise a content-addressed path makes. So bump LADDER_REV, rebuild, and the
 * new files land at new URLs while the old ones age out.
 *
 * KEEP IN STEP with the resolver in src/lib. Duplicated rather than imported
 * because a plain node script cannot import a "server-only" TypeScript module.
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
 * Separate from derivativePrefix() because the --add-share top-up writes
 * alongside files that already exist and must use the revision on the row, not
 * whatever LADDER_REV is in the environment today. Getting that wrong drops
 * share.jpg into an empty v2 directory beside a live v1 ladder, where the app
 * — which resolves from the row — will never look.
 */
function prefixFor(kind, galleryId, photoId, checksum8, rev) {
  // Fail closed. Defaulting an unknown kind to the public path would let a
  // change to the query — a dropped join, a renamed column — silently publish
  // client work instead of breaking loudly.
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
 * One-slot read-ahead, opt-in via --read-ahead and off by default.
 *
 * Download and encode cost about the same and use different resources, so
 * overlapping them halves wall-clock — on a fat link. On a domestic one it is
 * actively harmful: prefetching the next 38 MB original saturates the uplink
 * the current photo's uploads need, and they fail with
 * UND_ERR_CONNECT_TIMEOUT. Turn it on only with headroom to spare.
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

// Queue

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

  // Never treat this script's own output as a source photograph. A row under
  // d/ or clients/_d/ is a rung of somebody's ladder, and building a ladder
  // for it writes more rungs for the next run to find. Belt and braces:
  // reseed.ts no longer creates these rows, and --force bypasses the status
  // filter above, so this is the only thing standing between a stale database
  // and an exponential backfill.
  q = q.not("storage_path", "like", "d/%").not("storage_path", "like", "clients/_d/%");

  if (GALLERY) q = q.eq("galleries.slug", GALLERY);
  if (LIMIT) q = q.limit(LIMIT);

  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data ?? [];
}

/**
 * Deletes derivatives left behind by an older path layout — two of them:
 * everything once went to d/… regardless of gallery kind, leaving client
 * derivatives where the public zone serves them untokened; and paths later
 * gained a /v{ladder_rev}/ segment, orphaning everything built before it.
 *
 * That stale public copy is exactly the hole the kind-keyed path closes: flip
 * a gallery to private and the app serves the signed path while the unsigned
 * one quietly keeps working.
 *
 * So it deletes both old prefixes, public and client, without the version
 * segment. A current path always contains /v{n}/, so nothing deleted here can
 * be live. Filenames come from `variants` plus download.jpg, so it only
 * deletes files it can name; 404s are expected.
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
 * Top-up pass: writes the one missing file for photos whose ladder is already
 * complete, and touches nothing else.
 *
 * share.jpg arrived after the first backfill ran. It is a new path under an
 * existing prefix rather than a rewrite of a published file, so it needs no
 * LADDER_REV bump and invalidates nothing at the edge — where a --force run
 * would re-encode twelve derivatives and re-upload thirteen files per photo to
 * produce one.
 *
 * Three things it is careful about. The prefix uses the row's ladder_rev, not
 * the environment's, because it writes alongside files that already exist. It
 * re-hashes the original and refuses any photo whose checksum has moved — a
 * changed checksum means every other file under that prefix is from different
 * pixels, and the honest fix is a real rebuild. And it writes share_bytes and
 * source_bytes only, leaving status, variants, thumbhash and checksum8 as the
 * real build left them.
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
