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
import type { PhotoMark } from "./photo-marks";
import {
  getExcludeManifest,
  isAlbumHidden,
  isPhotoExcluded,
  type ExcludeManifest,
} from "./bunny";
import { supabaseRead, withRetry } from "./supabase";
import {
  derivativePrefix,
  parseVariants,
  type DownloadSizes,
  type LadderSources,
} from "./ladder";
import type { Database } from "./database.types";

// Public shapes — unchanged from the hardcoded version.

export interface AlbumPhoto {
  src: string;
  /**
   * The `photos` row id. THE stable handle for one photograph.
   *
   * Everything else here changes: `src` on a client gallery is a signed URL
   * that is re-issued every six hours, which is exactly why selection — keyed
   * on src — quietly loses its selection across a refresh. Anything that has to
   * survive that, like a client's mark, is keyed on this.
   *
   * Optional because portfolio albums have never needed it.
   */
  id?: string;
  alt?: string;
  thumbSrc?: string;
  /**
   * Intrinsic pixel dimensions, so PhotoGrid packs columns from real aspect
   * ratios on the first render instead of assuming 3:2 and re-flowing.
   * Optional — an unprobed photo falls back to that assumption.
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
  /**
   * What the client asked be done with this photograph — client galleries only.
   *
   * Advisory. Nothing in the app acts on it; see src/lib/photo-marks.ts.
   * `undefined` means this photograph came from a surface that has no marks
   * (a portfolio album); `null` means it has one and it is unset.
   */
  mark?: PhotoMark | null;
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

// Row → app shape

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

// Curation
//
// portfolio-exclude.json is the one place that says what the public sees, and
// it has to be applied on EVERY surface or it means nothing: hiding a tile
// while /albums/that-slug still serves the photographs is not hiding it, and
// dropping a photograph from the grid while its album page still shows it is
// not dropping it. So every read below consults the manifest.
//
// See src/lib/bunny.ts — the manifest lives in the Bunny storage zone, not in
// this repo, and scripts/portfolio-exclude.mjs is how it gets edited.

type HasPath = { storage_path: string };

/** Drop every photograph the manifest hides. */
function curate<T extends HasPath>(rows: T[], manifest: ExcludeManifest): T[] {
  return rows.filter((row) => !isPhotoExcluded(row.storage_path, manifest));
}

/**
 * An album whose cover you just hid must not keep showing it on its tile.
 * Falls back to the first surviving photograph, and to nothing when there is
 * none — which only happens on an album that is about to be dropped anyway.
 */
function coverAfterCuration(
  coverPath: string | null,
  visible: HasPath[],
  manifest: ExcludeManifest,
): string | null {
  if (!coverPath) return null;
  if (!isPhotoExcluded(coverPath, manifest)) return coverPath;
  return visible[0]?.storage_path ?? null;
}

// Reads
//
// Errors throw rather than returning empty. A build that silently produces a
// photography site with zero galleries is worse than a build that fails.
// "Not found" is different from "query broke" and still returns undefined.

async function fetchAlbumBySlug(slug: string): Promise<AlbumData | undefined> {
  // Case-insensitive so /albums/wiut resolves the same gallery as /albums/WIUT.
  // ILIKE treats % and _ as wildcards and slugs may contain _, so escape first.
  const pattern = slug.replace(/([%_\\])/g, "\\$1");

  const [manifest, { data, error }] = await Promise.all([
    getExcludeManifest(),
    supabaseRead()
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
      .maybeSingle(),
  ]);

  if (error) throw new Error(`Supabase: failed to load album "${slug}": ${error.message}`);
  if (!data) return undefined;

  const { photos, ...gallery } = data;

  // A hidden album returns undefined, which the page turns into a 404. Anything
  // less and the tile is off the Portfolio while the URL still works — and that
  // URL is in the sitemap, in Google, and in whatever link you sent someone.
  if (gallery.is_published === false) return undefined;
  if (isAlbumHidden({ slug: gallery.slug, folder: gallery.bunny_folder }, manifest)) {
    return undefined;
  }

  // Annotated, not inferred: `photos ?? []` widens enough that curate()'s type
  // parameter falls back to its HasPath constraint and the result stops being
  // assignable to toAlbum(). Saying PhotoRow here keeps every photo column.
  const all: PhotoRow[] = photos ?? [];
  const visible = curate(all, manifest);

  // Every photograph excluded = there is no album left to look at. 404 rather
  // than an empty page. Guarded on `all.length` so a genuinely photo-less
  // hand-curated gallery behaves exactly as it did before.
  if (all.length > 0 && visible.length === 0) return undefined;

  gallery.cover_path = coverAfterCuration(gallery.cover_path, visible, manifest);
  return toAlbum(gallery, visible);
}

/**
 * One album, or undefined when there is no such album.
 *
 * Retries, but still THROWS when the database stays unreachable — unlike the
 * list queries, which fall back to empty. Returning undefined here means
 * notFound(), and a 404 cached for an album that exists is worse than a loud
 * failure: the build stopping is noticed in a minute, a client getting "not
 * found" on the link you sent them might not be for days.
 *
 * The retry is what makes that stance affordable. generateMetadata calls this
 * once per album per locale, so on a cold database any one of ~54 calls could
 * take the whole deploy down; scripts/warm-supabase.mjs waits for the database
 * before the build starts, and this covers whatever slips past it.
 */
export async function getAlbumBySlug(slug: string): Promise<AlbumData | undefined> {
  const key = slug.toLowerCase();
  const load = unstable_cache(() => fetchAlbumBySlug(slug), ["album", key], {
    revalidate: REVALIDATE_SECONDS,
    tags: ["albums", `album:${key}`],
  });
  return withRetry("albums", load);
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
      const [manifest, { data, error }] = await Promise.all([
        getExcludeManifest(),
        supabaseRead()
          .from("galleries")
          .select("slug, bunny_folder, is_published")
          .eq("kind", "album")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
      ]);

      if (error) throw new Error(error.message);
      // Hidden albums leave the sitemap and stop being prerendered. The route
      // still exists and still 404s — this just stops us advertising it to
      // Google and building a page we intend to refuse.
      return (data ?? [])
        .filter((r) => r.is_published !== false)
        .filter((r) => !isAlbumHidden({ slug: r.slug, folder: r.bunny_folder }, manifest))
        .map((r) => r.slug);
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
 * The card grids read cover/title/color/slug plus a photo count.
 *
 * This used to ask for `photos(count)` and ship one integer per album. It now
 * asks for `photos(storage_path)` instead, because a count Postgres computes
 * cannot have the manifest applied to it: an album with nine hidden photographs
 * advertised "24 photos" and showed 15. Paths are the cheapest thing that can
 * be filtered — no dimensions, no ThumbHash, no ladder columns — and they also
 * tell us when an album has nothing visible left, which is what makes
 * `"Portraits/*"` remove the tile on its own.
 *
 * Caveat worth knowing: if an album ever exceeds PostgREST's row limit the
 * embedded array truncates and the count goes low. At a few hundred photographs
 * per album that is not close.
 */
const loadAllAlbums = unstable_cache(
  async (): Promise<AlbumData[]> => {
    const [manifest, { data, error }] = await Promise.all([
      getExcludeManifest(),
      supabaseRead()
        .from("galleries")
        .select("*, photos(storage_path)")
        .eq("kind", "album")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
    ]);

    if (error) throw new Error(`Supabase: failed to load albums: ${error.message}`);

    const out: AlbumData[] = [];
    for (const row of data ?? []) {
      const { photos, ...gallery } = row;

      if (gallery.is_published === false) continue;
      if (isAlbumHidden({ slug: gallery.slug, folder: gallery.bunny_folder }, manifest)) continue;

      const all = Array.isArray(photos) ? photos : [];
      const visible = curate(all, manifest);
      // Nothing left to show → no tile. An album emptied by curation and an
      // album whose folder you hid should look the same from out here.
      if (all.length > 0 && visible.length === 0) continue;

      gallery.cover_path = coverAfterCuration(gallery.cover_path, visible, manifest);
      out.push(toAlbum(gallery, [], visible.length));
    }
    return out;
  },
  ["albums-all"],
  { revalidate: REVALIDATE_SECONDS, tags: ["albums"] },
);

/**
 * Every album, or an empty list if the database cannot be reached.
 *
 * Empty rather than a throw because this feeds prerendered pages, and a
 * prerendered page whose data fetch throws does not degrade — it fails the
 * whole deploy. An About page with no album shelf is a missing section; a
 * build that will not run is a site that cannot ship. Nothing is cached on the
 * failure path, so the next request retries rather than serving an empty shelf
 * for the rest of the revalidate window.
 */
export async function getAllAlbums(): Promise<AlbumData[]> {
  try {
    return await withRetry("albums", loadAllAlbums);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`[albums] Could not load albums, rendering without them: ${why}`);
    return [];
  }
}

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
 * The portfolio grid, read from the database rather than by listing storage —
 * a URL carries nothing with it, so a listing left the portfolio with no
 * dimensions, no ThumbHash and no ladder.
 *
 * Curation is unchanged: portfolio-exclude.json decides what is hidden and what
 * the categories are called, and the category is the top-level storage folder.
 */
const loadPortfolioPhotos = unstable_cache(
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

      // Same rules the storage walk applied, now against a path we already
      // have — and the same single call every other surface makes, so a folder,
      // a `Folder/*` and a single file behave identically everywhere.
      if (isPhotoExcluded(path, manifest)) continue;

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

/** Every portfolio photo, or an empty list if the database cannot be reached.
 *  See getAllAlbums() for why this is not a throw. */
export async function getPortfolioPhotos(): Promise<PortfolioPhoto[]> {
  try {
    return await withRetry("albums", loadPortfolioPhotos);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`[albums] Could not load portfolio photos: ${why}`);
    return [];
  }
}

/**
 * Storage paths → full photo records, keyed by path. For pages that pick
 * photographs by hand: the About strip, works grid and service cards.
 *
 * Hold paths, never URLs. A URL cannot be looked up, so anything holding one
 * loses dimensions, ThumbHash and ladder.
 *
 * A path with no row is absent from the result rather than an error, and the
 * caller falls back to a plain CDN URL. Five About-page paths currently point
 * at files that do not exist — see about/photos.ts.
 */
const loadPhotosByPaths = unstable_cache(
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
 * Storage paths to photo records, or an empty map if the database cannot be
 * reached. The callers already treat an absent path as "fall back to a plain
 * CDN URL", so an empty map costs the ladder and the ThumbHash — the
 * photographs still render.
 */
export async function getPhotosByPaths(
  paths: string[],
): Promise<Record<string, AlbumPhoto>> {
  try {
    return await withRetry("albums", () => loadPhotosByPaths(paths));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`[albums] Could not resolve photo paths: ${why}`);
    return {};
  }
}

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