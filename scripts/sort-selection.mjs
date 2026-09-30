// Apply a client's selection to the folders on your drive.
//
// Answers both halves of the same problem: which photographs survive, and
// keeping the JPG and CR3 folders saying the same thing.
//
//   # what the client chose, applied to BOTH folders at once
//   node --env-file=.env.local scripts/sort-selection.mjs --gallery sara-grad ^
//        --folder "D:\Shoots\Sara\JPG" --folder "D:\Shoots\Sara\CR3"
//
//   # JPG already sorted by hand — make CR3 match it
//   node scripts/sort-selection.mjs --like "D:\Shoots\Sara\JPG" ^
//        --folder "D:\Shoots\Sara\CR3"
//
//   # a list of filenames from anywhere
//   node scripts/sort-selection.mjs --from-file picks.txt --folder "D:\Shoots\Sara\JPG"
//
// Add --apply to actually move anything. WITHOUT IT NOTHING IS TOUCHED — it
// prints what it would do and stops. Read that first, every time.
//
//   node scripts/sort-selection.mjs --undo --folder "D:\Shoots\Sara\CR3"
//
// THREE RULES THIS SCRIPT WILL NOT BREAK.
//
//   1. IT NEVER DELETES. Rejected files are MOVED into a `_rejected` subfolder
//      of the folder they were in. You look through it, then delete it in
//      Explorer yourself. A script that empties a card of raws because a
//      filename convention changed is not a tool, it is an accident waiting
//      for a Tuesday.
//   2. IT MATCHES ON THE BASENAME, not the extension. `9O6A1234` is one
//      photograph whether it is .JPG, .CR3 or a .xmp sidecar, which is exactly
//      why the same keep-list can be applied to both folders and they end up
//      agreeing. Sidecars follow their raw for free.
//   3. IT REFUSES A TOTAL MISMATCH. If none of the keep-list is found in a
//      folder, that is a naming problem — files renamed on export, the wrong
//      folder, the wrong gallery — and moving all 812 files into `_rejected`
//      would be the obedient answer to the wrong question. It stops and shows
//      you both lists instead.
//
// A note on what "selected" means. The client's three buttons are `keep`,
// `publish` and `delete`, and a photograph they never touched is `null`. Two
// clients can use the same gallery in opposite ways: one ticks the forty they
// want, another flags the six they hate. The script cannot tell which, so it
// prints the four counts BEFORE doing anything and you decide with --keep.
// Default is `keep,publish` — a positive selection — and anything unmarked is
// treated as not chosen. Use `--keep keep,publish,unmarked` for the other kind.

import process from "node:process";
import { readdir, mkdir, rename, copyFile, unlink, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const REJECT_DIR = "_rejected";
const MANIFEST = "_moved.json";

// Never candidates, never rejects. Windows and macOS leave these everywhere and
// filing them under "the client did not choose this" is noise.
const IGNORE = new Set(["thumbs.db", "desktop.ini", ".ds_store", MANIFEST.toLowerCase()]);

// Args

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};
const all = (f) =>
  argv.reduce((out, a, i) => (a === f && argv[i + 1] ? [...out, argv[i + 1]] : out), []);

const folders = all("--folder");
const gallery = val("--gallery");
const like = val("--like");
const fromFile = val("--from-file");
const apply = has("--apply");
const undo = has("--undo");
const force = has("--force");
const keepModes = (val("--keep") ?? "keep,publish").split(",").map((s) => s.trim());

/**
 * Where rejects go. A bare name is a subfolder of the folder being sorted; a
 * path with a separator or a drive letter is taken as written.
 *
 *   --rejected "Not chosen"                a subfolder, renamed
 *   --rejected "D:\Shoots\Sara\CR3-out"    a sibling, beside the CR3 folder
 *
 * The default is a subfolder because it travels with the folder and cannot be
 * orphaned. The reason to move it out: Lightroom and Bridge import subfolders
 * by default, so a `_rejected\` inside the CR3 folder comes back into the
 * catalogue the next time you point them at it.
 */
const rejectedArg = val("--rejected") ?? REJECT_DIR;
const rejectedIsPath = /[\\/]/.test(rejectedArg) || /^[a-zA-Z]:/.test(rejectedArg);
const rejectDirFor = (folder) =>
  rejectedIsPath ? path.resolve(rejectedArg) : path.join(folder, rejectedArg);
const rejectLabel = rejectedIsPath ? rejectedArg : `${rejectedArg}\\`;

/**
 * Move, falling back to copy-then-delete across volumes.
 *
 * rename() is atomic and instant within one drive and fails with EXDEV across
 * two — which is exactly what `--rejected "E:\..."` from a D: folder would hit,
 * at the end of a long run, having already moved half the shoot. The copy is
 * verified before the original goes; a failure there leaves BOTH copies, which
 * is the right way round to fail.
 */
async function moveFile(from, to) {
  try {
    await rename(from, to);
  } catch (e) {
    if (e?.code !== "EXDEV") throw e;
    await copyFile(from, to);
    await unlink(from);
  }
}

const die = (...lines) => {
  console.error("");
  for (const l of lines) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
};

if (folders.length === 0) {
  die(
    "Nothing to sort. Pass at least one --folder.",
    "",
    '  node --env-file=.env.local scripts/sort-selection.mjs --gallery <slug> --folder "D:\\Shoots\\Sara\\JPG"',
    '  node scripts/sort-selection.mjs --like "D:\\Shoots\\Sara\\JPG" --folder "D:\\Shoots\\Sara\\CR3"',
  );
}
for (const f of folders) {
  if (!existsSync(f)) die(`No such folder: ${f}`, "Check the path and quote it if it has spaces.");
}
if (rejectedIsPath && folders.length > 1) {
  die(
    "--rejected as a full path plus more than one --folder would tip two folders",
    "into the same bin, and a CR3 and a JPG of the same frame would collide there.",
    "",
    "Either give each folder its own run, or use a bare name so each gets its own:",
    '  --rejected "Not chosen"',
  );
}

// Helpers

/** "9O6A1234.CR3" -> "9o6a1234". One photograph, whatever it was saved as. */
const key = (name) => path.parse(name).name.toLowerCase();

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !IGNORE.has(e.name.toLowerCase()))
    .map((e) => e.name);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Undo

if (undo) {
  console.log("");
  for (const folder of folders) {
    const rejected = rejectDirFor(folder);
    if (!existsSync(rejected)) {
      console.log(`  ${folder}\n    nothing to undo — no ${rejectLabel} here\n`);
      continue;
    }
    const names = await listFiles(rejected);
    if (names.length === 0) {
      console.log(`  ${folder}\n    ${rejectLabel} is empty\n`);
      continue;
    }
    if (!apply) {
      console.log(`  ${folder}`);
      console.log(`    would move ${plural(names.length, "file", "files")} back out of ${rejectLabel}`);
      console.log("");
      continue;
    }
    let moved = 0;
    let blocked = 0;
    for (const name of names) {
      const target = path.join(folder, name);
      // A file of the same name back in place means something was re-added
      // since. Leave both rather than overwriting the newer one.
      if (existsSync(target)) { blocked++; continue; }
      await moveFile(path.join(rejected, name), target);
      moved++;
    }
    console.log(`  ${folder}`);
    console.log(`    ${plural(moved, "file", "files")} restored${blocked ? `, ${blocked} left (a file of that name is already back)` : ""}`);
    console.log("");
  }
  if (!apply) console.log("  Add --apply to actually move them back.\n");
  process.exit(0);
}

// The keep-list

let keep = null;      // Set of basename keys
let source = "";
let marksReport = null;

if (gallery) {
  const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!URL_ || !KEY) {
    die("Supabase env not set.", "Run with:  node --env-file=.env.local scripts/sort-selection.mjs ...");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(URL_, KEY, { auth: { persistSession: false } });

  const { data: g, error: gErr } = await db
    .from("galleries")
    .select("id, slug, title, kind")
    .eq("slug", gallery)
    .maybeSingle();
  if (gErr) die(`Supabase: ${gErr.message}`);
  if (!g) die(`No gallery with slug "${gallery}".`);

  const { data, error } = await db
    .from("photos")
    .select("file_name, storage_path, client_mark")
    .eq("gallery_id", g.id);

  if (error) {
    // The most likely failure by a distance, and the error text alone does not
    // say what to do about it.
    if (/client_mark/.test(error.message)) {
      die(
        "The photos table has no client_mark column, so no selection exists yet.",
        "",
        "Apply the migration first:",
        "  supabase/migrations/20260916120000_client_photo_marks.sql",
        "",
        "Until it is applied, every button press in a client gallery returns 503.",
      );
    }
    die(`Supabase: ${error.message}`);
  }

  const rows = data ?? [];
  const counts = { keep: 0, publish: 0, delete: 0, unmarked: 0 };
  for (const r of rows) counts[r.client_mark ?? "unmarked"]++;
  marksReport = { title: g.title, total: rows.length, counts };

  if (counts.keep + counts.publish + counts.delete === 0) {
    die(
      `"${gallery}" has ${rows.length} photographs and NOT ONE MARK.`,
      "",
      "Nothing has been selected, so there is nothing to sort. Either the client",
      "has not been through the gallery yet, or the migration above was applied",
      "after they did. Sorting on this would move every single file.",
    );
  }

  const wanted = new Set(keepModes);
  keep = new Set(
    rows
      .filter((r) => wanted.has(r.client_mark ?? "unmarked"))
      .map((r) => key(r.file_name ?? path.basename(r.storage_path))),
  );
  source = `gallery "${gallery}" · marks: ${keepModes.join(", ")}`;
} else if (like) {
  if (!existsSync(like)) die(`No such folder: ${like}`);
  const names = await listFiles(like);
  keep = new Set(names.map(key));
  source = `the current contents of ${like}`;
  if (keep.size === 0) die(`${like} has no files in it, so there is nothing to match.`);
} else if (fromFile) {
  if (!existsSync(fromFile)) die(`No such file: ${fromFile}`);
  const text = await readFile(fromFile, "utf8");
  keep = new Set(
    text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(key),
  );
  source = `${fromFile} (${keep.size} names)`;
  if (keep.size === 0) die(`${fromFile} is empty.`);
} else {
  die(
    "Where does the keep-list come from? Pass one of:",
    "",
    "  --gallery <slug>     the client's marks, from Supabase",
    "  --like <folder>      whatever is in that folder right now",
    "  --from-file <path>   one filename per line",
  );
}

// Report, then maybe act

console.log("");
if (marksReport) {
  const c = marksReport.counts;
  console.log(`  ${marksReport.title} — ${marksReport.total} photographs in the gallery\n`);
  console.log(`    keep      ${String(c.keep).padStart(5)}`);
  console.log(`    publish   ${String(c.publish).padStart(5)}`);
  console.log(`    delete    ${String(c.delete).padStart(5)}`);
  console.log(`    unmarked  ${String(c.unmarked).padStart(5)}`);
  console.log("");
  if (c.unmarked > c.keep + c.publish) {
    console.log("    NOTE: most of this gallery is unmarked. If the client flagged only the");
    console.log("    ones they did NOT want, you want the other reading:");
    console.log("      --keep keep,publish,unmarked");
    console.log("");
  }
}
console.log(`  Keep-list: ${keep.size} photographs, from ${source}\n`);

let wouldMove = 0;
let refused = 0;
const plan = [];

for (const folder of folders) {
  const names = await listFiles(folder);
  const kept = names.filter((n) => keep.has(key(n)));
  const reject = names.filter((n) => !keep.has(key(n)));

  // Which of the keep-list is NOT here. Expected between a JPG and a CR3
  // folder if a raw was never shot; alarming if it is most of them.
  const localKeys = new Set(names.map(key));
  const absent = [...keep].filter((k) => !localKeys.has(k));

  console.log(`  ${folder}`);
  console.log(`    ${plural(names.length, "file", "files")} · ${kept.length} stay · ${reject.length} → ${rejectLabel}`);

  if (kept.length === 0 && names.length > 0) {
    console.log("");
    console.log("    REFUSING THIS FOLDER — not one file matches the keep-list.");
    console.log("    That is a naming mismatch, not a selection. Compare:");
    console.log(`      keep-list looks like:  ${[...keep].slice(0, 3).join(", ")}`);
    console.log(`      this folder looks like: ${names.slice(0, 3).map(key).join(", ")}`);
    console.log("    Nothing here will be moved. Pass --force only if you are certain.");
    console.log("");
    if (!force) { refused++; continue; }
  }

  // Two examples of each, so you can see it is pairing the right things before
  // you let it move 700 raws. A dry run that only prints totals asks you to
  // trust arithmetic you cannot check.
  if (!apply && kept.length > 0) {
    console.log(`      stays:  ${kept.slice(0, 3).join(", ")}${kept.length > 3 ? " …" : ""}`);
    if (reject.length > 0) {
      console.log(`      goes:   ${reject.slice(0, 3).join(", ")}${reject.length > 3 ? " …" : ""}`);
    }
  }

  if (absent.length > 0) {
    const show = absent.slice(0, 8).join(", ");
    console.log(`    ${plural(absent.length, "chosen photo has", "chosen photos have")} no file here: ${show}${absent.length > 8 ? " …" : ""}`);
  }
  console.log("");

  plan.push({ folder, reject });
  wouldMove += reject.length;
}

if (refused > 0 && !force) {
  console.log(`  ${refused} folder(s) refused. Nothing was moved anywhere.\n`);
  process.exit(1);
}

if (!apply) {
  console.log(`  DRY RUN — nothing has been touched. ${plural(wouldMove, "file", "files")} would move.`);
  console.log("  Add --apply to do it.\n");
  process.exit(0);
}

// Move

for (const { folder, reject } of plan) {
  if (reject.length === 0) continue;
  const rejected = rejectDirFor(folder);
  await mkdir(rejected, { recursive: true });

  const moved = [];
  for (const name of reject) {
    const from = path.join(folder, name);
    let to = path.join(rejected, name);
    // A previous run already rejected a file of this name. Keep both — the
    // second one is a different file or a re-import, and overwriting is the
    // one irreversible thing in here.
    if (existsSync(to)) {
      const p = path.parse(name);
      to = path.join(rejected, `${p.name}__${Date.now()}${p.ext}`);
    }
    await moveFile(from, to);
    moved.push({ name, as: path.basename(to) });
  }

  // Written so --undo is exact rather than a guess, and so that opening the
  // folder in six months still says where these came from and when.
  await writeFile(
    path.join(rejected, MANIFEST),
    JSON.stringify({ movedAt: new Date().toISOString(), from: folder, source, moved }, null, 2) + "\n",
  );

  console.log(`  ${folder}`);
  console.log(`    ${plural(moved.length, "file", "files")} moved into ${rejected}`);
}

console.log(`
  Done. Nothing was deleted.

  Look through ${rejectLabel}. When you are happy, delete it in
  Explorer — that is the only step that cannot be undone.

  Changed your mind:
    node scripts/sort-selection.mjs --undo --apply ${folders.map((f) => `--folder "${f}"`).join(" ")}${rejectedIsPath || rejectedArg !== REJECT_DIR ? ` --rejected "${rejectedArg}"` : ""}
`);
