// Read-only. Answers two questions in about ten requests: did the rebuild
// write the new /v{rev}/ files, and is the prune removing the old un-versioned
// ones?
//
//   node --env-file=.env.local scripts/ladder-status.mjs
//   node --env-file=.env.local scripts/ladder-status.mjs --sample 10
//
// HEAD requests only, so it's safe to run while build-ladder.mjs is working.
// Run it twice a minute apart: a falling "old layout still present" means the
// prune is alive and progressing.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const ZONE = process.env.BUNNY_STORAGE_ZONE;
const KEY = process.env.BUNNY_STORAGE_API_KEY;
const HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

if (!SUPABASE_URL || !SERVICE_KEY || !ZONE || !KEY) {
  console.error("Missing env. Run with: node --env-file=.env.local scripts/ladder-status.mjs");
  process.exit(1);
}

const argv = process.argv.slice(2);
const i = argv.indexOf("--sample");
const SAMPLE = i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : 6;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** HEAD is enough to know whether an object exists, and transfers no bytes. */
async function exists(path) {
  try {
    const res = await fetch(`https://${HOST}/${ZONE}/${path}`, {
      method: "HEAD",
      headers: { AccessKey: KEY },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return null; // network problem — reported separately from "absent"
  }
}

const { data, error } = await db
  .from("photos")
  .select("id, gallery_id, checksum8, ladder_rev, variants, storage_path, galleries!inner(kind)")
  .not("checksum8", "is", null)
  .limit(SAMPLE);

if (error) {
  console.error(`Supabase: ${error.message}`);
  process.exit(1);
}

const rows = data ?? [];
console.log(`\nChecking ${rows.length} photo(s) against ${ZONE}\n`);

let newPresent = 0;
let oldPresent = 0;
let unreachable = 0;

for (const p of rows) {
  const rel = p.galleries;
  const kind = Array.isArray(rel) ? rel[0]?.kind : rel?.kind;
  const root = kind === "client" ? "clients/_d" : "d";
  const stem = `${root}/${p.gallery_id}/${p.id}/${p.checksum8}`;

  // Narrowest rung — always built, and the cheapest thing to ask about.
  const w = (Array.isArray(p.variants) ? p.variants : []).map((v) => v.w).sort((a, b) => a - b)[0];
  if (!w) continue;

  const [isNew, isOld] = await Promise.all([
    exists(`${stem}/v${p.ladder_rev ?? 1}/${w}.avif`),
    exists(`${stem}/${w}.avif`),
  ]);

  if (isNew === null || isOld === null) unreachable++;
  if (isNew) newPresent++;
  if (isOld) oldPresent++;

  const name = p.storage_path.split("/").pop();
  console.log(
    `  ${(isNew ? "new ✓" : "new ✗").padEnd(6)} ${(isOld ? "old STILL THERE" : "old gone").padEnd(16)} ${name}`,
  );
}

console.log(`\n  new layout present : ${newPresent}/${rows.length}`);
console.log(`  old layout present : ${oldPresent}/${rows.length}`);
if (unreachable) console.log(`  unreachable        : ${unreachable} (network, not a verdict)`);

console.log(
  "\n" +
    (newPresent === rows.length && oldPresent === 0
      ? "Clean: rebuild wrote the new paths and the prune has finished this sample.\n"
      : newPresent === rows.length
        ? "Rebuild is good. Prune still has work to do — run this again in a minute\n" +
          "and the old count should be lower.\n"
        : "Some new-layout files are missing. Re-run build-ladder.mjs --retry-failed\n" +
          "(and keep NEXT_PUBLIC_IMAGE_MODE=legacy until they are all there).\n"),
);
