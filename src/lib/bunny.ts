import "server-only";
//
// Server-only: this holds the storage API key. A client component that needs
// bunnyUrl imports "./bunny-url" directly — adding a re-export here would
// reopen the hole that split is closing.

const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const API_KEY = process.env.BUNNY_STORAGE_API_KEY;

import { bunnyUrl } from "./bunny-url";

interface BunnyFile {
  ObjectName: string;
  IsDirectory: boolean;
  Path: string;
  Length: number;
}

// Lists all files in a folder and returns their CDN URLs
export async function listBunnyImages(folder: string): Promise<string[]> {
  const cleanFolder = folder.replace(/^\/|\/$/g, "");
  if (cleanFolder === "clients" || cleanFolder.startsWith("clients/")) {
    throw new Error(
      "listBunnyImages() builds PUBLIC pull-zone URLs and must never be " +
        "pointed at clients/. Use src/lib/client-galleries.ts instead.",
    );
  }
  if (!STORAGE_ZONE || !API_KEY) {
    console.warn(
      "BUNNY_STORAGE_ZONE or BUNNY_STORAGE_API_KEY is not set — " +
      "returning an empty array. Check your .env.local."
    );
    return [];
  }

  const res = await fetch(
    `https://storage.bunnycdn.com/${STORAGE_ZONE}/${cleanFolder}/`,
    {
      method: "GET",
      headers: {
        AccessKey: API_KEY,
        Accept: "application/json",
      },
      next: { revalidate: 300 }, // cache 5 min, adjust/remove as needed
    }
  );

  if (!res.ok) {
    throw new Error(`Bunny API error: ${res.status} ${res.statusText}`);
  }

  const files: BunnyFile[] = await res.json();

  return files
    .filter((f) => !f.IsDirectory)
    .map((f) => bunnyUrl(`/${cleanFolder}/${f.ObjectName}`));
}

export interface BunnyImage {
  src: string;
  category: string; // top-level folder name (e.g. "WIUT", "Portraits"), or "Other" for root-level files
  alt: string;      // human-readable description, derived from the path
  hidden: boolean;  // true if the image is in a hidden category (per portfolio-exclude.json)
}

// "Portraits/Sara/3M0A1432.png" -> "Sara portrait photography by saycheeeeeze"
// Filenames are camera codes, so the folder path is the only real signal about
// what a photo shows. Good alt text matters for screen readers and is a real
// discovery channel for a photographer via image search.
function describeImage(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const folders = parts.slice(0, -1);
  if (folders.length === 0) return "Photograph by saycheeeeeze";

  const readable = folders
    .map((f) => f.replace(/[-_]+/g, " ").trim())
    .filter(Boolean)
    .join(" — ");

  return `${readable} — photography by saycheeeeeze`;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif)$/i;

// The curation manifest: what the Portfolio shows, changeable without touching
// code and without a redeploy.
//
// READ THIS FIRST. The file the app reads lives at the ROOT OF THE BUNNY
// STORAGE ZONE, fetched below over the storage API. A copy of it sitting in the
// repo, or next to it, is a working copy and NOTHING MORE — editing that file
// changes nothing on the site, ever. Edit the live one with:
//
//   node --env-file=.env.local scripts/portfolio-exclude.mjs            # show
//   node --env-file=.env.local scripts/portfolio-exclude.mjs hide <path>
//
// which reads the live copy, writes it back and busts the cache in one go.
//
// {
//   "excludedPaths": [
//     "unreal/",                      folder — it and everything beneath it
//     "Portraits/*",                  the loose images IN Portraits; its
//                                     subfolders (Sara, Shirin…) are kept
//     "Portraits/Shirin/9O6A2207.png" one file
//   ],
//   "hiddenAlbums": ["Portraits"],    an album's tile AND its /albums/… page,
//                                     named by slug or by bunny_folder
//   "categoryLabels":   { "edited": "WIUT Fashion Show 2026" },
//   "hiddenCategories": ["random"]    a category's photos stay reachable by
//                                     filter but are out of the default view
// }
//
// FAILS OPEN, deliberately: an unreachable or malformed manifest excludes
// NOTHING rather than blanking the portfolio. The cost of that choice is that a
// typo'd rule also silently excludes nothing, which is why the script reports
// how many photographs each rule actually removes.
const EXCLUDE_MANIFEST_FILE = "portfolio-exclude.json";

// Never part of the portfolio, manifest or no manifest.
//
// clients/ is delivered work, served from the private zone, and must not depend
// on a line in a JSON file staying put.
//
// d/ is the ladder. The zone walk accepts .avif, so without this the portfolio
// fills with twelve copies of every photograph and makes one API call per
// derivative directory before the page can render.
const ALWAYS_EXCLUDED = ["clients", "d"];

export interface ExcludeManifest {
  /** Folder prefixes: the folder and everything beneath it. From `"unreal/"`. */
  excludedFolders: string[];
  /**
   * Folders whose DIRECT children are hidden while their subfolders survive.
   * From `"Portraits/*"`.
   *
   * The pattern exists because a folder that holds both photographs and
   * subfolders is two different things at once — a gallery of its own loose
   * images, and a container for others. `"Portraits/"` cannot express "the
   * container, not the gallery", because it is a prefix match and takes Sara,
   * Radmir and Shirin with it.
   *
   * `""` is a legal entry, from `"*"`: loose files at the storage root.
   */
  excludedShallow: string[];
  /** Exact storage paths. Anything without a trailing `/` or `/*`. */
  excludedFiles: string[];
  /**
   * Albums whose tile is off the Portfolio and whose `/albums/…` page 404s.
   * Matched against the album's slug OR its `bunny_folder`, case-insensitively,
   * so `"Portraits"` finds both.
   */
  hiddenAlbums: string[];
  categoryLabels: Record<string, string>;
  hiddenCategories: string[];
}

/**
 * Exported so the Supabase-backed portfolio can honour the same
 * portfolio-exclude.json you already maintain. The photo LIST moved to the
 * database; the curation rules did not, and duplicating them would mean two
 * places to change when you hide a folder.
 */
export async function getExcludeManifest(): Promise<ExcludeManifest> {
  const empty: ExcludeManifest = {
    excludedFolders: [...ALWAYS_EXCLUDED], excludedShallow: [],
    excludedFiles: [], hiddenAlbums: [],
    categoryLabels: {}, hiddenCategories: [] };
  if (!STORAGE_ZONE || !API_KEY) return empty;

  try {
    const res = await fetch(
      `https://storage.bunnycdn.com/${STORAGE_ZONE}/${EXCLUDE_MANIFEST_FILE}`,
      {
        method: "GET",
        headers: { AccessKey: API_KEY, Accept: "application/json" },
        // Tagged as well as timed. Without the tag, revalidateTag("albums")
        // rebuilt loadPortfolioPhotos() but handed it the SAME cached manifest
        // for up to five more minutes — so an edit appeared to do nothing and
        // then worked on its own later, which is the worst way for a curation
        // tool to behave.
        next: { revalidate: 300, tags: ["albums", "portfolio-manifest"] },
      }
    );

    if (!res.ok) return empty; // no manifest uploaded yet — exclude nothing

    const data: {
      excludedPaths?: string[];
      hiddenAlbums?: string[];
      categoryLabels?: Record<string, string>;
      hiddenCategories?: string[];

     } = await res.json();
    const excludedFolders: string[] = [];
    const excludedShallow: string[] = [];
    const excludedFiles: string[] = [];

    for (const raw of data.excludedPaths ?? []) {
      const clean = raw.replace(/^\/+/, "");
      if (!clean) continue;
      if (clean === "*") {
        excludedShallow.push(""); // loose files at the storage root
      } else if (clean.endsWith("/*")) {
        excludedShallow.push(clean.slice(0, -2).replace(/\/+$/, ""));
      } else if (clean.endsWith("/")) {
        excludedFolders.push(clean.slice(0, -1));
      } else {
        excludedFiles.push(clean);
      }
    }

    return {
      excludedFolders: [...ALWAYS_EXCLUDED, ...excludedFolders],
      excludedShallow,
      excludedFiles,
      hiddenAlbums: data.hiddenAlbums ?? [],
      categoryLabels: data.categoryLabels ?? {},
      hiddenCategories: data.hiddenCategories ?? []
    };
  } catch {
    return empty; // manifest missing/unreachable — fail open, exclude nothing
  }
}

/** "Portraits/Sara/3M0A1432.png" → "Portraits/Sara"; a root file → "". */
function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Slugs and folder names are compared loosely; storage paths never are. */
const albumKey = (s: string): string => s.replace(/^\/+|\/+$/g, "").toLowerCase();

export function isPathExcluded(path: string, folders: string[]): boolean {
  return folders.some((f) => path === f || path.startsWith(`${f}/`));
}

/** Is this file a direct child of a `Folder/*` folder? Subfolders survive. */
export function isShallowExcluded(path: string, shallow: string[]): boolean {
  return shallow.length > 0 && shallow.includes(folderOf(path));
}

/**
 * THE question to ask about one photograph. Every surface that shows
 * photographs asks this and nothing else, so the three kinds of rule cannot
 * drift apart between the portfolio grid, an album page and the storage walk.
 */
export function isPhotoExcluded(path: string, m: ExcludeManifest): boolean {
  return (
    isPathExcluded(path, m.excludedFolders) ||
    isShallowExcluded(path, m.excludedShallow) ||
    m.excludedFiles.includes(path)
  );
}

/**
 * Is this album off the Portfolio? True when it is named in `hiddenAlbums`, by
 * slug or by folder — or when its folder is excluded outright, because a folder
 * you hid should not leave its album tile behind.
 *
 * Note it does NOT consult the shallow rules: `"Portraits/*"` hides the loose
 * images, and an album left with nothing to show is dropped by its caller
 * instead. Two separate decisions, deliberately.
 */
export function isAlbumHidden(
  album: { slug: string; folder?: string | null },
  m: ExcludeManifest,
): boolean {
  const folder = album.folder ? album.folder.replace(/^\/+|\/+$/g, "") : "";
  const hidden = m.hiddenAlbums.map(albumKey);
  if (hidden.includes(albumKey(album.slug))) return true;
  if (folder && hidden.includes(albumKey(folder))) return true;
  if (folder && isPathExcluded(folder, m.excludedFolders)) return true;
  return false;
}

// Recursively walks the ENTIRE storage zone (every folder, every subfolder)
// and returns every image found, tagged with its top-level folder as a
// category — minus anything listed in portfolio-exclude.json. Used by the
// Portfolio page so it needs no hardcoded links. Pass a `dir` to start from
// a subfolder instead of the storage root.
export async function listAllBunnyImages(
  dir: string = "",
  manifest?: ExcludeManifest
): Promise<BunnyImage[]> {
  if (!STORAGE_ZONE || !API_KEY) {
    console.warn(
      "BUNNY_STORAGE_ZONE or BUNNY_STORAGE_API_KEY is not set — " +
      "returning an empty array. Check your .env.local."
    );
    return [];
  }

  const activeManifest = manifest ?? await getExcludeManifest();
  const cleanDir = dir.replace(/^\/|\/$/g, ""); // trim slashes

  const res = await fetch(
    `https://storage.bunnycdn.com/${STORAGE_ZONE}/${cleanDir ? cleanDir + "/" : ""}`,
    {
      method: "GET",
      headers: {
        AccessKey: API_KEY,
        Accept: "application/json",
      },
      next: { revalidate: 300 },
    }
  );

  // Fail soft: a broken folder shouldn't take down the whole Portfolio page.
  // Log it and return what we can, so the UI degrades instead of crashing.
  if (!res.ok) {
    console.error(`Bunny list failed for "${cleanDir || "/"}": ${res.status} ${res.statusText}`);
    return [];
  }

  const entries: BunnyFile[] = await res.json();
  const images: BunnyImage[] = [];

  for (const entry of entries) {
    const entryPath = cleanDir ? `${cleanDir}/${entry.ObjectName}` : entry.ObjectName;

    if (entry.IsDirectory) {
      // Folder rules only. A shallow `Folder/*` rule hides that folder's own
      // images and must NOT stop the walk descending into its subfolders.
      if (isPathExcluded(entryPath, activeManifest.excludedFolders)) continue;
      try {
        const nested = await listAllBunnyImages(entryPath, activeManifest);
        images.push(...nested);
      } catch (err) {
        console.error(`Skipping unreadable folder "${entryPath}":`, err);
      }
    } else if (IMAGE_EXTENSIONS.test(entry.ObjectName)) {
      if (isPhotoExcluded(entryPath, activeManifest)) continue;
      const rawCategory = cleanDir ? cleanDir.split("/")[0] : "Other";
      const category = activeManifest.categoryLabels[rawCategory] ?? rawCategory;
      const hidden = activeManifest.hiddenCategories.includes(rawCategory);
      images.push({
        src: bunnyUrl(`/${entryPath}`),
        category,
        hidden,
        alt: describeImage(entryPath),
      });
    }
  }

  return images;
}