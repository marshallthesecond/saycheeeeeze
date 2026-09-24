// What the Portfolio shows, and how to change it.
//
//   node --env-file=.env.local scripts/portfolio-exclude.mjs
//   node --env-file=.env.local scripts/portfolio-exclude.mjs hide  Portraits/Shirin/9O6A2207.png
//   node --env-file=.env.local scripts/portfolio-exclude.mjs hide  unreal/
//   node --env-file=.env.local scripts/portfolio-exclude.mjs hide  "Portraits/*"
//   node --env-file=.env.local scripts/portfolio-exclude.mjs show  Portraits/Shirin/9O6A2207.png
//   node --env-file=.env.local scripts/portfolio-exclude.mjs hide-album Portraits
//   node --env-file=.env.local scripts/portfolio-exclude.mjs show-album Portraits
//   node --env-file=.env.local scripts/portfolio-exclude.mjs --pull      (live → local file)
//   node --env-file=.env.local scripts/portfolio-exclude.mjs --push      (local file → live)
//   node --env-file=.env.local scripts/portfolio-exclude.mjs --refresh   (just drop the caches)
//
// THE ONE THING TO KNOW: the manifest the site reads lives at the root of the
// BUNNY STORAGE ZONE. It is not in this repo. A portfolio-exclude.json sitting
// beside the source tree — there is one at C:\Users\lenov\saycheeeeeze\ — is a
// working copy and editing it changes NOTHING. This script reads and writes the
// live one, which is why it exists.
//
// THREE KINDS OF RULE, in excludedPaths:
//
//   unreal/                         a folder, and everything beneath it
//   Portraits/*                     the loose images IN Portraits — its
//                                   subfolders (Sara, Shirin…) are untouched
//   Portraits/Shirin/9O6A2207.png   one file
//
// and separately, hiddenAlbums takes an album's slug or its bunny_folder and
// removes both its tile on /portfolio and its /albums/… page.
//
// WHY THE REPORT MATTERS: the app fails OPEN — an unreachable or malformed
// manifest excludes nothing rather than blanking the portfolio. The price is
// that a typo'd rule also excludes nothing, silently, and looks identical to a
// rule that worked. So this counts, against the real photo table, how many
// photographs each rule actually removes, and flags the ones removing none.
//
// The parsing below is a deliberate second copy of getExcludeManifest() in
// src/lib/bunny.ts. If you change the rule syntax there, change it here — the
// whole value of the report is that it agrees with the app.

import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const ZONE = process.env.BUNNY_STORAGE_ZONE;
const KEY = process.env.BUNNY_STORAGE_API_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

const FILE = "portfolio-exclude.json";
const STORAGE = `https://storage.bunnycdn.com/${ZONE}/${FILE}`;
const ALWAYS_EXCLUDED = ["clients", "d"]; // mirrors src/lib/bunny.ts

if (!ZONE || !KEY) {
  console.error("\n  BUNNY_STORAGE_ZONE / BUNNY_STORAGE_API_KEY not set.");
  console.error("  Run with:  node --env-file=.env.local scripts/portfolio-exclude.mjs\n");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const words = argv.filter((a) => !a.startsWith("--"));
const command = words[0] ?? null;
const target = words.slice(1).join(" ") || null;

const die = (...lines) => {
  console.error("");
  for (const l of lines) console.error(`  ${l}`);
  console.error("");
  process.exit(1);
};

// The live manifest

async function readLive() {
  const res = await fetch(STORAGE, {
    method: "GET",
    headers: { AccessKey: KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return { raw: null, data: {} };
  if (!res.ok) die(`Bunny refused the read: ${res.status} ${res.statusText}`);
  const raw = await res.text();
  try {
    return { raw, data: JSON.parse(raw) };
  } catch (e) {
    // Worth being loud: the app treats unparseable as "exclude nothing", so the
    // portfolio is currently showing everything and nothing says so.
    die(
      "The live manifest is not valid JSON, so the app is currently excluding NOTHING.",
      String(e),
      "Fix it with --push from a good local copy.",
    );
  }
}

async function writeLive(data) {
  const body = JSON.stringify(data, null, 2) + "\n";
  // Validate what we are about to make authoritative, not what we meant to.
  const back = JSON.parse(body);
  if (!Array.isArray(back.excludedPaths)) die("Refusing to upload: excludedPaths is not an array.");
  if (back.excludedPaths.some((p) => typeof p !== "string")) {
    die("Refusing to upload: excludedPaths contains something that is not a string.");
  }

  const res = await fetch(STORAGE, {
    method: "PUT",
    headers: { AccessKey: KEY, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) die(`Bunny refused the upload: ${res.status} ${res.statusText}`);
  console.log(`  ✓  uploaded to the storage zone (${body.length} bytes)`);
}

// Parsing — must agree with getExcludeManifest() in src/lib/bunny.ts

function parse(data) {
  const folders = [...ALWAYS_EXCLUDED];
  const shallow = [];
  const files = [];
  const rules = []; // for the report, in the order they appear

  for (const rawPath of data.excludedPaths ?? []) {
    const clean = String(rawPath).replace(/^\/+/, "");
    if (!clean) continue;
    if (clean === "*") {
      shallow.push("");
      rules.push({ rule: rawPath, kind: "shallow", key: "" });
    } else if (clean.endsWith("/*")) {
      const f = clean.slice(0, -2).replace(/\/+$/, "");
      shallow.push(f);
      rules.push({ rule: rawPath, kind: "shallow", key: f });
    } else if (clean.endsWith("/")) {
      const f = clean.slice(0, -1);
      folders.push(f);
      rules.push({ rule: rawPath, kind: "folder", key: f });
    } else {
      files.push(clean);
      rules.push({ rule: rawPath, kind: "file", key: clean });
    }
  }

  return {
    folders,
    shallow,
    files,
    rules,
    hiddenAlbums: data.hiddenAlbums ?? [],
    categoryLabels: data.categoryLabels ?? {},
    hiddenCategories: data.hiddenCategories ?? [],
  };
}

const folderOf = (p) => (p.lastIndexOf("/") === -1 ? "" : p.slice(0, p.lastIndexOf("/")));
const underFolder = (p, f) => p === f || p.startsWith(`${f}/`);
const albumKey = (s) => String(s).replace(/^\/+|\/+$/g, "").toLowerCase();

const hides = (rule, path) => {
  if (rule.kind === "folder") return underFolder(path, rule.key);
  if (rule.kind === "shallow") return folderOf(path) === rule.key;
  return path === rule.key;
};

const isHidden = (path, m) =>
  m.folders.some((f) => underFolder(path, f)) ||
  m.shallow.includes(folderOf(path)) ||
  m.files.includes(path);

const albumHidden = (album, m) => {
  const hidden = m.hiddenAlbums.map(albumKey);
  const folder = album.bunny_folder ? albumKey(album.bunny_folder) : "";
  if (hidden.includes(albumKey(album.slug))) return "hiddenAlbums";
  if (folder && hidden.includes(folder)) return "hiddenAlbums";
  if (folder && m.folders.some((f) => underFolder(folder, albumKey(f)))) return "folder rule";
  return null;
};

// What the database actually holds

async function loadPhotos() {
  if (!SUPA_URL || !SUPA_KEY) return null;
  const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

  const { data: galleries, error: gErr } = await db
    .from("galleries")
    .select("id, slug, title, bunny_folder, is_published, cover_path")
    .eq("kind", "album")
    .order("sort_order", { ascending: true });
  if (gErr) die(`Supabase: ${gErr.message}`);

  // Paged: PostgREST caps a response at 1000 rows and a silently short list
  // would make every count in the report wrong.
  const photos = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("photos")
      .select("storage_path, gallery_id, galleries!inner(kind)")
      .eq("galleries.kind", "album")
      .range(from, from + PAGE - 1);
    if (error) die(`Supabase: ${error.message}`);
    photos.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  return { galleries: galleries ?? [], photos };
}

// Cache

async function refresh() {
  if (!SITE || !REVALIDATE_SECRET) {
    console.log("");
    console.log("  Uploaded, but the caches were NOT dropped — NEXT_PUBLIC_SITE_URL or");
    console.log("  REVALIDATE_SECRET is missing. The change appears within an hour on its");
    console.log("  own, or immediately once you set those and run --refresh.");
    return;
  }
  try {
    const res = await fetch(`${SITE}/api/sync?only=revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      console.log("  ✓  caches dropped — reload /portfolio TWICE");
      console.log("     (the tag is stale-while-revalidate: the first reload serves the old");
      console.log("      page and builds the new one behind it)");
    } else {
      console.log(`  ✗  /api/sync?only=revalidate answered ${res.status}`);
      if (res.status === 401) console.log("     REVALIDATE_SECRET here does not match the deployed one.");
      if (res.status === 404) console.log("     The deployed build predates ?only=revalidate. Push and redeploy.");
    }
  } catch (e) {
    console.log(`  ✗  could not reach ${SITE}: ${String(e)}`);
  }
}

// Report

function report(m, db) {
  console.log(`\n  ${FILE} · storage zone ${ZONE}\n`);

  if (!db) {
    console.log("  Supabase env not set, so this is the rule list without its effect.");
    console.log("  Add SUPABASE_SERVICE_ROLE_KEY to see how many photographs each rule hides.\n");
  }

  const paths = db ? db.photos.map((p) => p.storage_path) : [];
  if (db) {
    const shown = paths.filter((p) => !isHidden(p, m)).length;
    console.log(`  ${paths.length} album photographs in the database · ${shown} on the Portfolio · ${paths.length - shown} hidden\n`);
  }

  console.log("  RULE                                      KIND      HIDES");
  const builtIn = ALWAYS_EXCLUDED.map((f) => ({ rule: `${f}/`, kind: "folder", key: f, builtIn: true }));
  for (const r of [...builtIn, ...m.rules]) {
    const n = db ? paths.filter((p) => hides(r, p)).length : null;
    const count = r.builtIn ? "built in" : n === null ? "—" : String(n);
    const warn = !r.builtIn && n === 0 ? "   ← matches nothing, check the spelling" : "";
    console.log(`  ${String(r.rule).padEnd(41)} ${r.kind.padEnd(9)} ${count.padStart(5)}${warn}`);
  }
  if (m.rules.length === 0) console.log("  (no rules of your own — only the two built-in ones)");

  if (db) {
    console.log("\n  ALBUM                      FOLDER                     ON THE PORTFOLIO");
    for (const g of db.galleries) {
      const mine = db.photos.filter((p) => p.gallery_id === g.id).map((p) => p.storage_path);
      const visible = mine.filter((p) => !isHidden(p, m));
      const why = albumHidden(g, m);
      let state;
      if (g.is_published === false) state = "hidden — is_published = false";
      else if (why) state = `HIDDEN — ${why}`;
      else if (mine.length > 0 && visible.length === 0) state = "HIDDEN — every photo excluded";
      else state = `${visible.length}/${mine.length} photos`;
      console.log(
        `  ${String(g.slug).padEnd(26)} ${String(g.bunny_folder ?? "— hand-curated").padEnd(26)} ${state}`,
      );
    }
  }

  if (m.hiddenAlbums.length) {
    console.log(`\n  hiddenAlbums     ${m.hiddenAlbums.join(", ")}`);
  }
  if (m.hiddenCategories.length) {
    console.log(`  hiddenCategories ${m.hiddenCategories.join(", ")}`);
  }

  console.log(`
  To change something:

    hide  Portraits/Shirin/9O6A2207.png     one photograph
    hide  unreal/                           a folder and everything under it
    hide  "Portraits/*"                     the loose images in Portraits only
    hide-album Portraits                    an album's tile and its page

  show / show-album undo each of those. Quote anything containing * so your
  shell does not expand it.
`);
}

// Mutations

function shapeAdvice(arg, db) {
  // The silent failure this catches: "hide Portraits" is read as a FILE named
  // Portraits, matches nothing, uploads cleanly and does nothing at all.
  const looksLikeFile = /\.[a-z0-9]{2,5}$/i.test(arg);
  if (looksLikeFile || arg.endsWith("/") || arg.endsWith("/*")) return null;

  const isKnownFolder =
    !db || db.photos.some((p) => folderOf(p.storage_path) === arg || p.storage_path.startsWith(`${arg}/`));
  if (!isKnownFolder) return null;

  return [
    `"${arg}" is a folder, and a bare folder name is read as a filename — it would`,
    "hide nothing. Say which you mean:",
    "",
    `  scripts/portfolio-exclude.mjs hide "${arg}/"      the folder AND its subfolders`,
    `  scripts/portfolio-exclude.mjs hide "${arg}/*"     only the loose images in it`,
    "",
    `  scripts/portfolio-exclude.mjs hide-album ${arg}   just the album tile and page`,
  ];
}

async function main() {
  if (flag("--refresh") && !command) {
    console.log("");
    await refresh();
    console.log("");
    return;
  }

  const { raw, data } = await readLive();
  const m = parse(data);
  const db = await loadPhotos();

  if (flag("--pull")) {
    if (raw === null) die("There is no manifest in the storage zone yet — nothing to pull.");
    await writeFile(FILE, raw.endsWith("\n") ? raw : raw + "\n");
    console.log(`\n  ✓  live manifest written to ./${FILE}\n`);
    console.log("     Edit it, then:  scripts/portfolio-exclude.mjs --push\n");
    return;
  }

  if (flag("--push")) {
    let local;
    try {
      local = JSON.parse(await readFile(FILE, "utf8"));
    } catch (e) {
      die(`Could not read ./${FILE}: ${String(e)}`, "Get a copy first with --pull.");
    }
    console.log("");
    if (raw !== null) {
      await writeFile(`${FILE}.backup`, raw);
      console.log(`  ✓  previous live copy saved as ./${FILE}.backup`);
    }
    await writeLive(local);
    await refresh();
    console.log("");
    return;
  }

  if (!command) {
    report(m, db);
    return;
  }

  const next = { ...data, excludedPaths: [...(data.excludedPaths ?? [])], hiddenAlbums: [...(data.hiddenAlbums ?? [])] };

  if (command === "hide" || command === "show") {
    if (!target) die(`Usage: scripts/portfolio-exclude.mjs ${command} <path>`);
    const arg = target.replace(/^\/+/, "").replace(/\\/g, "/");

    if (command === "hide") {
      const advice = shapeAdvice(arg, db);
      if (advice) die(...advice);
      if (next.excludedPaths.some((p) => String(p).replace(/^\/+/, "") === arg)) {
        console.log(`\n  "${arg}" is already in the manifest. Nothing to do.\n`);
        return;
      }
      next.excludedPaths.push(arg);
    } else {
      const before = next.excludedPaths.length;
      next.excludedPaths = next.excludedPaths.filter((p) => String(p).replace(/^\/+/, "") !== arg);
      if (next.excludedPaths.length === before) {
        console.log(`\n  "${arg}" is not in the manifest. Current rules:\n`);
        for (const r of m.rules) console.log(`    ${r.rule}`);
        console.log("");
        return;
      }
    }

    const check = parse(next);
    const affected = db
      ? db.photos.map((p) => p.storage_path).filter((p) => isHidden(p, check) !== isHidden(p, m)).length
      : null;

    console.log("");
    console.log(`  ${command === "hide" ? "+" : "−"} ${arg}`);
    if (affected !== null) {
      console.log(`  ${affected} photograph${affected === 1 ? "" : "s"} ${command === "hide" ? "hidden" : "restored"}`);
      if (affected === 0) {
        console.log("");
        console.log("  Zero. Either the path is spelled differently in storage, or another rule");
        console.log("  already covers it. Run the script with no arguments to see the rules.");
      }
    }
    await writeLive(next);
    await refresh();
    console.log("");
    return;
  }

  if (command === "hide-album" || command === "show-album") {
    if (!target) die(`Usage: scripts/portfolio-exclude.mjs ${command} <slug or folder>`);

    if (db && command === "hide-album") {
      const match = db.galleries.find(
        (g) => albumKey(g.slug) === albumKey(target) || (g.bunny_folder && albumKey(g.bunny_folder) === albumKey(target)),
      );
      if (!match) {
        die(
          `No album matches "${target}". It is matched against the slug or the bunny_folder.`,
          "",
          ...db.galleries.map((g) => `  ${String(g.slug).padEnd(26)} ${g.bunny_folder ?? "— hand-curated"}`),
        );
      }
    }

    if (command === "hide-album") {
      if (next.hiddenAlbums.some((a) => albumKey(a) === albumKey(target))) {
        console.log(`\n  "${target}" is already hidden. Nothing to do.\n`);
        return;
      }
      next.hiddenAlbums.push(target);
    } else {
      const before = next.hiddenAlbums.length;
      next.hiddenAlbums = next.hiddenAlbums.filter((a) => albumKey(a) !== albumKey(target));
      if (next.hiddenAlbums.length === before) {
        console.log(`\n  "${target}" was not hidden. Currently hidden: ${m.hiddenAlbums.join(", ") || "none"}\n`);
        return;
      }
    }

    console.log("");
    console.log(`  hiddenAlbums → ${next.hiddenAlbums.join(", ") || "(empty)"}`);
    console.log("");
    console.log(command === "hide-album"
      ? "  Its tile leaves /portfolio and /albums/<slug> starts returning 404. The\n  photographs themselves stay in the main portfolio grid — to take those out\n  too, hide the folder's loose images as well:  hide \"<Folder>/*\""
      : "  Its tile and page are back.");
    console.log("");
    await writeLive(next);
    await refresh();
    console.log("");
    return;
  }

  die(
    `Unknown command "${command}".`,
    "",
    "  hide <path>   show <path>   hide-album <name>   show-album <name>",
    "  --pull   --push   --refresh   (or no arguments at all, to look)",
  );
}

await main();
