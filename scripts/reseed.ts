// The Bunny storage zone is the source of truth. This walks it and makes
// Supabase match: every folder holding images becomes a gallery, every image
// becomes a photo row, and any folder-backed row with no counterpart in the
// zone is deleted.
//
//   npx tsx scripts/reseed.ts                 # walk zone, apply changes
//   npx tsx scripts/reseed.ts --dry-run       # show the plan, write nothing
//   npx tsx scripts/reseed.ts --folder=WIUT   # one folder subtree only
//   npx tsx scripts/reseed.ts --prune-orphans # also delete rows with no folder
//
// Built to run repeatedly while the zone churns; nothing here preserves
// continuity with a previous zone. Hand-edited fields (title, description,
// accent_color, location, year, date_label, client_note) are set only when a
// folder first appears and then left alone — deleting the folder in Bunny
// deletes the row and those edits with it.

import { createClient } from "@supabase/supabase-js";
import { imageSize } from "image-size";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Environment

// Next.js loads .env.local automatically; plain tsx does not, and
// "dotenv/config" only ever reads .env. Parsing it here keeps the script free
// of a dotenv dependency and free of top-level await, which tsx cannot emit
// while package.json has no "type": "module".
function loadEnvFile(file: string): boolean {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return false;

  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Anything already in the environment wins, so --env-file and real shell
    // exports are not clobbered.
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

// .env.local first, matching Next's precedence.
const ENV_FILES_FOUND = [".env.local", ".env"].filter(loadEnvFile);

// Config

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ZONE = process.env.BUNNY_STORAGE_ZONE;
const API_KEY = process.env.BUNNY_STORAGE_API_KEY;

// Region-specific. The exact hostname is printed in the Bunny dashboard under
// the storage zone's FTP & API Access tab.
const HOST = process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com";

// Folders holding client deliveries rather than portfolio albums. A gallery
// under one of these gets kind='client' and is_listed=false, so it never
// appears in the public album list; everything else takes the column defaults.
//
// Confirm which values kind accepts before editing "client":
//   select conname, pg_get_constraintdef(oid) from pg_constraint
//   where conrelid = 'public.galleries'::regclass;
const CLIENT_FOLDER_PREFIXES = ["clients"];
const CLIENT_KIND = "client";

// The ladder's own output, which this script must never look inside.
//
// build-ladder.mjs writes 14 derivative files per photo under these roots —
// six AVIF, six WebP, share.jpg and download.jpg. Every one of them matches
// IMAGE_RE, so a walk that descends here finds folders full of images and
// dutifully turns each into a gallery: 63 of them on the first run, published
// and public by default, each "holding" the 14 rungs of one photograph. Then
// build-ladder queues those derivatives as sources and builds derivatives of
// derivatives, whose directories the next reseed also finds. It compounds.
//
// Skipped at the descent rather than filtered afterwards, so the listing cost
// is not paid either. These two prefixes are reserved: never name an album
// folder "d".
const DERIVATIVE_PREFIXES = ["d", "clients/_d"];

/** True for the ladder's output roots and anything beneath them. */
function isDerivativePath(path: string): boolean {
  const p = path.replace(/^\/+/, "").toLowerCase();
  return DERIVATIVE_PREFIXES.some((root) => p === root || p.startsWith(`${root}/`));
}

// Only sent on first insert. Everything omitted here falls back to the column
// default in Postgres, which is where accent_color, photographer_handle,
// description and date_label are already handled.
const SEED_LOCATION = "Tashkent";

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const LIST_CONCURRENCY = 5;
const PROBE_CONCURRENCY = 4;
const PROBE_BYTES = 256 * 1024;

const argv: string[] = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const PRUNE_ORPHANS = argv.includes("--prune-orphans");
const ONLY = argv.find((a) => a.startsWith("--folder="))?.split("=")[1] ?? null;

interface LiveFile {
  path: string; // relative to zone root, no leading slash
  name: string;
  length: number;
}

// Bunny

function requireEnv() {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ZONE) missing.push("BUNNY_STORAGE_ZONE");
  if (!API_KEY) missing.push("BUNNY_STORAGE_API_KEY");
  if (!missing.length) return;

  const cwd = process.cwd();
  const seen = ENV_FILES_FOUND;
  throw new Error(
    `Missing env vars: ${missing.join(", ")}\n` +
      `  cwd:   ${cwd}\n` +
      `  found: ${seen.length ? seen.join(", ") : "no .env files here"}\n` +
      (seen.length
        ? `  The files exist, so check the names above match your keys exactly ` +
          `(SUPABASE_SERVICE_ROLE_KEY, not SUPABASE_SERVICE_KEY) and that no ` +
          `value is wrapped in quotes or split across lines.`
        : `  Run this from the project root, where .env.local lives.`),
  );
}

async function listDir(prefix: string): Promise<
  { ObjectName: string; IsDirectory: boolean; Length: number }[]
> {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  const res = await fetch(
    `https://${HOST}/${ZONE}/${clean ? clean + "/" : ""}`,
    { headers: { AccessKey: API_KEY!, Accept: "application/json" } },
  );

  if (res.status === 401) {
    throw new Error(
      `401 from ${HOST}. Either the key is wrong, or the zone lives in ` +
        `another region — set BUNNY_STORAGE_HOST to the hostname shown in ` +
        `the zone's FTP & API Access tab.`,
    );
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`List "${clean}": ${res.status} ${res.statusText}`);
  return res.json();
}

/** Walks the zone and groups images by the folder directly containing them. A
 *  folder holding only subfolders is a container, not a gallery. */
async function walkZone(
  root: string,
): Promise<{ galleries: Map<string, LiveFile[]>; emptyDirs: string[] }> {
  const out = new Map<string, LiveFile[]>();
  const emptyDirs: string[] = [];
  let queue = [root];
  let dirs = 0;

  while (queue.length) {
    const batch = queue.splice(0, LIST_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (dir) => ({ dir, entries: await listDir(dir) })),
    );

    const next: string[] = [];
    for (const { dir, entries } of results) {
      dirs++;
      const files: LiveFile[] = [];
      let subdirs = 0;
      for (const e of entries) {
        const path = dir ? `${dir}/${e.ObjectName}` : e.ObjectName;
        if (e.IsDirectory) {
          // Counted as a subfolder either way, so a parent holding only
          // derivative directories is not misreported as empty below.
          subdirs++;
          if (!isDerivativePath(path)) next.push(path);
        } else if (IMAGE_RE.test(e.ObjectName)) {
          files.push({ path, name: e.ObjectName, length: e.Length });
        }
      }
      if (files.length) {
        files.sort((a, b) =>
          a.name.localeCompare(b.name, "en", { numeric: true }),
        );
        out.set(dir, files);
      } else if (subdirs === 0 && dir) {
        // Holds neither images nor subfolders. Either genuinely empty, or
        // holding files this script does not count as images.
        emptyDirs.push(dir);
      }
      process.stdout.write(`\r  ${dirs} dirs, ${out.size} galleries found`);
    }
    queue = queue.concat(next);
  }
  process.stdout.write("\n");
  return { galleries: out, emptyDirs };
}

/** Reads only the header bytes, then hangs up. */
async function probe(
  path: string,
): Promise<{ width: number; height: number } | null> {
  const controller = new AbortController();
  try {
    const res = await fetch(`https://${HOST}/${ZONE}/${path}`, {
      headers: { AccessKey: API_KEY!, Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: controller.signal,
    });
    if ((!res.ok && res.status !== 206) || !res.body) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    controller.abort();

    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    const { width, height } = imageSize(buf);
    return width && height ? { width, height } : null;
  } catch {
    return null; // a photo without dimensions still renders, just shifts once
  }
}

async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// Naming

// Russian and Uzbek Cyrillic. Without this a folder named "Портреты" strips
// down to nothing and every non-Latin gallery collides on the slug "gallery".
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

function transliterate(text: string): string {
  return [...text]
    .map((ch) => {
      const lower = ch.toLowerCase();
      const mapped = TRANSLIT[lower];
      if (mapped === undefined) return ch;
      if (ch === lower || mapped === "") return mapped;
      return mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join("");
}

/** Matches galleries_slug_check: alphanumeric runs joined by - or _ */
function slugify(text: string): string {
  return (
    transliterate(text)
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gallery"
  );
}

function titleize(folderName: string): string {
  return folderName
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isClientFolder(folder: string): boolean {
  // Case-insensitive on purpose: Bunny paths are case-sensitive, so "clients"
  // and "Clients" are different folders, and relying on you to keep them
  // consistent is how a client shoot ends up on the public album list.
  const f = folder.toLowerCase();
  return CLIENT_FOLDER_PREFIXES.some((p) => {
    const prefix = p.toLowerCase();
    return f === prefix || f.startsWith(prefix + "/");
  });
}

// Main

interface Row {
  id: string;
  slug: string;
  bunny_folder: string | null;
  cover_path: string | null;
}

async function main() {
  requireEnv();
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false },
  });

  console.log(`\nZone  ${ZONE} @ ${HOST}`);
  console.log(
    `Mode  ${DRY ? "DRY RUN" : "APPLY"}${ONLY ? `  (folder=${ONLY})` : ""}\n`,
  );

  const { galleries: zone, emptyDirs } = await walkZone(ONLY ?? "");
  if (zone.size === 0) {
    throw new Error(
      "No folders with images found. Check the zone name and host before " +
        "assuming the zone is empty — a 401 reads the same way.",
    );
  }

  // Read the live column set so a future schema change degrades to a skipped
  // field rather than a failed insert. This is exactly how kind/is_listed
  // appeared without warning.
  const { data: sample } = await db.from("galleries").select("*").limit(1);
  const columns = new Set(Object.keys(sample?.[0] ?? {}));
  const hasCol = (c: string) => columns.size === 0 || columns.has(c);

  const { data: existing, error: exErr } = await db
    .from("galleries")
    .select("id, slug, bunny_folder, cover_path");
  if (exErr) throw exErr;
  const rows = (existing ?? []) as unknown as Row[];

  const norm = (f: string | null) => (f ? f.replace(/^\/+|\/+$/g, "") : null);
  const byFolder = new Map<string, Row>();
  for (const r of rows) {
    const f = norm(r.bunny_folder);
    if (f) byFolder.set(f, r);
  }

  // -- what goes ------------------------------------------------------------
  // Scoped to the subtree walked, so --folder=X never touches rows outside it.
  const inScope = (f: string) => !ONLY || f === ONLY || f.startsWith(ONLY + "/");

  const doomed = rows.filter((r) => {
    const f = norm(r.bunny_folder);
    if (f === null) return false; // handled as an orphan below
    return inScope(f) && !zone.has(f);
  });

  // Rows with no bunny_folder at all. Nothing in the zone backs them, but they
  // are also not something this script created, so they survive unless asked.
  const orphans =
    ONLY || !PRUNE_ORPHANS
      ? []
      : rows.filter((r) => norm(r.bunny_folder) === null);

  const unmanaged = rows.filter((r) => norm(r.bunny_folder) === null).length;

  // Rows whose folder is present in the zone. Untouched at the gallery level;
  // their photos are still reconciled below.
  const keeping = rows.filter((r) => {
    const f = norm(r.bunny_folder);
    return f !== null && zone.has(f);
  });

  // -- what arrives ---------------------------------------------------------
  const goingAway = new Set([...doomed, ...orphans].map((r) => r.id));
  const usedSlugs = new Set(
    rows.filter((r) => !goingAway.has(r.id)).map((r) => r.slug.toLowerCase()),
  );
  const creating: { folder: string; slug: string; title: string }[] = [];

  for (const folder of zone.keys()) {
    if (byFolder.has(folder)) continue;
    const segments = folder.split("/");
    let slug = slugify(segments[segments.length - 1]);
    if (usedSlugs.has(slug.toLowerCase()) && segments.length > 1) {
      slug = slugify(segments.slice(-2).join("-"));
    }
    const base = slug;
    let n = 2;
    while (usedSlugs.has(slug.toLowerCase())) slug = `${base}-${n++}`;
    usedSlugs.add(slug.toLowerCase());
    creating.push({
      folder,
      slug,
      title: titleize(segments[segments.length - 1]),
    });
  }

  const imageCount = [...zone.values()].reduce((n, f) => n + f.length, 0);
  console.log(`Zone      ${zone.size} folders, ${imageCount} images`);
  console.log(`Database  ${rows.length} galleries`);
  console.log(
    `Plan      +${creating.length} new, =${keeping.length} kept, ` +
      `-${doomed.length + orphans.length} removed\n`,
  );

  for (const c of creating) {
    const tag = isClientFolder(c.folder) ? "client" : "album";
    console.log(`  + ${c.slug.padEnd(24)} ${tag.padEnd(7)} ${c.folder}`);
  }
  for (const k of keeping) {
    console.log(`  = ${k.slug.padEnd(24)}         ${k.bunny_folder}`);
  }
  for (const d of doomed) {
    console.log(`  - ${d.slug.padEnd(24)}         ${d.bunny_folder}`);
  }
  for (const o of orphans) {
    console.log(`  - ${o.slug.padEnd(24)}         (orphan, no folder)`);
  }
  if (unmanaged && !PRUNE_ORPHANS) {
    console.log(
      `\n  ${unmanaged} gallery row(s) have no bunny_folder and were left ` +
        `alone. Add --prune-orphans to delete them too.`,
    );
  }
  if (emptyDirs.length) {
    console.log(
      `\n  ${emptyDirs.length} folder(s) held no images and became no gallery:`,
    );
    for (const d of emptyDirs.slice(0, 15)) console.log(`      ${d}`);
    if (emptyDirs.length > 15) {
      console.log(`      ...and ${emptyDirs.length - 15} more`);
    }
    console.log(
      `    Recognised extensions: jpg jpeg png webp gif avif. Anything else ` +
        `(heic, tif, raw) is invisible to this script.`,
    );
  }

  if (DRY) {
    console.log("\nDry run — nothing written. Drop --dry-run to apply.\n");
    return;
  }

  // -- apply gallery changes ------------------------------------------------
  const removing = [...doomed, ...orphans];
  if (removing.length) {
    const { error } = await db
      .from("galleries")
      .delete()
      .in("id", removing.map((d) => d.id));
    if (error) throw error;
    console.log(`\n  deleted ${removing.length} galleries (photos cascaded)`);
    for (const d of removing) {
      const f = norm(d.bunny_folder);
      if (f) byFolder.delete(f);
    }
  }

  for (const c of creating) {
    const client = isClientFolder(c.folder);
    const payload: Record<string, unknown> = {
      slug: c.slug,
      title: c.title,
      bunny_folder: c.folder,
    };
    // location and year are NOT NULL with '' defaults, so seeding them is
    // cosmetic but saves editing every new row by hand.
    if (hasCol("location")) payload.location = SEED_LOCATION;
    if (hasCol("year")) payload.year = String(new Date().getFullYear());
    // Everything else — accent_color, photographer_handle, description,
    // date_label, visibility, download_enabled — takes its column default.
    if (client) {
      if (hasCol("kind")) payload.kind = CLIENT_KIND;
      if (hasCol("is_listed")) payload.is_listed = false;
    }

    const { data, error } = await db
      .from("galleries")
      .insert(payload)
      .select("id, slug, bunny_folder, cover_path")
      .single();

    if (error) {
      console.error(`  ! insert ${c.slug}: ${error.message}`);
      continue;
    }
    byFolder.set(c.folder, data as unknown as Row);
  }
  if (creating.length) console.log(`  created ${creating.length} galleries`);

  // -- photos ---------------------------------------------------------------
  console.log("\nPhotos");
  let totalProbed = 0;

  for (const [folder, files] of zone) {
    const gallery = byFolder.get(folder);
    if (!gallery) continue;

    interface Prior {
      storage_path: string;
      width: number | null;
      height: number | null;
    }
    const { data: priorRows } = await db
      .from("photos")
      .select("storage_path, width, height")
      .eq("gallery_id", gallery.id);

    const prior = new Map<string, Prior>(
      ((priorRows ?? []) as unknown as Prior[]).map((p) => [p.storage_path, p]),
    );

    // Only genuinely new paths cost a network round trip.
    const needProbe = files.filter((f) => {
      const p = prior.get(f.path);
      return !p || p.width === null || p.height === null;
    });
    const probed = await pool(needProbe, PROBE_CONCURRENCY, (f) => probe(f.path));
    const dims = new Map(needProbe.map((f, i) => [f.path, probed[i]]));
    totalProbed += needProbe.length;

    const label = titleize(folder.split("/").pop()!);
    const photoRows = files.map((f, i) => {
      const p = prior.get(f.path);
      const d = dims.get(f.path);
      const width = d?.width ?? p?.width ?? null;
      const height = d?.height ?? p?.height ?? null;
      // file_name and aspect_ratio are deliberately not set here.
      //
      // Both are GENERATED ALWAYS ... STORED columns, and Postgres rejects any
      // non-DEFAULT insert into one — "cannot insert a non-DEFAULT value into
      // column file_name" aborts the whole upsert, leaving the photos table
      // empty while the galleries are created quite happily. Postgres reports
      // only the first offending column, so both have to go or aspect_ratio
      // surfaces on the next run.
      //
      // Nothing is lost: the database derives file_name from storage_path and
      // aspect_ratio from width/height on every write, so they cannot drift.
      return {
        gallery_id: gallery.id,
        storage_path: f.path,
        alt: `${label} — photo ${i + 1} of ${files.length}`,
        width,
        height,
        bytes: f.length,
        sort_order: i,
      };
    });

    const { error: upErr } = await db
      .from("photos")
      .upsert(photoRows, { onConflict: "gallery_id,storage_path" });
    if (upErr) {
      console.error(`  ! ${gallery.slug}: ${upErr.message}`);
      continue;
    }

    const livePaths = new Set(files.map((f) => f.path));
    const stale = [...prior.keys()].filter((p) => !livePaths.has(p));
    if (stale.length) {
      await db
        .from("photos")
        .delete()
        .eq("gallery_id", gallery.id)
        .in("storage_path", stale);
    }

    // Cover follows the folder: set it when unset or now dangling.
    if (!gallery.cover_path || !livePaths.has(gallery.cover_path)) {
      await db
        .from("galleries")
        .update({ cover_path: files[0].path })
        .eq("id", gallery.id);
    }

    console.log(
      `  ${gallery.slug.padEnd(24)} ${String(files.length).padStart(4)} photos` +
        (stale.length ? `  -${stale.length}` : "") +
        (needProbe.length ? `  probed ${needProbe.length}` : ""),
    );
  }

  console.log(
    `\nDone. ${totalProbed} images measured this run; unchanged files ` +
      `transferred no bytes.\n`,
  );
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});