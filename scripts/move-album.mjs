// Move an album's folder in the storage zone, and bring its rows with it.
//
//   node --env-file=.env.local scripts/move-album.mjs <slug> --under Portraits
//   node --env-file=.env.local scripts/move-album.mjs <slug> --under Portraits --apply
//   node --env-file=.env.local scripts/move-album.mjs <slug> --to "Portraits/Sara 2026"
//
// WHAT THIS IS FOR. The Portfolio page's filter chips are the FIRST SEGMENT of
// each photograph's storage path, relabelled through portfolio-exclude.json:
//
//   Portraits/Sara/3M0A1432.png        -> chip "Portraits"
//   Gulasal at WIUT/9O6A1000.jpg       -> chip "Gulasal at WIUT"   ← its own
//
// So an album published to a top-level folder becomes its own category next to
// Portraits instead of sitting inside it. Moving the folder under Portraits/ is
// the fix, and it is also the convention the existing albums already follow —
// Sara, Radmir and Diora are all Portraits/<name>.
//
// The ALBUM TILE is unaffected either way. Tiles come from the `galleries`
// table, chips come from photo paths; they are two different things and an
// album nested under Portraits/ still gets its own tile. That is the intended
// shape, not a side effect.
//
// WHY THE LADDER DOES NOT NEED REBUILDING. Derivatives live at
// d/{gallery_id}/{photo_id}/{checksum8}/v{rev} — keyed on ids, not on the
// storage path. Moving an original changes nothing about where its rendered
// sizes are, so the album keeps displaying throughout and afterwards. Only the
// fallback `src` and the cover, which read storage_path, have to be rewritten.
//
// ORDER, AND WHY IT IS THIS ORDER:
//
//   1. COPY every file to the new prefix.   Both copies exist.
//   2. UPDATE the rows.                     Rows point at files that are there.
//   3. DELETE the old files.                Only now is the old prefix empty.
//
// Interrupt it anywhere and nothing is broken: the rows always point at files
// that exist, and re-running finishes the job. The dangerous order is the
// reverse one, where a failure leaves rows addressing a prefix that is gone.
//
// DO NOT move the folder in Bunny by hand without updating `bunny_folder`.
// reseed.ts matches galleries to folders by that column: it would see an
// unknown new folder and create a SECOND gallery for it, see the old folder
// missing and DELETE the original — taking its photo rows with it, and
// orphaning a ladder keyed on the id those rows carried.

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY;
const STORAGE_HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "").replace(/\/$/, "");

{
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!STORAGE_ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!STORAGE_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (missing.length) {
    console.error(`\n  Missing: ${missing.join(", ")}`);
    console.error("  Run with:  node --env-file=.env.local scripts/move-album.mjs ...\n");
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f) => {
  const i = argv.indexOf(`--${f}`);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};
const TAKES_VALUE = new Set(["--under", "--to", "--slug"]);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { if (TAKES_VALUE.has(argv[i])) i++; continue; }
  positional.push(argv[i]);
}

const slug = positional[0] ?? null;
const under = val("under");
const to = val("to");
const newSlug = val("slug");
const apply = has("apply");

const die = (...lines) => {
  console.error("");
  for (const l of lines) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
};

if (!slug || (!under && !to)) {
  die(
    "Usage:  node --env-file=.env.local scripts/move-album.mjs <slug> --under Portraits",
    "",
    "  --under <parent>   keep the folder's name, put it inside <parent>",
    "  --to <path>        the exact new folder, name and all",
    "  --slug <name>      also rename the gallery, which is its URL",
    "  --apply            actually do it (otherwise it only reports)",
  );
}

/**
 * A flag that swallowed nothing is the quiet failure mode here. `--slug` at the
 * end of the line with its value forgotten would otherwise read as "no rename
 * asked for" and the run would look like it worked.
 */
for (const f of TAKES_VALUE) {
  if (argv.includes(f) && (val(f.slice(2)) ?? "").startsWith("--")) die(`${f} needs a value.`);
  if (argv.includes(f) && val(f.slice(2)) === null) die(`${f} needs a value.`);
}
if (positional.length > 1) {
  die(
    `Did not expect ${positional.slice(1).map((p) => `"${p}"`).join(", ")}.`,
    "One album slug, then flags. Quote anything containing a space.",
  );
}
if (under && to) die("--under and --to both set. Pick one.");

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const trim = (s) => s.replace(/^\/+|\/+$/g, "");
const storageUrl = (p) =>
  `https://${STORAGE_HOST}/${STORAGE_ZONE}/${p.split("/").map(encodeURIComponent).join("/")}`;
const TIMEOUT = 120_000;

async function getObject(p) {
  const res = await fetch(storageUrl(p), { headers: { AccessKey: STORAGE_KEY }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function putObject(p, body) {
  const res = await fetch(storageUrl(p), {
    method: "PUT",
    headers: { AccessKey: STORAGE_KEY, "Content-Type": "application/octet-stream" },
    body, signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`PUT ${p} → ${res.status}`);
}
async function deleteObject(p) {
  const res = await fetch(storageUrl(p), { method: "DELETE", headers: { AccessKey: STORAGE_KEY }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${p} → ${res.status}`);
}
async function listDir(dir) {
  const res = await fetch(`https://${STORAGE_HOST}/${STORAGE_ZONE}/${trim(dir)}/`, {
    headers: { AccessKey: STORAGE_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`LIST ${dir} → ${res.status}`);
  return await res.json();
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// The gallery

const { data: gallery, error: gErr } = await db
  .from("galleries")
  .select("id, slug, title, kind, bunny_folder, cover_path")
  .eq("slug", slug)
  .maybeSingle();

if (gErr) die(`Supabase: ${gErr.message}`);
if (!gallery) die(`No gallery with slug "${slug}".`);
if (gallery.kind !== "album") {
  die(
    `"${slug}" is kind='${gallery.kind}'.`,
    "This moves PUBLIC album folders. A client gallery lives under clients/ and",
    "is blocked at the edge there on purpose — see publish-gallery.mjs instead.",
  );
}
if (!gallery.bunny_folder) die(`"${slug}" has no bunny_folder — nothing to move.`);

/**
 * Renaming the slug is offered here because the usual reason to move an album
 * is that it was published under a name that collided, and reseed.ts resolved
 * that by appending a number. "Mekhrangiz-2" is a URL for ever otherwise.
 *
 * Safe while the album is new: the slug appears in the /albums/<slug> URL, in
 * the sitemap and in the `album:<slug>` cache tag, and nowhere else. The ladder
 * is keyed on the gallery ID, not the slug, so nothing has to be rebuilt.
 * It is NOT safe once you have sent someone the link.
 */
if (newSlug !== null) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(newSlug)) {
    die(`"${newSlug}" is not a usable slug — letters, digits and hyphens only.`);
  }
  if (newSlug.toLowerCase() !== gallery.slug.toLowerCase()) {
    const { data: taken } = await db
      .from("galleries")
      .select("slug, bunny_folder, kind")
      .ilike("slug", newSlug.replace(/([%_\\])/g, "\\$1"));
    if ((taken ?? []).length > 0) {
      const t = taken[0];
      die(
        `Slug "${newSlug}" is taken by the ${t.kind} gallery "${t.slug}" (${t.bunny_folder}).`,
        "Slugs are compared without case, so a different capitalisation is still taken.",
      );
    }
  }
}

const from = trim(gallery.bunny_folder);
const dest = trim(to ?? `${trim(under)}/${from.split("/").pop()}`);

if (dest === from) die(`"${slug}" is already at ${from}.`);
if (dest.toLowerCase().startsWith("clients")) {
  die("Refusing: anything under clients/ is blocked on the public pull zone.");
}
if (`${dest}/`.startsWith(`${from}/`)) {
  die(`Refusing: ${dest} is inside ${from}. A folder cannot be moved into itself.`);
}

// The photographs

const { data: photos, error: pErr } = await db
  .from("photos")
  .select("id, storage_path, file_name")
  .eq("gallery_id", gallery.id)
  .order("sort_order", { ascending: true });

if (pErr) die(`Supabase: ${pErr.message}`);
const rows = photos ?? [];

const strays = rows.filter((r) => !r.storage_path.startsWith(`${from}/`));
const files = await listDir(from);
const loose = files.filter((f) => !f.IsDirectory);
const subdirs = files.filter((f) => f.IsDirectory);

console.log("");
console.log(`  ${gallery.title}  (${slug})`);
console.log(`    ${from}/  →  ${dest}/`);
if (newSlug && newSlug !== gallery.slug) {
  console.log(`    /albums/${gallery.slug}  →  /albums/${newSlug}`);
}
console.log("");
console.log(`    ${plural(rows.length, "photo row", "photo rows")} · ${plural(loose.length, "file", "files")} in the folder · ${mb(loose.reduce((n, f) => n + (f.Length ?? 0), 0))}`);

if (strays.length) {
  die(
    `${strays.length} of the ${rows.length} rows do not live under ${from}/:`,
    ...strays.slice(0, 5).map((r) => `  ${r.storage_path}`),
    "",
    "Moving would leave those pointing at the old prefix. Fix them first.",
  );
}
if (subdirs.length) {
  console.log(`    NOTE: ${plural(subdirs.length, "subfolder", "subfolders")} here (${subdirs.map((d) => d.ObjectName).join(", ")}).`);
  console.log("    They are their own galleries and are NOT moved. Move each one separately.");
}

/**
 * Files already at the destination are one of two completely different things.
 *
 * A RESUMED RUN: the copy got partway through and died — 86 MB over a Tashkent
 * uplink will be interrupted sooner or later — so the destination holds some of
 * this album's own files under this album's own names. Finishing is the only
 * sensible move, and refusing would strand it half-copied with no way forward.
 *
 * A COLLISION: something else is already there. Merging two albums into one
 * folder would leave reseed arguing about which gallery owns it.
 *
 * Told apart by name: every file at the destination must be one of ours.
 */
const sourceNames = new Set(loose.map((f) => f.ObjectName));
const existing = (await listDir(dest)).filter((e) => !e.IsDirectory);
const foreign = existing.filter((e) => !sourceNames.has(e.ObjectName));

if (foreign.length > 0) {
  die(
    `${dest}/ already holds ${plural(foreign.length, "file", "files")} from somewhere else:`,
    ...foreign.slice(0, 5).map((f) => `  ${f.ObjectName}`),
    "",
    "Pick another destination, or clear it first — merging two albums into one",
    "folder would leave reseed arguing about which gallery owns it.",
  );
}

/** Already copied, same size. Skipped rather than re-sent. */
const alreadyThere = new Map(existing.map((e) => [e.ObjectName, e.Length ?? 0]));
if (alreadyThere.size > 0) {
  console.log(`    RESUMING: ${plural(alreadyThere.size, "file is", "files are")} already at the destination from an earlier run.`);
}

console.log("");
console.log("    The ladder is NOT rebuilt: derivatives are keyed on gallery and photo ids,");
console.log("    not on the storage path, so the album keeps rendering throughout.");
console.log("");

if (!apply) {
  console.log(`  DRY RUN — nothing touched. Add --apply.\n`);
  process.exit(0);
}

// 1. copy

console.log("  1. copying\n");
let copied = 0;
let skipped = 0;
for (const [i, f] of loose.entries()) {
  const src = `${from}/${f.ObjectName}`;
  const dst = `${dest}/${f.ObjectName}`;
  const label = `     ${String(i + 1).padStart(4)}/${loose.length}  ${f.ObjectName}`;
  if (alreadyThere.get(f.ObjectName) === (f.Length ?? 0)) {
    console.log(`${label}  — already copied`);
    skipped++;
    continue;
  }
  try {
    await putObject(dst, await getObject(src));
    copied++;
    console.log(label);
  } catch (e) {
    die(`Copy failed on ${f.ObjectName}: ${e.message}`, "Nothing has been deleted. Re-run to continue.");
  }
}

// 2. rows — only once every byte is at the new prefix

console.log(`\n  2. rewriting ${plural(rows.length, "row", "rows")}\n`);
for (const r of rows) {
  const next = `${dest}/${r.storage_path.slice(from.length + 1)}`;
  const { error } = await db.from("photos").update({ storage_path: next }).eq("id", r.id);
  if (error) die(`Row update failed for ${r.storage_path}: ${error.message}`);
}

const patch = { bunny_folder: dest };
if (newSlug && newSlug !== gallery.slug) patch.slug = newSlug;
if (gallery.cover_path?.startsWith(`${from}/`)) {
  patch.cover_path = `${dest}/${gallery.cover_path.slice(from.length + 1)}`;
}
const { error: upErr } = await db.from("galleries").update(patch).eq("id", gallery.id);
if (upErr) die(`Gallery update failed: ${upErr.message}`);
console.log(`     bunny_folder → ${dest}`);
if (patch.cover_path) console.log(`     cover_path   → ${patch.cover_path}`);
if (patch.slug) console.log(`     slug         → ${patch.slug}`);

// 3. delete the originals, last

console.log(`\n  3. removing the old copies\n`);
let removed = 0;
for (const f of loose) {
  try { await deleteObject(`${from}/${f.ObjectName}`); removed++; }
  catch (e) { console.log(`     could not delete ${f.ObjectName}: ${e.message}`); }
}
console.log(`     ${removed}/${loose.length} removed`);

console.log(`
  Done. ${copied} copied${skipped ? `, ${skipped} already there` : ""}, ${rows.length} rows rewritten, ${removed} old files removed.

  The Portfolio chip for this album is now "${dest.split("/")[0]}".
  The album is at /albums/${patch.slug ?? gallery.slug}.

  Drop the caches so the grid rebuilds:

    node --env-file=.env.local scripts/portfolio-exclude.mjs --refresh

  Then reload /portfolio twice — the albums tag is stale-while-revalidate, so
  the first load serves the old grid and builds the new one behind you.

  Do NOT run reseed.ts before that refresh; it is not needed and there is
  nothing for it to fix.
`);
