// src/lib/albums.ts
//
// Supabase is the source of truth for album and photo METADATA. Bunny still
// stores and serves the bytes — every column holds a storage path, and
// bunnyUrl() turns it into a CDN URL at read time. Changing pull zone or CDN
// hostname is an env change, not a data migration.
//
// This module is now server-only. It used to be imported directly by
// AboutContent and PortfolioContent; those receive albums as props instead.
// Note the import below is `./bunny-url`, not `./bunny` — that finally settles
// the client-bundle problem described at the top of bunny.ts.

import "server-only";
import { unstable_cache } from "next/cache";

import { bunnyUrl } from "./bunny-url";
import { getExcludeManifest, isPathExcluded } from "./bunny";
import { supabaseRead } from "./supabase";
import {
  derivativePrefix,
  parseVariants,
  type DownloadSizes,
  type LadderSources,
} from "./ladder";
import type { Database } from "./database.types";

// ---------------------------------------------------------------------------
// Public shapes — unchanged from the hardcoded version.
// ---------------------------------------------------------------------------

export interface AlbumPhoto {
  src: string;
  alt?: string;
  thumbSrc?: string;
  /**
   * Intrinsic pixel dimensions, straight from the `photos` row.
   *
   * These have been sitting in the database since the first sync and nothing
   * read them. Carrying them into the client lets PhotoGrid pack its columns
   * from real aspect ratios on the FIRST render, before a single image byte
   * is requested — instead of assuming 3:2 for everything and re-flowing the
   * whole grid as photos trickle in.
   *
   * Optional because a photo whose dimensions could not be probed still has
   * to render; PhotoGrid falls back to the old assumption per-photo.
   */
  width?: number;
  height?: number;
  /** Bytes per download tier, so the chooser can price each option. */
  sizes?: DownloadSizes;
  /**
   * The real filename ("3M0A1432.png"), needed because it cannot be recovered
   * from the URL. gallery.ts currently parses it out of the src, which works
   * today and stops working the moment derivative URLs end in "/2048.avif".
   */
  fileName?: string;
  /** Pre-generated derivatives. Absent = fall back to src/thumbSrc. */
  ladder?: LadderSources;
  /** ThumbHash, base64 — the inline placeholder. */
  thumbhash?: string;
}

export interface AlbumData {
  slug: string;
  title: string;
  date: string;
  location: string;
  year: string;
  description: string;
  cover: string;
  color: string;
  photographerHandle: string;
  photos: AlbumPhoto[];
  /**
   * The hero's derivatives, when the cover corresponds to a photo we have a
   * ladder for.
   *
   * `cover` is only ever a URL string, with no link back to the row it came
   * from — so without this the hero was the one image on the page still going
   * through the Optimizer, and it is the page's Largest Contentful Paint.
   */
  coverLadder?: LadderSources;
  coverThumbhash?: string;
  folder?: string;
  /** Total photos in the gallery. Populated even when `photos` is empty, so
   *  card grids can show "12 photos" without loading 12 rows. */
  photoCount: number;
}

type GalleryRow = Database["public"]["Tables"]["galleries"]["Row"];

/**
 * Exactly the photo columns the album query asks for.
 *
 * Not the full Row type any more: the select below is an explicit column list
 * so the worker's operational columns stop reaching the browser, and the
 * inferred result would no longer satisfy Row. Keeping this in step with that
 * select is the point — drop a column there and this stops compiling.
 */
type PhotoRow = Pick<
  Database["public"]["Tables"]["photos"]["Row"],
  | "id"
  | "gallery_id"
  | "storage_path"
  | "file_name"
  | "alt"
  | "width"
  | "height"
  | "aspect_ratio"
  | "bytes"
  | "taken_at"
  | "sort_order"
  | "created_at"
  | "checksum8"
  | "thumbhash"
  | "variants"
  | "ladder_rev"
  | "share_bytes"
  | "delivery_bytes"
  | "source_bytes"
>;

/** Time-based backstop. On-demand revalidateTag is the real refresh path. */
const REVALIDATE_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Row → app shape
// ---------------------------------------------------------------------------

const PUBLIC_CDN = (process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE ?? "").replace(/\/$/, "");

/**
 * Album derivatives, when the worker has built them.
 *
 * No signing: albums are public by definition and live at d/… on the public
 * zone, so `query` is empty and every URL is a plain immutable static file —
 * which is the entire point of the ladder. Client galleries take the signed
 * path in client-galleries.ts instead.
 */
function ladderFor(p: PhotoRow, galleryId: string): LadderSources | undefined {
  const variants = parseVariants(p.variants);
  if (!p.checksum8 || variants.length === 0 || !PUBLIC_CDN) return undefined;
  return {
    base: `${PUBLIC_CDN}/${derivativePrefix("album", galleryId, p.id, p.checksum8, p.ladder_rev)}`,
    widths: variants.map((v) => v.w),
    query: "",
  };
}

function toPhoto(p: PhotoRow): AlbumPhoto {
  return {
    src: bunnyUrl(p.storage_path),
    alt: p.alt ?? undefined,
    width: p.width ?? undefined,
    height: p.height ?? undefined,
    fileName: p.file_name ?? undefined,
    ladder: ladderFor(p, p.gallery_id),
    thumbhash: p.thumbhash ?? undefined,
    // A number or nothing, never a coerced 0 — see sizesOf() in
    // client-galleries.ts. "0 B" beside a 30 MB file reads as a fact.
    sizes: {
      share: p.share_bytes ?? undefined,
      full: p.delivery_bytes ?? undefined,
      original: p.source_bytes ?? undefined,
    },
  };
}

function toAlbum(g: GalleryRow, photos: PhotoRow[], count?: number): AlbumData {
  const ordered = [...photos].sort(
    (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );

  // Match the cover back to its row so the hero can use the ladder too. When
  // cover_path is null the first photo is what the hero falls back to anyway,
  // so it is the right row to take derivatives from.
  const heroRow = g.cover_path
    ? ordered.find((p) => p.storage_path === g.cover_path)
    : ordered[0];

  return {
    slug: g.slug,
    title: g.title,
    date: g.date_label,
    location: g.location,
    year: g.year,
    description: g.description,
    cover: g.cover_path ? bunnyUrl(g.cover_path) : "",
    color: g.accent_color,
    photographerHandle: g.photographer_handle,
    folder: g.bunny_folder ?? undefined,
    coverLadder: heroRow ? ladderFor(heroRow, heroRow.gallery_id) : undefined,
    coverThumbhash: heroRow?.thumbhash ?? undefined,
    // Sorted above rather than in the query so this doesn't depend on which
    // spelling of the nested-order option your supabase-js minor uses.
    photos: ordered.map(toPhoto),
    photoCount: count ?? photos.length,
  };
}

// ---------------------------------------------------------------------------
// Reads
//
// Errors throw rather than returning empty. A build that silently produces a
// photography site with zero galleries is worse than a build that fails.
// "Not found" is different from "query broke" and still returns undefined.
// ---------------------------------------------------------------------------

async function fetchAlbumBySlug(slug: string): Promise<AlbumData | undefined> {
  // Case-insensitive so /albums/wiut resolves the same gallery as /albums/WIUT.
  // ILIKE treats % and _ as wildcards and slugs may contain _, so escape first.
  const pattern = slug.replace(/([%_\\])/g, "\\$1");

  const { data, error } = await supabaseRead()
    .from("galleries")
    // Explicit column list rather than photos(*), because photos is readable
    // by the anon role and photos(*) shipped the worker's operational columns —
    // status, attempts, claimed_at and the error text — to every browser that
    // opened an album page. One string literal: supabase-js parses this at the
    // type level and its parser only understands literals.
    .select("*, photos(id, gallery_id, storage_path, file_name, alt, width, height, aspect_ratio, bytes, taken_at, sort_order, created_at, checksum8, thumbhash, variants, ladder_rev, share_bytes, delivery_bytes, source_bytes)")
    .eq("kind", "album")  
    .ilike("slug", pattern)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Supabase: failed to load album "${slug}": ${error.message}`);
  if (!data) return undefined;

  const { photos, ...gallery } = data;
  return toAlbum(gallery, photos ?? []);
}

/**
 * NOW ASYNC. Was synchronous when albumsData was a local array.
 * Call sites that changed: albums/[slug]/page.tsx lines 20 and 51.
 */
export async function getAlbumBySlug(slug: string): Promise<AlbumData | undefined> {
  const key = slug.toLowerCase();
  return unstable_cache(() => fetchAlbumBySlug(slug), ["album", key], {
    revalidate: REVALIDATE_SECONDS,
    tags: ["albums", `album:${key}`],
  })();
}

/**
 * NOW ASYNC. Call sites that changed: albums/[slug]/page.tsx line 9
 * (generateStaticParams) and sitemap.ts line 47.
 */
export const getAllAlbumSlugs = unstable_cache(
  async (): Promise<string[]> => {
    // This one does NOT throw, unlike every other read in this file.
    //
    // Its only callers are generateStaticParams() and sitemap(), and a throw
    // there fails the whole build — a Supabase blip or a rotated key turns a
    // deploy into a red deploy. Returning [] instead means the album routes are
    // simply rendered on demand rather than prerendered, which is a slower
    // first hit and nothing worse. The page-level reads below still throw,
    // because a page that renders with no photographs IS worth failing on.
    try {
      const { data, error } = await supabaseRead()
        .from("galleries")
        .select("slug")
        .eq("kind", "album")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.slug);
    } catch (e) {
      console.warn(
        `[albums] Could not prerender album slugs, falling back to on-demand rendering: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return [];
    }
  },
  ["album-slugs"],
  { revalidate: REVALIDATE_SECONDS, tags: ["albums"] },
);

/**
 * Replaces the exported `albumsData` array for card grids.
 *
 * Returns metadata only — `photos` is always [], but `photoCount` is real.
 * The card grids read cover/title/color/slug plus a photo count, so this asks
 * Postgres to COUNT the rows instead of shipping them. `photos(count)` is a
 * PostgREST aggregate on the embedded table; RLS still applies to it, so
 * unpublished galleries are not counted.
 */
export const getAllAlbums = unstable_cache(
  async (): Promise<AlbumData[]> => {
    const { data, error } = await supabaseRead()
      .from("galleries")
      .select("*, photos(count)")
      .eq("kind", "album")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Supabase: failed to load albums: ${error.message}`);

    return (data ?? []).map((row) => {
      const { photos, ...gallery } = row;
      const count = Array.isArray(photos) ? (photos[0]?.count ?? 0) : 0;
      return toAlbum(gallery, [], count);
    });
  },
  ["albums-all"],
  { revalidate: REVALIDATE_SECONDS, tags: ["albums"] },
);

/*
 * getAllPhotoSrcs() lived here and returned a flat list of bunnyUrl() strings.
 * Deleted 2026-09-02 along with its last caller.
 *
 * It is worth saying why rather than just removing it: a function that hands
 * back URLs instead of rows is a one-way door. Everything downstream loses the
 * dimensions, the ThumbHash and the derivative ladder, and the only way to
 * render the result is to ask the Optimizer to resize a full-size original.
 * getPortfolioPhotos() returns the rows instead.
 */

/** A portfolio tile: everything AlbumPhoto has, plus how it is filtered. */
export interface PortfolioPhoto extends AlbumPhoto {
  /** Top-level folder — "WIUT", "Portraits" — or "Other" for root files. */
  category: string;
  /** In a category hidden by portfolio-exclude.json. */
  hidden: boolean;
}

/**
 * The portfolio grid, from the database rather than a live storage listing.
 *
 * listAllBunnyImages() walked the whole zone on every render and returned bare
 * URL strings. That cost one storage API call per folder before the page could
 * paint, and — because a URL carries nothing with it — left the portfolio as
 * the last surface with no stored dimensions, no ThumbHash and no ladder, still
 * resizing every tile through the Optimizer. It is the reason the Optimizer
 * could not be switched off.
 *
 * Curation is unchanged: portfolio-exclude.json still decides what is hidden
 * and what the categories are called, and the category is still the top-level
 * folder of the storage path. Only the source of the photo LIST moved.
 */
export const getPortfolioPhotos = unstable_cache(
  async (): Promise<PortfolioPhoto[]> => {
    const [manifest, { data, error }] = await Promise.all([
      getExcludeManifest(),
      supabaseRead()
        .from("photos")
        .select("id, gallery_id, storage_path, file_name, alt, width, height, aspect_ratio, bytes, taken_at, sort_order, created_at, checksum8, thumbhash, variants, ladder_rev, share_bytes, delivery_bytes, source_bytes, galleries!inner(kind)")
        .eq("galleries.kind", "album")
        .order("sort_order", { ascending: true }),
    ]);

    if (error) {
      throw new Error(`Supabase: failed to load portfolio photos: ${error.message}`);
    }

    const out: PortfolioPhoto[] = [];
    for (const row of data ?? []) {
      const path = row.storage_path;

      // Same rules the storage walk applied, now against a path we already have.
      if (isPathExcluded(path, manifest.excludedFolders)) continue;
      if (manifest.excludedFiles.includes(path)) continue;

      // "Portraits/Sara/3M0A1432.png" → "Portraits". A file at the root has no
      // folder to be grouped under, which is what "Other" is for.
      const slash = path.indexOf("/");
      const rawCategory = slash === -1 ? "Other" : path.slice(0, slash);

      out.push({
        ...toPhoto(row),
        category: manifest.categoryLabels[rawCategory] ?? rawCategory,
        hidden: manifest.hiddenCategories.includes(rawCategory),
      });
    }
    return out;
  },
  ["portfolio-photos"],
  { revalidate: REVALIDATE_SECONDS, tags: ["albums"] },
);

/**
 * Resolves storage paths to full photo records, keyed by path.
 *
 * For pages that pick out particular photographs by hand — the About page's
 * featured strip, works grid and service cards. Those used to hold
 * bunnyUrl('...') results, which is a one-way door: a URL cannot be looked up,
 * so those images had no stored dimensions, no ThumbHash and no ladder. Holding
 * the PATH instead means everything the database knows about the photo comes
 * along with it, and PhotoGrid and Lightbox already know what to do with that.
 *
 * A path with no row is simply absent from the result rather than an error —
 * the caller falls back to a plain CDN URL, which is exactly what it had
 * before. Five of the About page's paths currently point at files that do not
 * exist; see the note in about/photos.ts.
 */
export const getPhotosByPaths = unstable_cache(
  async (paths: string[]): Promise<Record<string, AlbumPhoto>> => {
    if (paths.length === 0) return {};

    const { data, error } = await supabaseRead()
      .from("photos")
      // Same explicit column list as the album query, and for the same reason.
      .select("id, gallery_id, storage_path, file_name, alt, width, height, aspect_ratio, bytes, taken_at, sort_order, created_at, checksum8, thumbhash, variants, ladder_rev, share_bytes, delivery_bytes, source_bytes")
      .in("storage_path", paths);

    if (error) {
      throw new Error(`Supabase: failed to resolve photo paths: ${error.message}`);
    }

    const byPath: Record<string, AlbumPhoto> = {};
    for (const row of data ?? []) byPath[row.storage_path] = toPhoto(row);
    return byPath;
  },
  ["photos-by-path"],
  { revalidate: REVALIDATE_SECONDS, tags: ["albums"] },
);

/**
 * SIGNATURE UNCHANGED — `await getAlbumPhotos(album)` still works as-is,
 * so albums/[slug]/page.tsx line 56 needs no edit.
 *
 * The Bunny listing that used to happen here on every render is gone. Photos
 * now arrive already joined by getAlbumBySlug, and the sync job is what keeps
 * them in step with the storage folder. The fallback below only fires if you
 * hand this an album from getAllAlbums(), which carries no photos.
 */
export async function getAlbumPhotos(album: AlbumData): Promise<AlbumPhoto[]> {
  if (album.photos.length > 0) return album.photos;
  const full = await getAlbumBySlug(album.slug);
  return full?.photos ?? [];
}