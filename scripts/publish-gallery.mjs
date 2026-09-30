// Promote a client's approved photographs into a public album, and clear out
// the rest.
//
//   node --env-file=.env.local scripts/publish-gallery.mjs sara-grad --to "Sara Graduation"
//   node --env-file=.env.local scripts/publish-gallery.mjs sara-grad --to "Sara Graduation" --copy
//   node --env-file=.env.local scripts/publish-gallery.mjs sara-grad --purge --verify-local "D:\Shoots\Sara\JPG" --yes
//
// TWO SEPARATE JOBS, AND THEY MUST STAY SEPARATE. Copying the approved frames
// into a public folder is reversible — delete the folder and start again.
// Purging the rest is not: it removes the ONLY copy from the storage zone.
// One command doing both is one typo away from a shoot that no longer exists,
// so --copy and --purge never run together and --purge asks for --yes.
//
// WHAT THIS SCRIPT DOES NOT DO, because the repo already does it better:
//
//   reseed.ts             creates the album gallery row from the new folder
//   build-ladder.mjs      builds the derivatives at the album path
//   /api/sync             refreshes rows and busts the caches
//
// It fills the two gaps those leave: Bunny Edge Storage has NO server-side
// copy or move, so promoting a file means reading it and writing it back
// somewhere else; and nothing anywhere deletes an original.
//
// WHY THE FILES HAVE TO MOVE AT ALL, rather than the gallery flipping a flag:
//
//   1. The public pull zone blocks any URL containing /clients/ at the edge.
//      A file under clients/ cannot be served publicly, by design.
//   2. The derivative ladder's root is keyed on gallery kind —
//      clients/_d/{gallery}/… against d/{gallery}/… — so a promoted photograph
//      needs its ladder rebuilt wherever it lands.
//   3. portfolio-exclude.json's ALWAYS_EXCLUDED holds "clients", so nothing
//      under it reaches the portfolio however the row is configured.
//
// A NOTE ON WHAT "KEEP" MEANS. The client's own buttons say:
//
//   Publish  →  "Marked as OK to publish"     consent
//   Keep     →  "Marked to keep"              not consent — it means
//                                             "this one stays in MY gallery"
//
// So --keep publish is the default. `--keep keep,publish` publishes
// photographs the client did not say could be published; the script will do it
// and will say so every time.

import process from "node:process";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Environment

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
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
    console.error(`\n  Missing environment variables: ${missing.join(", ")}`);
    console.error("  Run with:  node --env-file=.env.local scripts/publish-gallery.mjs ...\n");
    process.exit(1);
  }
}

// Flags

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f) => {
  const i = argv.indexOf(`--${f}`);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};

// Positional = the first token that is neither a flag nor a flag's value.
// Spelled out rather than "the first thing without a --", because
// `--to "Sara Graduation"` would otherwise make the album name the slug.
const TAKES_VALUE = new Set(["--to", "--keep", "--verify-local"]);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    if (TAKES_VALUE.has(argv[i])) i++;
    continue;
  }
  positional.push(argv[i]);
}
const slug = positional[0] ?? null;
const target = val("to");
const keepModes = new Set((val("keep") ?? "publish").split(",").map((s) => s.trim()));
const doCopy = has("copy");
const doPurge = has("purge");
const yes = has("yes");
const force = has("force");
const verifyLocal = val("verify-local");
const includeDeleteMarked = !has("spare-delete-marked");

const die = (...lines) => {
  console.error("");
  for (const l of lines) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
};

if (!slug) {
  die(
    "Usage:  node --env-file=.env.local scripts/publish-gallery.mjs <client-slug> [--to \"Album Folder\"]",
    "",
    "  (no flags)   look: what would be copied, what would be purged",
    "  --copy       copy the approved originals into the album folder",
    "  --purge      delete everything else from the storage zone. Irreversible.",
  );
}
if (doCopy && doPurge) {
  die(
    "--copy and --purge do not run together.",
    "",
    "Copy first, then reseed, then build the ladder, then LOOK at the album on the",
    "site. Purge only once you are sure the public copies are good — after it,",
    "the originals are gone and the album is all there is.",
  );
}
if (doCopy && !target) die('--copy needs a destination:  --to "Sara Graduation"');

// Bunny

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const storageUrl = (p) =>
  `https://${STORAGE_HOST}/${STORAGE_ZONE}/${p.split("/").map(encodeURIComponent).join("/")}`;

const TIMEOUT = 120_000;

async function getObject(p) {
  const res = await fetch(storageUrl(p), {
    headers: { AccessKey: STORAGE_KEY },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function putObject(p, body) {
  const res = await fetch(storageUrl(p), {
    method: "PUT",
    headers: { AccessKey: STORAGE_KEY, "Content-Type": "application/octet-stream" },
    body,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`PUT ${p} → ${res.status} ${res.statusText}`);
}

async function deleteObject(p) {
  const res = await fetch(storageUrl(p), {
    method: "DELETE",
    headers: { AccessKey: STORAGE_KEY },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  // 404 is success for our purposes — the thing is not there, which is the goal.
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${p} → ${res.status} ${res.statusText}`);
}

/** Directory listing. [] for a directory that does not exist. */
async function listDir(dir) {
  const clean = dir.replace(/^\/+|\/+$/g, "");
  const res = await fetch(`https://${STORAGE_HOST}/${STORAGE_ZONE}/${clean}/`, {
    headers: { AccessKey: STORAGE_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`LIST ${clean} → ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Every file under a prefix, walked. Bunny's DELETE on a directory is not
 * something to bet a client's photographs on, so derivative trees are removed
 * leaf by leaf and the result is checked.
 */
async function walk(prefix) {
  const out = [];
  const stack = [prefix.replace(/^\/+|\/+$/g, "")];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await listDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = `${dir}/${e.ObjectName}`;
      if (e.IsDirectory) stack.push(p);
      else out.push({ path: p, bytes: e.Length ?? 0 });
    }
  }
  return out;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const gb = (bytes) =>
  bytes > 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` : mb(bytes);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Load the gallery

const { data: gallery, error: gErr } = await db
  .from("galleries")
  .select("id, slug, title, kind, bunny_folder, visibility, is_published")
  .eq("slug", slug)
  .maybeSingle();

if (gErr) die(`Supabase: ${gErr.message}`);
if (!gallery) die(`No gallery with slug "${slug}".`);
if (gallery.kind !== "client") {
  die(
    `"${slug}" is kind='${gallery.kind}', not a client gallery.`,
    "This script promotes a private delivery into a public album; there is",
    "nothing to promote an album into.",
  );
}
if (!gallery.bunny_folder) {
  die(`"${slug}" has no bunny_folder, so there is no folder to read from.`);
}

const sourceFolder = gallery.bunny_folder.replace(/^\/+|\/+$/g, "");

const { data: photos, error: pErr } = await db
  .from("photos")
  .select("id, file_name, storage_path, client_mark, checksum8, ladder_rev, source_bytes, status")
  .eq("gallery_id", gallery.id)
  .order("sort_order", { ascending: true });

if (pErr) {
  if (/client_mark/.test(pErr.message)) {
    die(
      "The photos table has no client_mark column, so no selection exists.",
      "",
      "Apply supabase/migrations/20260916120000_client_photo_marks.sql first.",
    );
  }
  die(`Supabase: ${pErr.message}`);
}

const rows = photos ?? [];
if (rows.length === 0) die(`"${slug}" has no photographs.`);

const counts = { keep: 0, publish: 0, delete: 0, unmarked: 0 };
for (const r of rows) counts[r.client_mark ?? "unmarked"]++;

/**
 * TWO DIFFERENT SETS, and conflating them is how a client loses a photograph
 * they asked to keep.
 *
 *   approved — what gets copied into the public album. --keep decides.
 *   doomed   — what gets deleted from the storage zone. --keep does NOT.
 *
 * A `keep` mark means "this one stays in my gallery". Whether it is also
 * published is Marshall's decision and the reason --keep exists; whether it
 * survives at all is not a decision anyone gets to make, because the client
 * already made it. So keep and publish are NEVER purged, whatever --keep says.
 * Only the unmarked go, and the delete-marked, which the client asked for.
 */
const approved = rows.filter((r) => keepModes.has(r.client_mark ?? "unmarked"));
const doomed = rows.filter((r) => {
  const m = r.client_mark;
  if (m === "keep" || m === "publish") return false;
  if (m === "delete") return includeDeleteMarked;
  return true; // unmarked
});

// Report

console.log("");
console.log(`  ${gallery.title}`);
console.log(`  clients folder: ${sourceFolder} · ${rows.length} photographs\n`);
const fate = (n, label) => `    ${label.padEnd(9)} ${String(n).padStart(5)}   → `;
console.log(fate(counts.publish, "publish") + (keepModes.has("publish") ? "album, and kept" : "kept, not published"));
console.log(fate(counts.keep, "keep") + (keepModes.has("keep") ? "album, and kept" : "kept, not published"));
console.log(fate(counts.delete, "delete") + (includeDeleteMarked ? "DELETED — the client asked" : "kept (--spare-delete-marked)"));
console.log(fate(counts.unmarked, "unmarked") + "DELETED");
console.log("");
console.log("  keep and publish are never deleted, whatever --keep says: that flag");
console.log("  decides what is PUBLISHED, not what survives.\n");

if (keepModes.has("keep")) {
  console.log("  NOTE: --keep includes `keep`. The client's button for that says");
  console.log('  "Marked to keep", not "Marked as OK to publish" — it means the photograph');
  console.log("  stays in THEIR gallery. Publishing those is your call, not theirs.\n");
}

if (counts.publish + counts.keep + counts.delete === 0) {
  die(
    `Not one photograph in "${slug}" is marked.`,
    "",
    "Either the client has not been through the gallery, or the marks migration",
    "was applied after they did. Purging on this would delete the entire shoot.",
  );
}

if (approved.length === 0) {
  console.log("  Nothing is approved for publication, so there is no album to make.");
  console.log("  Purging is still possible on its own.\n");
}

// What the approved frames cost to copy
const approvedBytes = approved.reduce((n, r) => n + (r.source_bytes ?? 0), 0);
if (approved.length > 0 && target) {
  console.log(`  COPY  ${plural(approved.length, "file", "files")}${approvedBytes ? `, ${gb(approvedBytes)}` : ""}`);
  console.log(`        ${sourceFolder}/  →  ${target.replace(/^\/+|\/+$/g, "")}/`);
  console.log("        Down to this machine and back up — Bunny has no server-side copy.\n");
}

// Purge

if (doomed.length > 0) {
  const doomedBytes = doomed.reduce((n, r) => n + (r.source_bytes ?? 0), 0);
  console.log(`  PURGE ${plural(doomed.length, "photograph", "photographs")}${doomedBytes ? `, ${gb(doomedBytes)}` : ""} of originals`);
  console.log("        plus each one's derivative tree under clients/_d/");
  console.log("        Permanent. The storage zone is not a backup.\n");
}

// Verify a local copy exists before anything is destroyed

let localNames = null;
if (verifyLocal) {
  if (!existsSync(verifyLocal)) die(`--verify-local: no such folder: ${verifyLocal}`);
  const entries = await readdir(verifyLocal, { withFileTypes: true });
  localNames = new Set(
    entries.filter((e) => e.isFile()).map((e) => path.parse(e.name).name.toLowerCase()),
  );
}

function checkLocalBackup() {
  if (!localNames) {
    console.log("  NO LOCAL CHECK. Nothing has confirmed these photographs exist anywhere");
    console.log("  else. If you already emptied the _rejected folder sort-selection.mjs");
    console.log("  made, the storage zone is the last copy and this deletes it.");
    console.log("");
    console.log('  Point at the folder that holds them:  --verify-local "D:\\Shoots\\...\\JPG"');
    console.log("  Or pass --force to say you have them somewhere I cannot see.\n");
    return false;
  }
  const missing = doomed.filter(
    (r) => !localNames.has(path.parse(r.file_name ?? r.storage_path).name.toLowerCase()),
  );
  if (missing.length === 0) {
    console.log(`  ✓ all ${doomed.length} are present in ${verifyLocal}\n`);
    return true;
  }
  console.log(`  ✗ ${plural(missing.length, "file is", "files are")} NOT in ${verifyLocal}:`);
  for (const r of missing.slice(0, 10)) console.log(`      ${r.file_name ?? r.storage_path}`);
  if (missing.length > 10) console.log(`      … and ${missing.length - 10} more`);
  console.log("");
  return false;
}

// Act

if (!doCopy && !doPurge) {
  if (doomed.length > 0 && verifyLocal) checkLocalBackup();
  console.log("  Nothing has been touched. What happens next:\n");
  if (approved.length > 0 && target) {
    console.log(`    1. node --env-file=.env.local scripts/publish-gallery.mjs ${slug} --to "${target}" --copy`);
    console.log("    2. npx tsx scripts/reseed.ts                       # makes the album row");
    console.log(`    3. node --env-file=.env.local scripts/build-ladder.mjs --gallery <new-slug>`);
    console.log("    4. Open the album on the site and look at every frame.");
    console.log("    5. Only then:");
    console.log(`       node --env-file=.env.local scripts/publish-gallery.mjs ${slug} --purge \\`);
    console.log(`            --verify-local "D:\\Shoots\\...\\JPG" --yes`);
  } else if (!target) {
    console.log('    Add --to "Album Folder Name" to see the copy plan.');
  }
  console.log("");
  process.exit(0);
}

if (doCopy) {
  const dest = target.replace(/^\/+|\/+$/g, "");
  if (dest.toLowerCase().startsWith("clients")) {
    die("--to must be a PUBLIC folder. Anything under clients/ is blocked at the edge.");
  }

  // Already there, same size, skip. Makes the whole thing resumable — a
  // 400 MB copy over a Tashkent uplink will be interrupted at some point.
  const existing = new Map(
    (await listDir(dest)).filter((e) => !e.IsDirectory).map((e) => [e.ObjectName, e.Length ?? 0]),
  );

  console.log(`  Copying ${approved.length} → ${dest}/\n`);
  let copied = 0;
  let skipped = 0;
  const failed = [];

  for (const [i, row] of approved.entries()) {
    const name = row.file_name ?? path.posix.basename(row.storage_path);
    const to = `${dest}/${name}`;
    const label = `${String(i + 1).padStart(4)}/${approved.length}  ${name}`;

    if (existing.has(name) && (!row.source_bytes || existing.get(name) === row.source_bytes)) {
      console.log(`${label}  — already there`);
      skipped++;
      continue;
    }
    try {
      const body = await getObject(row.storage_path);
      await putObject(to, body);
      console.log(`${label}  ${mb(body.length)}`);
      copied++;
    } catch (e) {
      console.log(`${label}  FAILED: ${String(e.message ?? e)}`);
      failed.push(name);
    }
  }

  console.log(`\n  ${copied} copied, ${skipped} already there, ${failed.length} failed.`);
  if (failed.length) {
    console.log("  Re-run the same command — anything already uploaded is skipped.\n");
    process.exit(1);
  }
  console.log(`
  Next, in order:

    npx tsx scripts/reseed.ts
        Walks the zone and creates a gallery row for ${dest}/. It takes
        kind='album' automatically because the folder is not under clients/.
        Note the slug it prints.

    node --env-file=.env.local scripts/build-ladder.mjs --gallery <new-slug>
        Builds the derivatives at d/<gallery-id>/…  Until this finishes the
        album renders nothing: the Optimizer is off, so there is no fallback.

    Then open the album and look at it. The purge below is not reversible and
    this is the last moment the originals still exist.
`);
  process.exit(0);
}

// Purge

if (doPurge) {
  if (doomed.length === 0) {
    console.log("  Nothing to purge.\n");
    process.exit(0);
  }

  const backedUp = checkLocalBackup();
  if (!backedUp && !force) {
    die("Refusing to purge — see above. Nothing has been touched.");
  }

  if (!yes) {
    console.log("  Add --yes to go ahead. Nothing has been touched.\n");
    process.exit(0);
  }

  // The manifest is written BEFORE the first delete, so an interrupted purge
  // still leaves a record of exactly what was being removed.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestPath = `purge-${slug}-${stamp}.json`;
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        gallery: { slug: gallery.slug, id: gallery.id, folder: sourceFolder },
        at: new Date().toISOString(),
        keepModes: [...keepModes],
        verifiedAgainst: verifyLocal ?? null,
        photographs: doomed.map((r) => ({
          id: r.id,
          file: r.file_name,
          path: r.storage_path,
          mark: r.client_mark,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`  Manifest written: ${manifestPath}\n`);

  let files = 0;
  let derivs = 0;
  const problems = [];

  for (const [i, row] of doomed.entries()) {
    const label = `${String(i + 1).padStart(4)}/${doomed.length}  ${row.file_name ?? row.storage_path}`;
    try {
      // Derivatives first. A row whose original is gone but whose ladder is not
      // is invisible junk; a row whose ladder is gone but whose original is not
      // is recoverable. Fail in the recoverable direction.
      const tree = `clients/_d/${gallery.id}/${row.id}`;
      for (const f of await walk(tree)) {
        await deleteObject(f.path);
        derivs++;
      }
      await deleteObject(row.storage_path);
      files++;
      console.log(`${label}  gone`);
    } catch (e) {
      console.log(`${label}  FAILED: ${String(e.message ?? e)}`);
      problems.push(row.id);
    }
  }

  // Rows last, and only for the ones whose files actually went. A row left
  // behind shows a broken image, which is visible and fixable; a row deleted
  // for a file still sitting in the zone is an orphan nothing will ever find.
  const clearable = doomed.filter((r) => !problems.includes(r.id)).map((r) => r.id);
  if (clearable.length > 0) {
    const { error } = await db.from("photos").delete().in("id", clearable);
    if (error) console.log(`\n  Rows NOT deleted: ${error.message}`);
  }

  console.log(`
  ${files} originals and ${derivs} derivative files deleted.
  ${clearable.length} rows removed — they are out of the client's gallery now.
${problems.length ? `  ${problems.length} failed; their rows were left in place. Re-run to retry.\n` : ""}
  The client's own gallery page is already correct: /galleries/[slug] is
  force-dynamic and getClientGallery() is not cached, so their next reload
  shows the shorter set.

  The picker tile's photo count is cached for an hour under the
  "client-galleries" tag. If you want it now:

    node --env-file=.env.local scripts/portfolio-exclude.mjs --refresh

  which calls /api/sync?only=revalidate and drops both tags.
`);
  process.exit(problems.length ? 1 : 0);
}
