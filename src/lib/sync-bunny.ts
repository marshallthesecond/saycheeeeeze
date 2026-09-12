// Mirrors one gallery's Bunny Storage folder into the `photos` table.
// Idempotent: safe to run on a loop. Files already in the database keep their
// dimensions and are not re-downloaded, so a second run over an unchanged
// folder does one list call and one upsert, and transfers no image bytes.
//
// Dimensions come from storage.bunnycdn.com, never the pull zone. Your
// Optimizer is enabled, so bunnyUrl()'s default ?width=1600 would hand back a
// resized image and we would store 1600 as the real width of every photo.

import "server-only";
import { imageSize } from "image-size";

import { supabaseAdmin } from "./supabase";

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif)$/i;

// Enough to cover a PNG IHDR (33 bytes) and a JPEG SOF sitting behind a fat
// EXIF block with an embedded thumbnail. We abort the stream once we have it.
const PROBE_BYTES = 256 * 1024;

interface BunnyFile {
  ObjectName: string;
  IsDirectory: boolean;
  Length: number;
}

export interface SyncResult {
  slug: string;
  folder: string | null;
  skipped?: string;
  filesFound: number;
  upserted: number;
  removed: number;
  probed: number;
  errors: string[];
}

// Read lazily, for the same import-hoisting reason as supabase.ts.
function requireBunnyEnv(): { zone: string; key: string } {
  const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
  const API_KEY = process.env.BUNNY_STORAGE_API_KEY;

  if (!STORAGE_ZONE || !API_KEY) {
    throw new Error(
      "BUNNY_STORAGE_ZONE and BUNNY_STORAGE_API_KEY must be set to sync.",
    );
  }
  return { zone: STORAGE_ZONE, key: API_KEY };
}

/** Non-recursive, matching the behaviour listBunnyImages had. */
async function listFolder(folder: string): Promise<BunnyFile[]> {
  const { zone, key } = requireBunnyEnv();
  const clean = folder.replace(/^\/+|\/+$/g, "");

  const res = await fetch(`https://storage.bunnycdn.com/${zone}/${clean}/`, {
    method: "GET",
    headers: { AccessKey: key, Accept: "application/json" },
    cache: "no-store", // sync must see the folder as it is right now
  });

  if (!res.ok) {
    throw new Error(`Bunny list failed for "${clean}": ${res.status} ${res.statusText}`);
  }

  const entries: BunnyFile[] = await res.json();
  return entries
    .filter((f) => !f.IsDirectory && IMAGE_EXTENSIONS.test(f.ObjectName))
    .sort((a, b) => a.ObjectName.localeCompare(b.ObjectName, "en", { numeric: true }));
}

/**
 * Reads just enough of a file to find its dimensions, then hangs up.
 * Range is requested but not relied on — if Bunny ignores it and starts
 * sending a 30 MB PNG, the abort below stops it after PROBE_BYTES anyway.
 */
async function probeDimensions(
  storagePath: string,
): Promise<{ width: number; height: number } | null> {
  const { zone, key } = requireBunnyEnv();
  const controller = new AbortController();

  try {
    const res = await fetch(`https://storage.bunnycdn.com/${zone}/${storagePath}`, {
      headers: { AccessKey: key, Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok && res.status !== 206) return null;
    if (!res.body) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();

    while (total < PROBE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    controller.abort(); // stop the transfer if the server was sending it all

    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.byteLength;
    }

    const { width, height } = imageSize(buffer);
    return width && height ? { width, height } : null;
  } catch {
    // A photo without dimensions still renders; it just shifts layout once.
    // Not worth failing the whole sync over.
    return null;
  }
}

/**
 * Sync one gallery. Returns a report rather than throwing on per-file
 * problems, so one unreadable image does not abort the other 200.
 */
export async function syncGallery(slug: string): Promise<SyncResult> {
  const db = supabaseAdmin();

  const { data: gallery, error: galleryError } = await db
    .from("galleries")
    .select("id, slug, title, location, year, bunny_folder")
    .ilike("slug", slug.replace(/([%_\\])/g, "\\$1"))
    .limit(1)
    .maybeSingle();

  if (galleryError) throw new Error(`Supabase: ${galleryError.message}`);
  if (!gallery) throw new Error(`No gallery with slug "${slug}".`);

  const result: SyncResult = {
    slug: gallery.slug,
    folder: gallery.bunny_folder,
    filesFound: 0,
    upserted: 0,
    removed: 0,
    probed: 0,
    errors: [],
  };

  // Hand-curated galleries (greeeeen) pull from several folders and are
  // managed by hand. Syncing them from one folder would delete the rest.
  if (!gallery.bunny_folder) {
    result.skipped = "no bunny_folder set — hand-curated, left alone";
    return result;
  }

  const folder = gallery.bunny_folder.replace(/^\/+|\/+$/g, "");
  const files = await listFolder(folder);
  result.filesFound = files.length;

  // Existing rows, so we can carry dimensions forward instead of re-probing.
  const { data: existingRows, error: existingError } = await db
    .from("photos")
    .select("storage_path, width, height")
    .eq("gallery_id", gallery.id);

  if (existingError) throw new Error(`Supabase: ${existingError.message}`);

  const existing = new Map(
    (existingRows ?? []).map((r) => [r.storage_path, r]),
  );

  const rows = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const storagePath = `${folder}/${file.ObjectName}`;
    const prior = existing.get(storagePath);

    let width = prior?.width ?? null;
    let height = prior?.height ?? null;

    if (width === null || height === null) {
      const probed = await probeDimensions(storagePath);
      if (probed) {
        width = probed.width;
        height = probed.height;
        result.probed++;
      } else {
        result.errors.push(`could not read dimensions: ${storagePath}`);
      }
    }

    rows.push({
      gallery_id: gallery.id,
      storage_path: storagePath,
      alt: `${gallery.title} — photo ${i + 1} of ${files.length}, ${gallery.location} ${gallery.year}`,
      width,
      height,
      bytes: file.Length,
      sort_order: i,
    });
  }

  if (rows.length > 0) {
    // The unique index on (gallery_id, storage_path) is what makes this
    // idempotent: a re-run updates alt/sort_order/bytes in place.
    const { error } = await db
      .from("photos")
      .upsert(rows, { onConflict: "gallery_id,storage_path" });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    result.upserted = rows.length;
  }

  // Mirror deletions: a file removed from Bunny should not linger as a row
  // pointing at a 404.
  const livePaths = new Set(rows.map((r) => r.storage_path));
  const stale = [...existing.keys()].filter((p) => !livePaths.has(p));

  if (stale.length > 0) {
    const { error } = await db
      .from("photos")
      .delete()
      .eq("gallery_id", gallery.id)
      .in("storage_path", stale);

    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    result.removed = stale.length;
  }

  return result;
}

/** Every gallery that has a folder. Slow — prefer per-gallery on Vercel. */
export async function syncAllGalleries(): Promise<SyncResult[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("galleries")
    .select("slug")
    .not("bunny_folder", "is", null);

  if (error) throw new Error(`Supabase: ${error.message}`);

  const results: SyncResult[] = [];
  for (const g of data ?? []) results.push(await syncGallery(g.slug));
  return results;
}