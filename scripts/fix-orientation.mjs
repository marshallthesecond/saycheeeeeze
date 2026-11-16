// Puts right the width and height of photos that were shot upright on a phone.
//
//   node --env-file=.env.local scripts/fix-orientation.mjs                  # look, change nothing
//   node --env-file=.env.local scripts/fix-orientation.mjs --apply          # fix them
//   node --env-file=.env.local scripts/fix-orientation.mjs --gallery <slug> # one gallery only
//
// A phone stores a portrait photo as landscape pixels plus an EXIF note that
// says "turn me 90 degrees". The ladder has always turned the pixels, but
// until 2026-11-16 build-ladder.mjs recorded the size from BEFORE the turn,
// and reseed.ts and /api/sync measure it that way too. So such a photo is a
// portrait image in a landscape box: the page reserves the wrong shape.
//
// This reads the first 256 KB of each JPEG original (enough for the EXIF),
// and where the note says the photo is turned a quarter (orientation 5 to 8)
// and the row holds the sideways size, it swaps width and height. Nothing
// else is touched; files in storage are not changed.
//
// Its derivatives are already upright and stay as they are. One rare case is
// listed at the end: an upright width narrower than a rung the old build
// promised (an original under 2048 px wide once turned). Those images are
// fine but their largest size is labelled bigger than it is; rebuild them
// with the command printed there.
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// BUNNY_STORAGE_ZONE and BUNNY_STORAGE_API_KEY, as build-ladder.mjs does.

import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { imageSize } from "image-size";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY;
const STORAGE_HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const gi = argv.indexOf("--gallery");
const GALLERY = gi === -1 ? null : (argv[gi + 1] ?? "");
if (GALLERY === "") {
  console.error("--gallery needs a slug after it.");
  process.exit(1);
}

{
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!STORAGE_ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!STORAGE_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Run with:  node --env-file=.env.local scripts/fix-orientation.mjs");
    process.exit(1);
  }
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PROBE_BYTES = 256 * 1024;
const CONCURRENCY = 4;
const PAGE = 1000;

function storageUrl(path) {
  const clean = String(path).replace(/^\/+/, "");
  return `https://${STORAGE_HOST}/${STORAGE_ZONE}/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

/** The size and EXIF orientation from the start of the file, or why not. */
async function probe(path) {
  const controller = new AbortController();
  try {
    const res = await fetch(storageUrl(path), {
      headers: { AccessKey: STORAGE_KEY, Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 206) return { error: `HTTP ${res.status}` };
    const chunks = [];
    let total = 0;
    const reader = res.body.getReader();
    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    controller.abort();
    const { width, height, orientation } = imageSize(Buffer.concat(chunks));
    if (!width || !height) return { error: "no size in the header" };
    return { width, height, orientation: orientation ?? 1 };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function loadPhotos() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    // ONE string literal for the select: supabase-js parses it at the type level.
    let q = db
      .from("photos")
      .select("id, storage_path, width, height, variants, galleries!inner(slug)")
      .or("storage_path.ilike.%.jpg,storage_path.ilike.%.jpeg")
      .not("width", "is", null)
      .not("height", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (GALLERY) q = q.eq("galleries.slug", GALLERY);
    const { data, error } = await q;
    if (error) throw new Error(`Supabase: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  // Never the ladder's own output.
  return rows.filter((r) => !/^(d|clients\/_d)\//i.test(r.storage_path));
}

function slugOf(row) {
  const g = Array.isArray(row.galleries) ? row.galleries[0] : row.galleries;
  return g?.slug ?? "?";
}

async function main() {
  console.log(`\nUpright phone photos, ${APPLY ? "FIXING" : "looking only (add --apply to fix)"}`);
  console.log(`Zone ${STORAGE_ZONE} @ ${STORAGE_HOST}${GALLERY ? `, gallery ${GALLERY}` : ""}\n`);

  const photos = await loadPhotos();
  console.log(`${photos.length} JPEG photo(s) with a recorded size\n`);

  const sideways = [];
  const unreadable = [];
  let checked = 0;

  await pool(photos, CONCURRENCY, async (p) => {
    const info = await probe(p.storage_path);
    checked++;
    if (checked % 50 === 0) process.stdout.write(`\r  ${checked}/${photos.length} read`);
    if (info.error) {
      unreadable.push({ p, why: info.error });
      return;
    }
    // 5 to 8 are the quarter turns: stored width and height swap places.
    if (info.orientation < 5) return;
    const uprightW = info.height;
    const uprightH = info.width;
    if (p.width === uprightW && p.height === uprightH) return; // already right
    if (p.width !== info.width || p.height !== info.height) return; // some other size: leave it
    sideways.push({ p, uprightW, uprightH });
  });
  if (photos.length >= 50) process.stdout.write("\n");

  sideways.sort((a, b) => a.p.storage_path.localeCompare(b.p.storage_path, "en", { numeric: true }));
  for (const { p, uprightW, uprightH } of sideways) {
    console.log(`  ${slugOf(p).padEnd(24)} ${p.storage_path}  ${p.width}x${p.height} -> ${uprightW}x${uprightH}`);
  }

  let fixed = 0;
  if (APPLY) {
    for (const { p, uprightW, uprightH } of sideways) {
      // Only if the row still says what we read a moment ago.
      const { data, error } = await db
        .from("photos")
        .update({ width: uprightW, height: uprightH })
        .eq("id", p.id)
        .eq("width", p.width)
        .eq("height", p.height)
        .select("id");
      if (error) console.error(`  ! ${p.storage_path}: ${error.message}`);
      else fixed += data?.length ?? 0;
    }
  }

  // Rungs promised wider than the upright photo: fine to look at, labelled too big.
  const relabel = sideways.filter(({ p, uprightW }) =>
    (Array.isArray(p.variants) ? p.variants : []).some((v) => typeof v?.w === "number" && v.w > uprightW),
  );

  console.log(
    `\n${sideways.length} sideways` +
      (APPLY ? `, ${fixed} fixed` : "") +
      `, ${photos.length - sideways.length - unreadable.length} already right` +
      (unreadable.length ? `, ${unreadable.length} unreadable` : "") +
      ".",
  );
  for (const { p, why } of unreadable.slice(0, 10)) console.log(`  could not read ${p.storage_path}: ${why}`);

  if (relabel.length) {
    const galleries = [...new Set(relabel.map(({ p }) => slugOf(p)))];
    console.log(
      `\n${relabel.length} of them ${relabel.length === 1 ? "was" : "were"} built with a size wider than the photo. To rebuild:`,
    );
    for (const g of galleries) {
      console.log(`  node --env-file=.env.local scripts/build-ladder.mjs --force --gallery ${g}`);
    }
  }

  if (!APPLY && sideways.length) console.log("\nNothing changed. Run again with --apply to fix them.\n");
  else if (APPLY && fixed) {
    console.log("\nRefresh the site so album pages use the new sizes:");
    console.log("  POST /api/sync?only=revalidate  (see claude/adding-photos.md)\n");
  } else console.log("");
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
