// Every photograph's STORAGE PATH, grouped by folder — the list you copy from
// when filling in `coverPath`, `hero.groundPath` or `galleryPaths` in
// src/lib/services.ts.
//
//   node --env-file=.env.local scripts/list-photos.mjs
//   node --env-file=.env.local scripts/list-photos.mjs --folder Portraits
//   node --env-file=.env.local scripts/list-photos.mjs --folder WIUT --ready
//   node --env-file=.env.local scripts/list-photos.mjs --quote
//
// Read-only: one Supabase query, no Bunny calls, no writes. Safe to run at any
// time, including while build-ladder.mjs is working.
//
// --ready   only photographs whose derivative ladder is built. A path with no
//           ladder still WORKS on a service page, but the rail and the hero
//           render nothing for it rather than falling back to the original —
//           the pull zone's Optimizer is off, so that fallback would be a
//           full-size PNG. If a path you want is not listed under --ready, run
//           build-ladder.mjs before putting it on a page.
// --quote   prints each path as 'Folder/file.png', ready to paste straight
//           into a galleryPaths array.
//
// Client galleries are excluded. Those photographs live behind a passkey and
// putting one on a public service page would hand it out.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing env. Run with:\n" +
      "  node --env-file=.env.local scripts/list-photos.mjs",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const ONLY = value("--folder");
const READY_ONLY = flag("--ready");
const QUOTE = flag("--quote");

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// `galleries!inner(kind)` filters to album photographs in the query rather than
// after it, so a large client gallery never crosses the wire.
let q = db
  .from("photos")
  .select("storage_path, variants, sort_order, galleries!inner(kind)")
  .eq("galleries.kind", "album")
  .order("storage_path", { ascending: true });

if (ONLY) q = q.like("storage_path", `${ONLY}/%`);

const { data, error } = await q;

if (error) {
  console.error(`Supabase: ${error.message}`);
  process.exit(1);
}

/** Built derivatives? `variants` is jsonb and arrives untyped. */
const isReady = (row) => Array.isArray(row.variants) && row.variants.length > 0;

const byFolder = new Map();
let skipped = 0;

for (const row of data ?? []) {
  if (READY_ONLY && !isReady(row)) {
    skipped++;
    continue;
  }
  const path = row.storage_path;
  const slash = path.indexOf("/");
  // A file at the zone root has no folder. It is still a usable path, so it is
  // listed rather than dropped.
  const folder = slash === -1 ? "(root)" : path.slice(0, slash);
  if (!byFolder.has(folder)) byFolder.set(folder, []);
  byFolder.get(folder).push({ path, ready: isReady(row) });
}

const folders = [...byFolder.keys()].sort();

if (folders.length === 0) {
  console.log(
    ONLY
      ? `\nNothing under "${ONLY}/". Check the folder name — they are case-sensitive.\n`
      : "\nNo album photographs found. Has reseed.ts run?\n",
  );
  process.exit(0);
}

let total = 0;
for (const folder of folders) {
  const rows = byFolder.get(folder);
  total += rows.length;
  console.log(`\n${folder}/  (${rows.length})`);
  for (const { path, ready } of rows) {
    // The marker is the only thing that separates "you can put this on a page
    // today" from "this needs build-ladder first".
    const mark = READY_ONLY || ready ? "  " : "! ";
    console.log(`  ${mark}${QUOTE ? `'${path}',` : path}`);
  }
}

console.log(`\n${total} photograph(s) in ${folders.length} folder(s).`);
if (!READY_ONLY) {
  const unbuilt = [...byFolder.values()].flat().filter((r) => !r.ready).length;
  if (unbuilt > 0) {
    console.log(
      `${unbuilt} marked "!" have no derivative ladder yet — usable as a path,\n` +
        `but they render nothing until build-ladder.mjs has run over them.`,
    );
  }
}
console.log(
  "\nPaste into src/lib/services.ts — coverPath (the header image),\n" +
    "hero.groundPath (the graduation backdrop) or galleryPaths (My best picks).\n",
);
