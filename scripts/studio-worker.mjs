// The Studio's worker: receives the files you upload in the Studio, builds
// their ladder, puts everything in Bunny and makes the photos appear.
//
//   pnpm worker                                          # = the line below
//   node --env-file=.env.local scripts/studio-worker.mjs
//   node --env-file=.env.local scripts/studio-worker.mjs --check   # prove access, then stop
//
// Leave it running while you upload. Ctrl-C stops it: files already sent wait
// on this computer and are finished the next time it starts. Ctrl-C twice
// stops it at once.
//
// WHAT IT DOES
//
//   1. Says "I am here" to the database every 20 seconds. The Studio only
//      offers uploading while it does.
//   2. Listens on http://127.0.0.1:7811 (this computer only). The browser
//      sends each file there in pieces, each piece with the file's ticket
//      from the Studio. A piece that fails is sent again; a file that stops
//      halfway continues from where it stopped.
//   3. With the whole file here, asks the database whether the gallery
//      already has it (same photograph = skipped) and queues it.
//   4. Builds the same 14 files as build-ladder.mjs (scripts/lib/ladder-core.mjs),
//      uploads them, then the original, each checked by Bunny against its
//      SHA-256, and only then inserts the photos row, already 'ready'.
//   5. When the last file of a drop is done, puts the gallery in file-name
//      order, marks the drop finished with, and refreshes the cache of the
//      site in NEXT_PUBLIC_SITE_URL. A Studio open on any other site (a dev
//      preview, pnpm dev) sees the mark and refreshes its own.
//   6. Removes from storage the files of photos and galleries deleted in the
//      Studio (delete_files jobs): first refreshes the site, then removes
//      the originals no photo still uses and the derivative folders.
//   7. Once a day, after 03:00, saves a copy of the database to this
//      computer (WORKER_BACKUP_DIR), keeping the last 30.
//   8. Phones and other computers: when cloudflared is installed, starts a
//      Cloudflare quick tunnel (free, no account) to this worker and gives
//      the Studio its https address. The address changes each start; the
//      worker tells the database, so nobody types it. A browser on this
//      computer still sends straight here. Install once on Windows:
//        winget install --id Cloudflare.cloudflared
//
//   pnpm worker --backup        a copy of the database now, then stops
//   pnpm db-restore <copy>      compare a copy with the database; --apply puts it back
//
// Files waiting here live in WORKER_SPOOL_DIR (default: a .saycheeeeeze-worker
// folder in your home folder), never in the project, and are deleted once
// their photo is in the gallery.
//
// ENVIRONMENT (all already in .env.local except the optional ones)
//
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   the database
//   BUNNY_STORAGE_ZONE, BUNNY_STORAGE_API_KEY             storage
//   BUNNY_STORAGE_HOST          optional, default storage.bunnycdn.com
//   REVALIDATE_SECRET           to refresh the site's cache after a drop
//   NEXT_PUBLIC_SITE_URL        which site to refresh after a drop (default https://saycheeeeeze.studio)
//   LADDER_REV                  same meaning as in build-ladder.mjs (default 1)
//   WORKER_NAME                 optional, default this computer's name
//   WORKER_PORT                 optional, default 7811
//   WORKER_PUBLIC_URL           optional, where browsers reach it (default: the tunnel, else http://127.0.0.1:<port>)
//   WORKER_TUNNEL               optional, "off" to not start cloudflared (default: start it when installed)
//   WORKER_SPOOL_DIR            optional, where files wait
//   WORKER_JOBS                 optional, photos built at once, default 2 (1 to 4)
//   WORKER_ALLOWED_ORIGINS      optional, extra sites allowed to send files, comma-separated
//   WORKER_BACKUP_DIR           optional, where database copies go (default: saycheeeeeze-backups in your home folder)
//   WORKER_BACKUP_KEEP          optional, how many copies to keep, default 30
//   WORKER_BACKUP_HOUR          optional, the copy of the day is made from this hour on, default 3

import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { encodeLadder, ladderRev, permanent, prefixFor } from "./lib/ladder-core.mjs";

const VERSION = "4";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const env = process.env;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
const STORAGE_ZONE = env.BUNNY_STORAGE_ZONE;
const STORAGE_KEY = env.BUNNY_STORAGE_API_KEY;
const STORAGE_HOST = (env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const SITE_URL = (env.WORKER_SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.studio").replace(/\/+$/, "");
/** For the log: which site a drop refreshed. A Studio on any other site refreshes its own. */
const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return SITE_URL;
  }
})();
const REVALIDATE_SECRET = env.REVALIDATE_SECRET;
const LADDER_REV = ladderRev();

const PORT = Number(env.WORKER_PORT ?? 7811);
// This computer only. A tunnel for other devices is step 7.
const HOST = env.WORKER_HOST ?? "127.0.0.1";
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const FIXED_URL = env.WORKER_PUBLIC_URL ? env.WORKER_PUBLIC_URL.replace(/\/+$/, "") : null;
const TUNNEL = !FIXED_URL && (env.WORKER_TUNNEL ?? "").toLowerCase() !== "off";
// cloudflared, or a stand-in in the tests.
const TUNNEL_COMMAND = env.WORKER_TUNNEL_COMMAND || "cloudflared";
/** The tunnel's https address once it answers, else null. */
let tunnelUrl = null;
/** Where browsers are told to send files: a fixed address, the tunnel, or this computer. */
const doorUrl = () => FIXED_URL ?? tunnelUrl ?? LOCAL_URL;
const NAME = workerName(env.WORKER_NAME ?? os.hostname());
const SPOOL = path.resolve(env.WORKER_SPOOL_DIR ?? path.join(os.homedir(), ".saycheeeeeze-worker", "spool"));
const JOBS = Math.min(4, Math.max(1, Math.floor(Number(env.WORKER_JOBS ?? 2)) || 2));

// The same reasoning as build-ladder.mjs: Bunny is in Falkenstein, this is a
// domestic uplink, and more parallel uploads only take sockets from each other.
const UPLOAD_CONCURRENCY = Math.max(1, Number(env.UPLOAD_CONCURRENCY ?? 2));
const UPLOAD_TIMEOUT_MS = Number(env.UPLOAD_TIMEOUT_MS ?? 120_000);
// An original is up to 100 MB; give it time on a slow uplink.
const ORIGINAL_TIMEOUT_MS = Number(env.ORIGINAL_TIMEOUT_MS ?? 15 * 60_000);
const MAX_ATTEMPTS = 3;

// One piece of a file per request. The browser sends 8 MB; anything over 16
// is refused before it is read.
const MAX_PIECE = 16 * 1024 * 1024;

const HEARTBEAT_MS = 20_000;
const IDLE_POLL_MS = 10_000;
const JOB_HEARTBEAT_MS = 30_000;
const CLEAN_EVERY_MS = 30 * 60_000;
// Each failed try of a job waits longer before the next one.
const RETRY_IN_SECONDS = [60, 300, 900];

const KINDS = ["process_upload", "finish_batch", "delete_files"];

const BACKUP_DIR = path.resolve(env.WORKER_BACKUP_DIR ?? path.join(os.homedir(), "saycheeeeeze-backups"));
const BACKUP_KEEP = whole(env.WORKER_BACKUP_KEEP, 30, 1, 365);
const BACKUP_HOUR = whole(env.WORKER_BACKUP_HOUR, 3, 0, 23);
const BACKUP_CHECK_MS = 10 * 60_000;
const BACKUP_FILE = /^saycheeeeeze-db-\d{4}-\d{2}-\d{2}(-\d{4})?\.json\.gz$/;
// Rows per request. Supabase answers at most its "max rows" (1000 unless
// changed); the total is asked for, so a lower limit only means more requests.
const BACKUP_PAGE = 1000;

// Sites allowed to send files here. The ticket is what really decides; this
// keeps other web pages from even asking.
const ALLOWED_ORIGINS = new Set(
  [
    "https://saycheeeeeze.studio",
    "https://www.saycheeeeeze.studio",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    originOf(SITE_URL),
    ...(env.WORKER_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .map((o) => o?.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);
// Vercel previews of this project: saycheeeeeze-<anything>.vercel.app
const PREVIEW_ORIGIN = /^https:\/\/saycheeeeeze(-[a-z0-9-]+)?\.vercel\.app$/;

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const BACKUP_NOW = argv.includes("--backup");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function workerName(raw) {
  const clean = String(raw)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 63);
  return clean || "worker";
}

/** A whole number from the environment, within limits, or the default. */
function whole(raw, fallback, min, max) {
  const n = Math.floor(Number(raw));
  return raw === undefined || raw === "" || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clock() {
  return new Date().toTimeString().slice(0, 8);
}

function log(...parts) {
  console.log(clock(), ...parts);
}

function warn(...parts) {
  console.warn(clock(), ...parts);
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Keys, tokens and signed links never reach the database or the screen. */
function sanitize(message) {
  let text = String(message ?? "");
  if (STORAGE_KEY) text = text.split(STORAGE_KEY).join("[key]");
  if (SERVICE_KEY) text = text.split(SERVICE_KEY).join("[key]");
  return text
    .replace(/AccessKey[^\s]*/gi, "[key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/([?&])(token|expires|AccessKey)=[^&\s]*/gi, "$1$2=[redacted]")
    .slice(0, 400);
}

/** An error with the short reason the Studio shows (uploads.error). */
function reasoned(reason, message, isPermanent = false) {
  const err = new Error(message);
  err.reason = reason;
  if (isPermanent) err.permanent = true;
  return err;
}

/** Node's fetch hides the real reason down the `cause` chain. */
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
  return parts.join(" <- ") || String(err?.message ?? err);
}

async function withRetries(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err?.permanent) throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

/** Runs tasks with a fixed ceiling on how many are in flight. */
async function pool(items, limit, fn) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(runners);
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// Files are opened and closed by hand here and below: Windows will not rename
// or delete a file while any handle to it is still open.
async function hashFile(file) {
  const hash = createHash("sha256");
  const fh = await open(file, "r");
  try {
    for await (const chunk of fh.createReadStream({ autoClose: false })) hash.update(chunk);
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}

async function fileSize(file) {
  try {
    return (await stat(file)).size;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** supabase-js returns an embedded to-one relation as an object, or once as an array. */
function one(rel) {
  return Array.isArray(rel) ? rel[0] : rel;
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

let db;

/** A database function. SQL refusals are final; a dropped connection is retried. */
async function rpc(fn, args) {
  return withRetries(async () => {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      const err = reasoned("database", `${fn}: ${error.message}`);
      err.code = error.code;
      // A real answer from Postgres (a raised exception, a constraint, a
      // permission) will be the same next time, and so will a function that
      // is not in the database (PGRST202).
      if (error.code && (/^(P0|22|23|42)/.test(error.code) || error.code === "PGRST202")) err.permanent = true;
      throw err;
    }
    return data;
  });
}

/** A plain read or write through the API, retried on a dropped connection. */
async function query(label, build) {
  return withRetries(async () => {
    const { data, error } = await build();
    if (error) {
      const err = reasoned("database", `${label}: ${error.message}`);
      err.code = error.code;
      if (error.code && /^(P0|22|23|42)/.test(error.code)) err.permanent = true;
      throw err;
    }
    return data;
  });
}

// ---------------------------------------------------------------------------
// Bunny storage
// ---------------------------------------------------------------------------

function storageUrl(storagePath) {
  const clean = String(storagePath).replace(/^\/+/, "");
  // Each segment encoded; the slashes between them kept.
  return `https://${STORAGE_HOST}/${STORAGE_ZONE}/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

async function httpError(label, res) {
  const body = (await res.text().catch(() => "")).trim().replace(/\s+/g, " ").slice(0, 140);
  const err = reasoned("storage", `${label} HTTP ${res.status}${body ? ` - ${body}` : ""}`);
  // 4xx means the request is wrong (a checksum that does not match is 400);
  // repeating it changes nothing. 429 and 5xx are worth another go.
  if (!(res.status >= 500 || res.status === 429)) err.permanent = true;
  return err;
}

/**
 * Puts one file in storage. Bunny recomputes the SHA-256 of what arrived and
 * refuses the upload (400) if it is not the one sent with it, so a file that
 * is in storage is the file that was meant to be.
 */
async function putFile(storagePath, body, contentType, sha256, timeoutMs = UPLOAD_TIMEOUT_MS) {
  const label = `PUT ${storagePath}`;
  return withRetries(async () => {
    try {
      const res = await fetch(storageUrl(storagePath), {
        method: "PUT",
        headers: {
          AccessKey: STORAGE_KEY,
          "Content-Type": contentType,
          "Content-Length": String(body.length),
          Checksum: (sha256 ?? sha256Hex(body)).toUpperCase(),
          // Documents intent only; the pull zone's own setting decides.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw await httpError(label, res);
    } catch (err) {
      if (err?.permanent) throw err;
      if (err?.name === "TimeoutError") {
        throw reasoned("storage", `${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      if (err?.reason) throw err;
      throw reasoned("storage", `${label} network error: ${describeNetworkError(err)}`);
    }
  });
}

async function getFile(storagePath) {
  const res = await fetch(storageUrl(storagePath), {
    headers: { AccessKey: STORAGE_KEY },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw await httpError(`GET ${storagePath}`, res);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteFile(storagePath) {
  const res = await fetch(storageUrl(storagePath), {
    method: "DELETE",
    headers: { AccessKey: STORAGE_KEY },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw await httpError(`DELETE ${storagePath}`, res);
}

/**
 * Removes a file, or a folder and everything in it (a path ending in "/").
 * Already gone (404) counts as removed. Answers true when it was there.
 */
async function removeFromStorage(storagePath) {
  const label = `DELETE ${storagePath}`;
  return withRetries(async () => {
    let res;
    try {
      res = await fetch(storageUrl(storagePath), {
        method: "DELETE",
        headers: { AccessKey: STORAGE_KEY },
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name === "TimeoutError") throw reasoned("storage", `${label} timed out`);
      throw reasoned("storage", `${label} network error: ${describeNetworkError(err)}`);
    }
    if (res.status === 404) return false;
    if (!res.ok) throw await httpError(label, res);
    return true;
  });
}

// What a delete_files job may remove. The database only ever queues these
// shapes; checked again here because removing is the one thing that cannot
// be taken back.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DERIVATIVE_FOLDER = new RegExp(`^(d|clients/_d)/${UUID}/(${UUID}/)?$`);

function isOriginalPath(p) {
  return (
    typeof p === "string" &&
    p.length >= 3 &&
    p.length <= 1024 &&
    /^[^/]+(\/[^/]+)+$/.test(p) &&
    !/(^|\/)\.{1,2}(\/|$)/.test(p) &&
    !/^(d|clients\/_d)\//.test(p) &&
    !/[\u0000-\u001f\u007f\\]/.test(p)
  );
}

// ---------------------------------------------------------------------------
// Files waiting on this computer
// ---------------------------------------------------------------------------

const partPath = (id) => path.join(SPOOL, `${id}.part`); // still arriving
const fullPath = (id) => path.join(SPOOL, `${id}.bin`); // all here

// ---------------------------------------------------------------------------
// Receiving files from the browser
// ---------------------------------------------------------------------------

/** Tickets read from the database, kept for 30 seconds. */
const tickets = new Map();
/** Files with a request in progress: one piece at a time per file. */
const busy = new Set();
/** When each file's progress was last written to the database. */
const progressAt = new Map();

const TICKET_TTL_MS = 30_000;

async function readTicket(id) {
  const data = await query("read ticket", () =>
    db
      .from("uploads")
      .select("id, ticket_hash, ticket_expires_at, size_bytes, status, worker")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!data) {
    tickets.delete(id);
    return null;
  }
  const t = {
    hash: data.ticket_hash,
    expiresAt: data.ticket_expires_at ? Date.parse(data.ticket_expires_at) : 0,
    size: Number(data.size_bytes),
    status: data.status,
    worker: data.worker,
    fetched: Date.now(),
  };
  tickets.set(id, t);
  return t;
}

function tokenMatches(t, token) {
  if (!t?.hash || !/^[0-9a-f]{64}$/.test(t.hash)) return false;
  const want = Buffer.from(t.hash, "hex");
  const got = createHash("sha256").update(token).digest();
  return timingSafeEqual(want, got);
}

/**
 * The ticket for this file, if the request carries the right one. An unknown
 * file and a wrong ticket get the same answer, so nobody can find out which
 * files exist.
 */
async function authorize(req, id) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!/^[0-9a-f]{48}$/.test(token)) return { status: 401, error: "ticket" };

  let t = tickets.get(id);
  let fresh = false;
  if (!t || Date.now() - t.fetched > TICKET_TTL_MS) {
    t = await readTicket(id);
    fresh = true;
  }
  // A ticket renewed in the Studio since it was cached: read it once more.
  if (t && !fresh && !tokenMatches(t, token)) {
    t = await readTicket(id);
  }
  if (!t || !tokenMatches(t, token)) return { status: 401, error: "ticket" };
  if (t.expiresAt <= Date.now()) return { status: 401, error: "ticket_expired" };
  if (t.worker !== NAME) return { status: 409, error: "other_worker" };
  return { ticket: t };
}

function send(res, status, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/** Reads and throws away a request body we are not going to keep. */
async function drain(req) {
  for await (const chunk of req) void chunk;
}

/** Writes how far a file has got, at most every 2 seconds per file. */
function recordProgress(id, bytes) {
  const last = progressAt.get(id) ?? 0;
  if (Date.now() - last < 2000) return;
  progressAt.set(id, Date.now());
  db.from("uploads")
    .update({ status: "uploading", bytes_received: bytes })
    .eq("id", id)
    .in("status", ["waiting", "uploading"])
    .lt("bytes_received", bytes)
    .then(({ error }) => {
      if (error) warn(`could not record progress: ${sanitize(error.message)}`);
    });
}

async function handleStatus(req, res, id) {
  const auth = await authorize(req, id);
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const t = auth.ticket;
  if (!["waiting", "uploading"].includes(t.status)) {
    return send(res, 200, { offset: t.size, size: t.size, status: t.status, done: true });
  }
  const full = await fileSize(fullPath(id));
  const offset = full !== null ? t.size : ((await fileSize(partPath(id))) ?? 0);
  return send(res, 200, { offset, size: t.size, status: t.status, done: false });
}

async function handlePut(req, res, id, url) {
  if (stopping) {
    await drain(req);
    return send(res, 503, { error: "stopping" });
  }
  const auth = await authorize(req, id);
  if (auth.error) {
    await drain(req);
    return send(res, auth.status, { error: auth.error });
  }
  let t = auth.ticket;

  const offset = Number(url.searchParams.get("offset"));
  const length = Number(req.headers["content-length"]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > t.size) {
    await drain(req);
    return send(res, 400, { error: "offset" });
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    await drain(req);
    return send(res, 411, { error: "length" });
  }
  if (length > MAX_PIECE) {
    // Not read at all: the connection is closed after the answer, so the
    // sender may see the connection drop instead of this answer.
    res.setHeader("Connection", "close");
    return send(res, 413, { error: "too_large" });
  }
  if (offset + length > t.size) {
    await drain(req);
    return send(res, 413, { error: "past_end" });
  }

  // Already all here (a repeated last piece, or another tab): say so.
  if (!["waiting", "uploading"].includes(t.status)) {
    t = (await readTicket(id)) ?? t;
  }
  if (["queued", "processing", "ready", "skipped"].includes(t.status)) {
    await drain(req);
    return send(res, 200, { offset: t.size, size: t.size, status: t.status, done: true });
  }
  if (!["waiting", "uploading"].includes(t.status)) {
    await drain(req);
    return send(res, 409, { error: "status", status: t.status });
  }

  if (busy.has(id)) {
    await drain(req);
    return send(res, 409, { error: "busy" });
  }
  busy.add(id);
  try {
    // Every byte arrived before, but telling the database failed: try again.
    if ((await fileSize(fullPath(id))) !== null) {
      await drain(req);
      return await finishReceiving(res, id, t);
    }

    const part = partPath(id);
    const have = (await fileSize(part)) ?? 0;
    if (offset > have) {
      await drain(req);
      return send(res, 409, { error: "gap", offset: have });
    }
    // A piece sent again after a dropped answer: write it over what is there.
    if (offset < have) await truncate(part, offset);

    let written = 0;
    try {
      const fh = await open(part, "a");
      try {
        for await (const chunk of req) {
          written += chunk.length;
          if (written > length) throw new Error("more bytes than Content-Length");
          await fh.write(chunk);
        }
      } finally {
        await fh.close();
      }
    } catch (err) {
      // The browser went away mid-piece. Keep only whole pieces.
      await truncate(part, offset).catch(() => {});
      if (!res.writableEnded && !req.destroyed) send(res, 400, { error: "interrupted" });
      warn(`piece of ${id} interrupted: ${sanitize(err.message)}`);
      return;
    }
    if (written !== length) {
      await truncate(part, offset);
      return send(res, 400, { error: "short" });
    }

    const now = offset + written;
    if (now < t.size) {
      t.status = "uploading";
      recordProgress(id, now);
      return send(res, 200, { offset: now, size: t.size, status: "uploading", done: false });
    }

    await rename(part, fullPath(id));
    return await finishReceiving(res, id, t);
  } finally {
    busy.delete(id);
  }
}

async function finishReceiving(res, id, t) {
  const file = fullPath(id);
  const sha = await hashFile(file);
  let status;
  try {
    status = await rpc("worker_upload_received", { p_upload_id: id, p_name: NAME, p_sha256: sha });
  } catch (err) {
    warn(`could not record a received file: ${sanitize(err.message)}`);
    // The file stays; the browser sends an empty last piece to try again.
    return send(res, 503, { error: "database", offset: t.size, size: t.size, done: false });
  }
  t.status = status;
  t.fetched = Date.now();
  progressAt.delete(id);
  // Only a file nobody will build is thrown away. ('processing' or 'ready'
  // here means this was a repeat of a last piece already handled.)
  if (["skipped", "cancelled", "missing"].includes(status)) await rm(file, { force: true });
  if (status === "queued") wake();
  if (status === "skipped") log(`skipped   ${id}  the gallery already has this photograph`);
  return send(res, 200, { offset: t.size, size: t.size, status, done: true });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin) {
        if (!isAllowedOrigin(origin)) {
          await drain(req);
          return send(res, 403, { error: "origin" });
        }
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          // Chrome asks before a website talks to this computer.
          "Access-Control-Allow-Private-Network": "true",
          "Access-Control-Max-Age": "600",
        });
        return res.end();
      }

      const url = new URL(req.url ?? "/", "http://worker");
      if (url.pathname === "/health" && req.method === "GET") {
        // port: a browser that reached this through the tunnel tries this
        // computer directly next time, if it is the one the worker runs on.
        return send(res, 200, { ok: true, name: NAME, version: VERSION, accepting: !stopping, port: PORT });
      }

      const match = url.pathname.match(/^\/uploads\/([0-9a-fA-F-]{36})$/);
      if (!match) {
        await drain(req);
        return send(res, 404, { error: "not_found" });
      }
      const id = match[1].toLowerCase();
      if (req.method === "GET") return await handleStatus(req, res, id);
      if (req.method === "PUT") return await handlePut(req, res, id, url);
      await drain(req);
      return send(res, 405, { error: "method" });
    } catch (err) {
      warn(`request failed: ${sanitize(err.message)}`);
      if (!res.headersSent) send(res, err?.reason === "database" ? 503 : 500, { error: err?.reason ?? "internal" });
      else res.destroy();
    }
  });

  server.requestTimeout = 5 * 60_000;
  server.keepAliveTimeout = 30_000;

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${PORT} is already in use. Is the worker already running in another window?`));
      } else reject(err);
    });
    server.listen(PORT, HOST, () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

let stopping = false;
let running = 0;
/** The job loops waiting for work. A file arriving wakes them at once. */
const napping = new Set();

function wake() {
  for (const done of [...napping]) done();
}

function nap(ms) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      napping.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    napping.add(done);
  });
}

async function processUpload(job) {
  const id = job.payload?.upload_id;
  const u = await query("read upload", () =>
    db
      .from("uploads")
      .select(
        "id, gallery_id, photo_id, storage_path, content_type, size_bytes, sha256, status, attempts, original_name, galleries(id, slug, kind, title)",
      )
      .eq("id", id)
      .maybeSingle(),
  );
  // Cancelled, or its gallery deleted: nothing to do.
  if (!u || !["queued", "processing"].includes(u.status)) {
    await rm(fullPath(id), { force: true });
    return;
  }

  const marked = await query("mark processing", () =>
    db
      .from("uploads")
      .update({ status: "processing", attempts: u.attempts + 1 })
      .eq("id", id)
      .in("status", ["queued", "processing"])
      .select("id"),
  );
  // Cancelled or deleted with its gallery since it was read: nothing to build.
  if (!marked?.length) {
    await rm(fullPath(id), { force: true });
    return;
  }

  const started = Date.now();
  let src;
  try {
    src = await readFile(fullPath(id));
  } catch {
    throw reasoned("file_missing", "the file is no longer on this computer; send it again", true);
  }
  if (src.length !== Number(u.size_bytes) || sha256Hex(src) !== u.sha256) {
    throw reasoned("checksum", "the file on this computer is not the file that was sent; send it again", true);
  }

  // What the bytes really are, whatever the name says.
  const isJpeg = src.length > 3 && src[0] === 0xff && src[1] === 0xd8 && src[2] === 0xff;
  const isPng = src.length > 8 && src.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw reasoned("not_an_image", "not a JPEG or PNG file", true);
  if ((isPng ? "image/png" : "image/jpeg") !== u.content_type) {
    throw reasoned(
      "type_mismatch",
      `the file is a ${isPng ? "PNG" : "JPEG"} but its name says ${u.content_type === "image/png" ? "PNG" : "JPEG"}`,
      true,
    );
  }

  let ladder;
  try {
    ladder = await encodeLadder(src);
  } catch (err) {
    throw reasoned("not_an_image", `could not read the image: ${err.message}`, true);
  }
  if (ladder.format !== "jpeg" && ladder.format !== "png") {
    throw reasoned("not_an_image", `not a JPEG or PNG file (${ladder.format})`, true);
  }

  const gallery = one(u.galleries);
  const prefix = prefixFor(gallery?.kind, u.gallery_id, u.photo_id, ladder.checksum8, LADDER_REV);

  // The derivatives first, the original last, the row after both: a page
  // never finds a photo whose files are not all there.
  const tUp = Date.now();
  await pool(ladder.files, UPLOAD_CONCURRENCY, (f) => putFile(`${prefix}/${f.name}`, f.body, f.type));
  await putFile(u.storage_path, src, u.content_type, u.sha256, ORIGINAL_TIMEOUT_MS);
  const msUp = Date.now() - tUp;

  await rpc("worker_complete_upload", {
    p_upload_id: id,
    p_name: NAME,
    p_photo: {
      alt: gallery?.title ?? null,
      width: ladder.width,
      height: ladder.height,
      checksum8: ladder.checksum8,
      thumbhash: ladder.thumbhash,
      variants: ladder.variants,
      delivery_bytes: ladder.delivery_bytes,
      share_bytes: ladder.share_bytes,
      ladder_rev: LADDER_REV,
    },
    p_stored_bytes: src.length + ladder.totalOut,
  });

  await rm(fullPath(id), { force: true });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log(
    `ready     ${u.storage_path}  ${ladder.width}x${ladder.height}  ${human(src.length)} + ` +
      `${ladder.files.length} files ${human(ladder.totalOut)}  ` +
      `encode ${(ladder.msEncode / 1000).toFixed(1)}s, upload ${(msUp / 1000).toFixed(1)}s, ${secs}s in all`,
  );
}

/** File-name order, exactly as reseed.ts and /api/sync sort a folder. */
function byFileName(a, b) {
  const an = a.storage_path.split("/").pop();
  const bn = b.storage_path.split("/").pop();
  return an.localeCompare(bn, "en", { numeric: true });
}

async function finishBatch(job) {
  const batchId = job.payload?.batch_id;
  const batch = await query("read batch", () =>
    db
      .from("upload_batches")
      .select("id, gallery_id, ready_count, galleries(slug)")
      .eq("id", batchId)
      .maybeSingle(),
  );
  if (!batch) return;
  const slug = one(batch.galleries)?.slug;

  const photos = await query("read photos", () =>
    db.from("photos").select("id, storage_path").eq("gallery_id", batch.gallery_id),
  );
  const ordered = (photos ?? []).slice().sort(byFileName);
  const moved = await rpc("worker_set_photo_order", {
    p_gallery_id: batch.gallery_id,
    p_photo_ids: ordered.map((p) => p.id),
  });

  // Before refreshing SITE_URL, so a Studio on another site (a preview,
  // pnpm dev) can refresh its own pages even if that refresh fails.
  await settleBatch(batchId);
  const refreshed = slug ? await refreshSite(slug) : false;
  log(
    `drop done ${slug ?? batch.gallery_id}  ${batch.ready_count} new` +
      `${moved ? `, ${moved} moved into file-name order` : ""}` +
      `${refreshed ? `, ${SITE_HOST} refreshed` : ""}`,
  );
}

let warnedNoSettle = false;

/**
 * Marks the drop finished with (upload_batches.settled_at). The Studio that
 * sent it waits for this, then refreshes the album page on its own site.
 */
async function settleBatch(batchId) {
  try {
    await rpc("worker_settle_batch", { p_batch_id: batchId });
  } catch (err) {
    if (err.code !== "PGRST202") throw err;
    if (!warnedNoSettle) {
      warn(
        "worker_settle_batch is not in the database: run 20261116140000_upload_batch_settled.sql. " +
          "Until then a Studio on another site refreshes its pages 90 seconds after a drop.",
      );
      warnedNoSettle = true;
    }
  }
}

let warnedNoSecret = false;

/** Tells the site that this gallery's pages changed. */
async function refreshSite(slug) {
  if (!REVALIDATE_SECRET) {
    if (!warnedNoSecret) {
      warn(
        "REVALIDATE_SECRET is not set, so the site's cache is not refreshed. " +
          "Client galleries show new photos at once; public albums update on their own later.",
      );
      warnedNoSecret = true;
    }
    return false;
  }
  const url = `${SITE_URL}/api/sync?only=revalidate&now=1&gallery=${encodeURIComponent(slug)}`;
  return withRetries(async () => {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw reasoned("site", `refresh ${SITE_URL}: ${describeNetworkError(err)}`);
    }
    if (!res.ok) {
      const err = reasoned("site", `refresh ${SITE_URL}: HTTP ${res.status}`);
      if (res.status === 401) err.permanent = true;
      throw err;
    }
    return true;
  });
}

/**
 * Removes the files of deleted photos (studio_delete_photos) or of a deleted
 * gallery (studio_delete_gallery). Their rows are already gone.
 */
async function deleteFiles(job) {
  const p = job.payload ?? {};
  const dirs = (Array.isArray(p.dirs) ? p.dirs : []).filter((d) => DERIVATIVE_FOLDER.test(d));
  const paths = (Array.isArray(p.paths) ? p.paths : []).filter(isOriginalPath);
  const odd = (p.dirs?.length ?? 0) + (p.paths?.length ?? 0) - dirs.length - paths.length;
  if (odd > 0) warn(`left ${odd} path(s) of ${p.slug ?? "a gallery"} alone: they do not look like its files`);

  // The site first: the rows are gone, so once it is refreshed no page
  // points at these files any more. If it cannot be told, nothing is
  // removed and the job is tried again later.
  if (typeof p.slug === "string" && p.slug) await refreshSite(p.slug);

  // A name freed by the delete may have been taken by a new upload since:
  // an original some row still uses (or is about to) stays.
  const inUse = new Set();
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const [photos, uploads] = await Promise.all([
      query("read photos", () => db.from("photos").select("storage_path").in("storage_path", chunk)),
      query("read uploads", () =>
        db
          .from("uploads")
          .select("storage_path")
          .in("storage_path", chunk)
          .in("status", ["waiting", "uploading", "queued", "processing"]),
      ),
    ]);
    for (const r of [...(photos ?? []), ...(uploads ?? [])]) inUse.add(r.storage_path);
  }
  const originals = paths.filter((x) => !inUse.has(x));

  // And a folder some photo row still points into stays: since step 7 rows
  // in other galleries can share files, and a gallery's folder can hold the
  // files of photos that moved out of it.
  const folders = [];
  for (const dir of dirs) {
    const rows = await query("read photos", () =>
      db.from("photos").select("id").like("files_at", `${dir.replace(/[\\%_]/g, "\\$&")}%`).limit(1),
    ).catch((err) => {
      // A database without files_at (before 20261116230000): the rows cannot
      // be asked, and the folders were queued by a function that knew.
      if (err.code === "42703") return [];
      throw err;
    });
    if (rows?.length) inUse.add(dir);
    else folders.push(dir);
  }

  let found = 0;
  await pool([...folders, ...originals], 4, async (target) => {
    if (await removeFromStorage(target)) found++;
  });

  const n = Number(p.photos) || 0;
  log(
    `removed   ${n} photo${n === 1 ? "" : "s"} of ${p.slug ?? p.gallery_id}: ` +
      `${originals.length} original${originals.length === 1 ? "" : "s"}, ${folders.length} folder${folders.length === 1 ? "" : "s"}` +
      `${found < folders.length + originals.length ? ` (${folders.length + originals.length - found} already gone)` : ""}` +
      `${inUse.size ? `, ${inUse.size} kept (in use again)` : ""}`,
  );
}

async function runJob(job) {
  running++;
  const beat = setInterval(() => {
    rpc("worker_job_heartbeat", { p_job_id: job.id, p_name: NAME }).catch(() => {});
  }, JOB_HEARTBEAT_MS);
  try {
    if (job.kind === "process_upload") await processUpload(job);
    else if (job.kind === "finish_batch") await finishBatch(job);
    else if (job.kind === "delete_files") await deleteFiles(job);
    else throw permanent(new Error(`this worker does not run ${job.kind} jobs`));
    await rpc("worker_finish_job", { p_job_id: job.id, p_name: NAME, p_ok: true });
  } catch (err) {
    const message = sanitize(err?.message ?? err);
    const final = Boolean(err?.permanent) || job.attempts >= job.max_attempts;
    const retryIn = RETRY_IN_SECONDS[Math.min(job.attempts - 1, RETRY_IN_SECONDS.length - 1)];
    let status = "failed";
    try {
      status = await rpc("worker_finish_job", {
        p_job_id: job.id,
        p_name: NAME,
        p_ok: false,
        p_error: message,
        p_retry_in: final ? null : retryIn,
      });
    } catch (e) {
      warn(`could not record a failed job: ${sanitize(e.message)}`);
    }

    if (job.kind === "process_upload") {
      const id = job.payload?.upload_id;
      const patch =
        status === "queued"
          ? { status: "queued", error_detail: message }
          : {
              status: "failed",
              error: err?.reason && /^[a-z_]{1,40}$/.test(err.reason) ? err.reason : "internal",
              error_detail: message,
              finished_at: new Date().toISOString(),
            };
      await query("mark upload", () =>
        db.from("uploads").update(patch).eq("id", id).in("status", ["queued", "processing"]),
      ).catch((e) => warn(`could not record a failed upload: ${sanitize(e.message)}`));
      // A file that can never work is not kept.
      if (status === "failed" && ["not_an_image", "type_mismatch", "checksum"].includes(err?.reason)) {
        await rm(fullPath(id), { force: true });
      }
    }

    if (status === "queued") warn(`retrying ${job.kind} in ${retryIn}s: ${message}`);
    else warn(`FAILED    ${job.kind}: ${message}`);
  } finally {
    clearInterval(beat);
    running--;
  }
}

async function jobLoop() {
  while (!stopping) {
    let job = null;
    try {
      const rows = await rpc("worker_claim_job", { p_name: NAME, p_kinds: KINDS });
      job = Array.isArray(rows) ? rows[0] : rows;
    } catch (err) {
      warn(`could not ask for work: ${sanitize(err.message)}`);
    }
    if (!job) {
      await nap(IDLE_POLL_MS);
      continue;
    }
    await runJob(job);
  }
}

// ---------------------------------------------------------------------------
// The database copy
// ---------------------------------------------------------------------------

/** 2026-11-16, or 2026-11-16-1530 with the time: this computer's clock. */
function localStamp(d, withTime = false) {
  const two = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return withTime ? `${day}-${two(d.getHours())}${two(d.getMinutes())}` : day;
}

const backupPath = (stamp) => path.join(BACKUP_DIR, `saycheeeeeze-db-${stamp}.json.gz`);

/** Every row of one table, in primary-key order. */
async function readTable(t) {
  const rows = [];
  const seen = new Set();
  let total = null;
  for (let from = 0; ; ) {
    const page = await withRetries(async () => {
      let qb = db.from(t.table_name).select("*", from === 0 ? { count: "exact" } : undefined);
      for (const k of t.primary_key) qb = qb.order(k, { ascending: true });
      const { data, error, count } = await qb.range(from, from + BACKUP_PAGE - 1);
      if (error) {
        const err = reasoned("database", `${t.table_name}: ${error.message}`);
        if (error.code && /^(42|PGRST)/.test(error.code)) err.permanent = true;
        throw err;
      }
      if (from === 0) total = count;
      return data ?? [];
    });
    for (const r of page) {
      // A row that moved between two pages while reading is kept once.
      const key = t.primary_key.length ? JSON.stringify(t.primary_key.map((k) => r[k])) : null;
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(r);
    }
    from += page.length;
    if (page.length === 0 || (total !== null && from >= total)) break;
  }
  return rows;
}

let warnedNoBackup = false;

/** Notes on this worker's row how the last copy went, for the Studio. */
async function recordBackup(fields) {
  const { error } = await db.from("workers").update(fields).eq("name", NAME);
  if (error && !warnedNoBackup) {
    warn(`could not note the database copy for the Studio (${sanitize(error.message)})`);
    warnedNoBackup = true;
  }
}

/**
 * Writes a copy of every table to BACKUP_DIR, then keeps the newest
 * BACKUP_KEEP. A table that cannot be read is noted in the copy and in the
 * error; the others are still saved.
 */
async function makeBackup({ withTime = false } = {}) {
  const started = Date.now();
  const at = new Date();
  let tables;
  try {
    tables = await rpc("worker_backup_tables", {});
  } catch (err) {
    if (err.code === "PGRST202") {
      throw reasoned("database", "worker_backup_tables is not in the database: run 20261116170000_studio_delete_and_backup.sql", true);
    }
    throw err;
  }
  const users = await rpc("worker_backup_users", {});

  const copy = {
    format: "saycheeeeeze-db-copy",
    version: 1,
    made_at: at.toISOString(),
    worker: NAME,
    database: (() => {
      try {
        return new URL(SUPABASE_URL).host;
      } catch {
        return null;
      }
    })(),
    users,
    tables: [],
  };
  const problems = [];
  let rowCount = 0;
  for (const t of tables) {
    const entry = {
      name: t.table_name,
      columns: t.columns,
      primary_key: t.primary_key,
      generated: t.generated,
      depends_on: t.depends_on,
      auth_user_columns: t.auth_user_columns,
      rows: null,
    };
    try {
      entry.rows = await readTable(t);
      rowCount += entry.rows.length;
    } catch (err) {
      entry.error = sanitize(err.message);
      problems.push(`${t.table_name} (${entry.error})`);
    }
    copy.tables.push(entry);
  }

  const body = gzipSync(Buffer.from(JSON.stringify(copy)));
  await mkdir(BACKUP_DIR, { recursive: true });
  const file = backupPath(localStamp(at, withTime));
  await writeFile(`${file}.part`, body);
  await rename(`${file}.part`, file);
  const pruned = await pruneBackups();

  const saved = copy.tables.filter((t) => t.rows).length;
  const error = problems.length ? `${problems.length} table(s) not copied: ${problems.join("; ")}`.slice(0, 500) : null;
  await recordBackup({ backup_at: at.toISOString(), backup_bytes: body.length, backup_tables: saved, backup_error: error });
  log(
    `db copy   ${path.basename(file)}  ${saved} tables, ${rowCount} rows, ${human(body.length)}, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s` +
      `${pruned ? `, ${pruned} old cop${pruned === 1 ? "y" : "ies"} removed` : ""}`,
  );
  if (error) warn(`db copy   ${error}`);
  return { file, bytes: body.length, tables: saved, rows: rowCount, error };
}

/** Keeps the newest BACKUP_KEEP copies. Only files named like a copy. */
async function pruneBackups() {
  const all = await readdir(BACKUP_DIR).catch(() => []);
  const names = all.filter((n) => BACKUP_FILE.test(n)).sort();
  const old = names.slice(0, Math.max(0, names.length - BACKUP_KEEP));
  for (const n of old) await rm(path.join(BACKUP_DIR, n), { force: true });
  // Half-written copies from a stop in the middle of one.
  for (const n of all.filter((x) => BACKUP_FILE.test(x.replace(/\.part$/, "")) && x.endsWith(".part"))) {
    const st = await stat(path.join(BACKUP_DIR, n)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 3600_000) await rm(path.join(BACKUP_DIR, n), { force: true });
  }
  return old.length;
}

let backupFailedAt = 0;
let backingUp = false;

/** The copy of the day: once a day, from BACKUP_HOUR on, while the worker runs. */
async function backupIfDue() {
  const now = new Date();
  if (stopping || backingUp || now.getHours() < BACKUP_HOUR) return;
  if (await stat(backupPath(localStamp(now))).catch(() => null)) return;
  // A failed copy is tried again an hour later, not every ten minutes.
  if (Date.now() - backupFailedAt < 3600_000) return;
  backingUp = true;
  try {
    await makeBackup();
  } catch (err) {
    backupFailedAt = Date.now();
    const message = sanitize(err?.message ?? err);
    warn(`db copy   failed: ${message}`);
    await recordBackup({ backup_error: message.slice(0, 500) });
  } finally {
    backingUp = false;
  }
}

// ---------------------------------------------------------------------------
// The tunnel: phones and other computers
// ---------------------------------------------------------------------------

let tunnel = null;
let tunnelRestarts = 0;
let tunnelTimer = null;

/**
 * Starts cloudflared's quick tunnel to this worker and, once Cloudflare says
 * the connection is up, gives the database its address. If it stops, the
 * door goes back to this computer only and it is started again, waiting
 * longer each time (5 s up to 2 min).
 */
function startTunnel() {
  if (stopping) return;
  let seenUrl = null;
  let up = false;
  let child;
  try {
    child = spawn(TUNNEL_COMMAND, ["tunnel", "--no-autoupdate", "--url", LOCAL_URL], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    return tunnelMissing(err);
  }
  tunnel = child;
  let buffer = "";
  const read = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const url = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
      if (url && !seenUrl) seenUrl = url.toLowerCase();
      // "Registered tunnel connection connIndex=0 ..." : reachable now.
      if (!up && seenUrl && /registered tunnel connection/i.test(line)) {
        up = true;
        tunnelUrl = seenUrl;
        tunnelRestarts = 0;
        log(`tunnel    other devices send to ${tunnelUrl}`);
        heartbeat();
      }
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.once("error", (err) => {
    if (err.code === "ENOENT") tunnelMissing(err);
    else warn(`tunnel    could not start (${sanitize(err.message)})`);
  });
  child.once("exit", (code) => {
    if (tunnel === child) tunnel = null;
    const had = tunnelUrl;
    tunnelUrl = null;
    if (stopping) return;
    if (child.spawnfailed) return;
    if (had) heartbeat();
    const wait = Math.min(120, 5 * 2 ** Math.min(tunnelRestarts, 5));
    tunnelRestarts++;
    warn(`tunnel    stopped${code === null ? "" : ` (exit ${code})`}; other devices cannot send until it is back. Trying again in ${wait} s`);
    tunnelTimer = setTimeout(startTunnel, wait * 1000);
  });
}

function tunnelMissing(err) {
  if (tunnel) tunnel.spawnfailed = true;
  tunnel = null;
  if (err?.code === "ENOENT" || /ENOENT/.test(String(err?.message))) {
    console.log(
      "  other devices       off: cloudflared is not installed. To upload from your phone, run once\n" +
        "                      winget install --id Cloudflare.cloudflared\n" +
        "                      and start the worker again.",
    );
  } else {
    warn(`tunnel    could not start (${sanitize(err?.message ?? err)})`);
  }
}

function stopTunnel() {
  clearTimeout(tunnelTimer);
  const t = tunnel;
  tunnel = null;
  tunnelUrl = null;
  if (t && t.exitCode === null) t.kill();
}

// ---------------------------------------------------------------------------
// Staying in touch, tidying up
// ---------------------------------------------------------------------------

let offline = false;

async function heartbeat() {
  try {
    await rpc("worker_heartbeat", {
      p_name: NAME,
      p_version: VERSION,
      p_upload_url: doorUrl(),
      p_accepting: !stopping,
    });
    if (offline) log("the database answers again");
    offline = false;
  } catch (err) {
    if (!offline) warn(`the database does not answer (${sanitize(err.message)}); uploads wait until it does`);
    offline = true;
  }
}

/** Deletes waiting files whose upload is finished, cancelled or long abandoned. */
async function cleanSpool() {
  let names;
  try {
    names = await readdir(SPOOL);
  } catch {
    return;
  }
  const files = names
    .map((n) => n.match(/^([0-9a-f-]{36})\.(part|bin)$/))
    .filter(Boolean)
    .map((m) => ({ id: m[1], file: path.join(SPOOL, m[0]), kind: m[2] }));
  if (files.length === 0) return;

  const status = new Map();
  for (let i = 0; i < files.length; i += 100) {
    const ids = files.slice(i, i + 100).map((f) => f.id);
    const rows = await query("read uploads", () => db.from("uploads").select("id, status").in("id", ids)).catch(
      () => null,
    );
    // Not knowing is not a reason to delete.
    if (!rows) return;
    for (const r of rows) status.set(r.id, r.status);
  }

  const day = 24 * 3600_000;
  let removed = 0;
  for (const f of files) {
    if (busy.has(f.id)) continue;
    const s = status.get(f.id);
    const age = Date.now() - ((await stat(f.file).catch(() => null))?.mtimeMs ?? Date.now());
    const gone =
      s === undefined || // its gallery or drop was deleted
      ["ready", "skipped", "cancelled"].includes(s) ||
      (s === "failed" && age > 14 * day) ||
      (["waiting", "uploading"].includes(s) && age > 7 * day);
    if (gone) {
      await rm(f.file, { force: true });
      removed++;
    }
  }
  if (removed) log(`tidied    ${removed} finished file(s) from ${SPOOL}`);
}

// ---------------------------------------------------------------------------
// --check: prove every connection before relying on them
// ---------------------------------------------------------------------------

async function check() {
  console.log(`\nWorker check (${NAME})\n`);

  process.stdout.write("  database (service key) ... ");
  await query("read workers", () => db.from("workers").select("name").limit(1));
  console.log("ok");

  const testPath = `d/.worker-check-${Date.now()}.txt`;
  const body = Buffer.from("saycheeeeeze worker write test\n");
  process.stdout.write(`  storage ${STORAGE_ZONE} @ ${STORAGE_HOST}: write ... `);
  await putFile(testPath, body, "text/plain");
  process.stdout.write("read ... ");
  const back = await getFile(testPath);
  if (!back.equals(body)) throw new Error("read back different bytes");
  process.stdout.write("delete ... ");
  await deleteFile(testPath);
  console.log("ok");

  process.stdout.write(`  spool folder ${SPOOL} ... `);
  await mkdir(SPOOL, { recursive: true });
  const probe = path.join(SPOOL, ".write-test");
  await writeFile(probe, "ok");
  await rm(probe, { force: true });
  console.log("ok");

  process.stdout.write(`  database copies in ${BACKUP_DIR} ... `);
  await mkdir(BACKUP_DIR, { recursive: true });
  const probe2 = path.join(BACKUP_DIR, ".write-test");
  await writeFile(probe2, "ok");
  await rm(probe2, { force: true });
  console.log("ok");

  if (REVALIDATE_SECRET) console.log(`  site to refresh: ${SITE_URL}`);
  else console.log("  REVALIDATE_SECRET not set: the site's cache will not be refreshed after a drop");
  console.log("\nEverything the worker needs answers. Start it without --check.\n");
}

// ---------------------------------------------------------------------------
// Start and stop
// ---------------------------------------------------------------------------

async function main() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!STORAGE_ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!STORAGE_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Run it from the project folder with:  pnpm worker");
    process.exit(1);
  }

  db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (CHECK) {
    await check();
    return;
  }

  if (BACKUP_NOW) {
    const made = await makeBackup({ withTime: true });
    console.log(`\nSaved ${made.file}\n  ${made.tables} tables, ${made.rows} rows, ${human(made.bytes)}\n`);
    if (made.error) process.exitCode = 1;
    return;
  }

  await mkdir(SPOOL, { recursive: true });
  const server = await startServer();

  await rpc("worker_heartbeat", {
    p_name: NAME,
    p_version: VERSION,
    p_upload_url: doorUrl(),
    p_accepting: true,
  }).catch((err) => {
    throw new Error(
      `The database refused the worker: ${sanitize(err.message)}\n` +
        "If it says a function does not exist, run supabase/migrations/20261116090000_studio_uploads.sql first.",
    );
  });
  const requeued = await rpc("worker_start", { p_name: NAME });

  console.log(`\nStudio worker ${NAME} (v${VERSION}, ladder v${LADDER_REV})`);
  console.log(`  receiving files at  ${FIXED_URL ?? LOCAL_URL}`);
  if (TUNNEL) console.log("  other devices       starting a tunnel ...");
  console.log(`  waiting files in    ${SPOOL}`);
  console.log(`  storage             ${STORAGE_ZONE} @ ${STORAGE_HOST}`);
  console.log(`  refreshes           ${REVALIDATE_SECRET ? SITE_URL : "nothing (REVALIDATE_SECRET not set)"}`);
  console.log(`  database copy       daily from ${String(BACKUP_HOUR).padStart(2, "0")}:00 to ${BACKUP_DIR} (last ${BACKUP_KEEP} kept)`);
  if (requeued) console.log(`  ${requeued} job(s) left from last time are back in the queue`);
  console.log("\nLeave this window open while you upload. Ctrl-C stops it.\n");

  const beat = setInterval(heartbeat, HEARTBEAT_MS);
  cleanSpool().catch(() => {});
  const tidy = setInterval(() => cleanSpool().catch(() => {}), CLEAN_EVERY_MS);
  // Not at the very start: uploads waiting since last time go first.
  const firstCopy = setTimeout(() => backupIfDue().catch(() => {}), 30_000);
  const copies = setInterval(() => backupIfDue().catch(() => {}), BACKUP_CHECK_MS);
  const loops = Array.from({ length: JOBS }, () => jobLoop());
  if (TUNNEL) startTunnel();

  let stops = 0;
  const stop = async () => {
    stops++;
    if (stops > 1) {
      console.log("\nStopped. Unfinished work is picked up next time.");
      process.exit(130);
    }
    console.log("\nStopping: no new uploads; finishing what is in hand (Ctrl-C again to stop now) ...");
    stopping = true;
    clearInterval(beat);
    clearInterval(tidy);
    clearTimeout(firstCopy);
    clearInterval(copies);
    stopTunnel();
    server.close();
    server.closeIdleConnections?.();
    wake();
    await heartbeat();
    await Promise.race([Promise.all(loops), sleep(120_000)]);
    if (running) console.log("Stopped with work in hand; it is picked up next time.");
    else console.log("Stopped.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(`\n${sanitize(err instanceof Error ? err.message : String(err))}\n`);
  process.exit(1);
});
