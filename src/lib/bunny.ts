import "server-only";
//
// Server-only as of 2026-09-02, which is what the note here has been asking for
// since bunny-url.ts was split out.
//
// The last client-side importer was AboutContent, which wanted bunnyUrl and got
// every storage-API function in this file along with it. The key value was
// never exposed — Next only inlines NEXT_PUBLIC_* vars — but the dead code
// shipped to browsers, and the day somebody prefixed that variable to "make it
// work" it would have become a real leak. AboutContent now imports from
// bunny-url directly, so the door is shut rather than merely unused.
//
// If a client component ever needs bunnyUrl, import "./bunny-url". Adding a
// re-export here would reopen exactly the hole this closes.

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

  // const cleanFolder = folder.replace(/^\/|\/$/g, ""); // trim slashes

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

// Name of the manifest file you upload to the ROOT of your Bunny storage
// zone to control what shows on the Portfolio page, without touching code.
// Example contents:
// {
//   "excludedPaths": ["unreal/", "edited/3M0A1222.png", "Portraits/bamfn/"]
// }
// - A path ending in "/" hides that whole folder (and everything inside it).
// - A path without a trailing slash hides just that one file.
const EXCLUDE_MANIFEST_FILE = "portfolio-exclude.json";

// Folders that are NEVER part of the portfolio, manifest or no manifest.
// clients/ is delivered work: it is served through the private pull zone, it
// isn't yours to publish, and it must not depend on a line in a JSON file
// staying where you put it.
//
// d/ is the derivative ladder — machine-generated resizes of photographs that
// are ALREADY in the portfolio via their originals. listAllBunnyImages() walks
// the whole storage zone and accepts .avif, so without this line every rung of
// every ladder is picked up as if it were a separate photograph: the portfolio
// fills with twelve copies of each image, and the recursive listing makes one
// API call per photo directory before the page can render.
const ALWAYS_EXCLUDED = ["clients", "d"];

export interface ExcludeManifest {
  excludedFolders: string[];
  excludedFiles: string[];
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
    excludedFolders: [...ALWAYS_EXCLUDED], excludedFiles: [],
    categoryLabels: {}, hiddenCategories: [] };
  if (!STORAGE_ZONE || !API_KEY) return empty;

  try {
    const res = await fetch(
      `https://storage.bunnycdn.com/${STORAGE_ZONE}/${EXCLUDE_MANIFEST_FILE}`,
      {
        method: "GET",
        headers: { AccessKey: API_KEY, Accept: "application/json" },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) return empty; // no manifest uploaded yet — exclude nothing

    const data: { 
      excludedPaths?: string[];
      categoryLabels?: Record<string, string>;
      hiddenCategories?: string[];

     } = await res.json();
    const excludedFolders: string[] = [];
    const excludedFiles: string[] = [];

    for (const raw of data.excludedPaths ?? []) {
      const clean = raw.replace(/^\/+/, "");
      if (clean.endsWith("/")) {
        excludedFolders.push(clean.slice(0, -1));
      } else {
        excludedFiles.push(clean);
      }
    }

    return { 
      excludedFolders: [...ALWAYS_EXCLUDED, ...excludedFolders], 
      excludedFiles,
      categoryLabels: data.categoryLabels ?? {},
      hiddenCategories: data.hiddenCategories ?? []
    };
  } catch {
    return empty; // manifest missing/unreachable — fail open, exclude nothing
  }
}

export function isPathExcluded(path: string, folders: string[]): boolean {
  return folders.some((f) => path === f || path.startsWith(`${f}/`));
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
      if (isPathExcluded(entryPath, activeManifest.excludedFolders)) continue;
      try {
        const nested = await listAllBunnyImages(entryPath, activeManifest);
        images.push(...nested);
      } catch (err) {
        console.error(`Skipping unreadable folder "${entryPath}":`, err);
      }
    } else if (IMAGE_EXTENSIONS.test(entry.ObjectName)) {
      if (
        isPathExcluded(entryPath, activeManifest.excludedFolders) ||
        activeManifest.excludedFiles.includes(entryPath)
      ) continue;
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