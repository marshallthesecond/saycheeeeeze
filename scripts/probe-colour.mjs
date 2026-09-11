// scripts/probe-colour.mjs
//
// Answers one question that has been open since the ladder was built:
//
//   what colour space are the originals in, and does the delivery JPEG
//   still say so?
//
//   node --env-file=.env.local scripts/probe-colour.mjs [--limit 8] [--gallery slug]
//
// Read-only. Downloads a sample from Bunny Storage, reads metadata, writes
// nothing anywhere.
//
// ── Why this matters ─────────────────────────────────────────
// sharp strips metadata unless you ask it not to, and nothing in the worker
// asks. So every derivative — the AVIF/WebP rungs, share.jpg and download.jpg —
// is written with NO ICC profile attached.
//
// For the rungs that is harmless: they are built from a master that goes
// through .toColourspace("srgb"), so the pixels really are sRGB and every
// viewer's assumption is correct.
//
// download.jpg is the exception. It is encoded straight off the original, with
// no colourspace conversion, and then written with no profile. If the originals
// are sRGB that is fine — the assumption matches the pixels. If they are
// AdobeRGB or ProPhoto, the file carries wide-gamut pixel values while telling
// every viewer they are sRGB, and the result is the muted, flat-looking print a
// client blames on the photographer.
//
// Nobody notices this on a screen full of web derivatives. They notice it when
// a client prints one. So: measure, then decide, rather than "fixing" a
// pipeline that might not be broken.
//
// ── Reading the output ───────────────────────────────────────
//   space=srgb, profile=none            → nothing to do
//   space=srgb, profile=sRGB            → nothing to do
//   space=rgb16 / cmyk                  → look closer
//   profile=Adobe RGB (1998) / ProPhoto → download.jpg is mis-tagged today

import process from "node:process";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY;
const STORAGE_HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

{
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
  if (!STORAGE_ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!STORAGE_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Run with:  node --env-file=.env.local scripts/probe-colour.mjs");
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const val = (f, d = null) => {
  const i = argv.indexOf(`--${f}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};
const LIMIT = Number(val("limit", "8"));
const GALLERY = val("gallery");

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function fetchStorage(path) {
  const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${String(path).replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    headers: { AccessKey: STORAGE_KEY },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** mluc strings are UTF-16BE. Node has no such encoding, so swap and decode. */
function utf16be(buf) {
  const b = Buffer.from(buf);
  b.swap16();
  return b.toString("utf16le").replace(/\0+$/, "");
}

/**
 * The ICC profile's own description, which is the only thing that actually
 * names the space.
 *
 * sharp's `metadata().space` is libvips' interpretation, NOT the profile: a
 * Display P3 JPEG reports space=srgb while carrying P3 primaries. Reading the
 * profile is the only way to tell them apart, and telling them apart is the
 * entire point of this script.
 *
 * The tag table has to be walked properly. Searching the raw bytes for "desc"
 * finds the tag TABLE ENTRY, whose next twelve bytes are an offset and a size
 * rather than the string — the first version of this returned "cprt" for every
 * profile ever made. So: header is 128 bytes, tag count at 128, then 12-byte
 * entries of signature/offset/size. The data is either a v2 'desc' (ASCII) or a
 * v4 'mluc' (UTF-16BE records); both appear in the wild.
 */
function profileName(icc) {
  try {
    if (!icc || icc.length < 132) return null;
    const count = icc.readUInt32BE(128);
    if (count > 200) return "(unreadable profile)";

    for (let i = 0; i < count; i++) {
      const entry = 132 + i * 12;
      if (entry + 12 > icc.length) break;
      if (icc.toString("latin1", entry, entry + 4) !== "desc") continue;

      const at = icc.readUInt32BE(entry + 4);
      if (at + 28 > icc.length) break;
      const type = icc.toString("latin1", at, at + 4);

      if (type === "desc") {
        const n = icc.readUInt32BE(at + 8);
        return icc.toString("latin1", at + 12, at + 12 + Math.max(0, n - 1)).trim();
      }
      if (type === "mluc") {
        const len = icc.readUInt32BE(at + 20);
        const off = icc.readUInt32BE(at + 24);
        if (at + off + len > icc.length) break;
        return utf16be(icc.subarray(at + off, at + off + len)).trim();
      }
      break;
    }
    return "(unnamed profile)";
  } catch {
    return "(unreadable profile)";
  }
}

async function describe(buf) {
  const m = await sharp(buf, { failOn: "none" }).metadata();
  return {
    format: m.format,
    space: m.space ?? "?",
    depth: m.depth ?? "?",
    channels: m.channels ?? "?",
    profile: profileName(m.icc),
  };
}

function prefixOf(row) {
  const rel = row.galleries;
  const kind = Array.isArray(rel) ? rel[0]?.kind : rel?.kind;
  const root = kind === "client" ? "clients/_d" : "d";
  return `${root}/${row.gallery_id}/${row.id}/${row.checksum8}/v${row.ladder_rev ?? 1}`;
}

let q = db
  .from("photos")
  .select("id, gallery_id, storage_path, checksum8, ladder_rev, galleries!inner(slug, kind)")
  .eq("status", "ready")
  .order("created_at", { ascending: true });
if (GALLERY) q = q.eq("galleries.slug", GALLERY);
if (LIMIT) q = q.limit(LIMIT);

const { data, error } = await q;
if (error) {
  console.error(`Supabase: ${error.message}`);
  process.exit(1);
}

const rows = data ?? [];
if (rows.length === 0) {
  console.log("\nNo ready photos matched.\n");
  process.exit(0);
}

console.log(`\nColour probe — ${rows.length} photo(s)\n`);

const seen = new Map();
let mismatched = 0;

for (const row of rows) {
  console.log(row.storage_path);
  try {
    const original = await describe(await fetchStorage(row.storage_path));
    console.log(
      `      original     ${original.format}  space=${original.space}  ` +
        `depth=${original.depth}  profile=${original.profile ?? "none"}`,
    );

    const key = `${original.space}/${original.profile ?? "none"}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);

    try {
      const delivery = await describe(await fetchStorage(`${prefixOf(row)}/download.jpg`));
      console.log(
        `      download.jpg ${delivery.format}  space=${delivery.space}  ` +
          `profile=${delivery.profile ?? "none"}`,
      );

      // The failure this script exists to find: wide-gamut pixels shipped with
      // no profile, so every viewer reads them as sRGB and renders them flat.
      const wide =
        original.profile &&
        !/srgb/i.test(original.profile) &&
        !/^(gray|b-w)/i.test(original.profile);
      if (wide && !delivery.profile) {
        mismatched++;
        console.log(
          `      ^^ MIS-TAGGED — "${original.profile}" pixels, no profile on the JPEG`,
        );
      }
    } catch (e) {
      console.log(`      download.jpg  not readable (${e.message})`);
    }
  } catch (e) {
    console.log(`      FAILED  ${e.message}`);
  }
}

console.log("\nOriginals by space/profile:");
for (const [key, n] of [...seen].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)} × ${key}`);
}

console.log(
  mismatched > 0
    ? `\n${mismatched} photo(s) ship wide-gamut pixels with no profile. download.jpg and\n` +
        "share.jpg need .toColourspace(\"srgb\").withMetadata({ icc: \"srgb\" }), then a\n" +
        "LADDER_REV bump and a rebuild — the bytes at existing URLs would change.\n"
    : "\nNo mis-tagged files found. The delivery JPEGs are consistent with their\n" +
        "sources, so the colour question is closed — copyright metadata can still be\n" +
        "added without a revision bump only if you accept the same bytes changing,\n" +
        "which you should not. Bundle it with the next LADDER_REV bump instead.\n",
);
