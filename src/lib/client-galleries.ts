// src/lib/client-galleries.ts
//
// Client galleries — the delivery pages a client gets after a shoot. Same
// Supabase tables as albums.ts, distinguished by galleries.kind = 'client'.
//
// Why the same tables rather than new ones: sync-bunny.ts already mirrors a
// gallery's Bunny folder into `photos` keyed by gallery_id, and every one of
// these needs exactly that. A parallel table would mean a parallel sync, a
// parallel migration and two places to fix the next bug. The `kind` column
// carries the difference, and albums.ts filters on it so nothing new leaks
// into the portfolio.
//
// ── The one rule that makes "private" mean something ──────
// EVERY client gallery is served from the private pull zone with signed URLs,
// whatever its visibility. Client photos live under clients/, the public zone
// carries an edge rule blocking any URL containing "/clients/", and the private
// zone answers nothing without a valid token.
//
// This used to branch on visibility, and that was wrong twice over: the
// "public" branch built public-zone URLs the CDN refused outright, and making a
// dashboard column decide WHICH ZONE serves the bytes meant every flip changed
// URLs, cache entries and derivative paths. Visibility now decides exactly one
// thing — whether a passkey is required to reach the page. The zone follows
// `kind`, which never changes.
//
// Deliberately NOT cached with unstable_cache. A signed URL has a deadline
// baked into it, and caching the object that holds it would hand a visitor a
// URL that expired an hour ago. Metadata reads are cached; photo reads are not.

import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { bunnyUrl } from "./bunny-url";
import { supabaseAdmin, supabaseRead } from "./supabase";
import {
  nextExpiry,
  privateHost,
  signBunnyUrl,
  signDirectoryQuery,
  signedPhoto,
  type SignedPhoto,
} from "./bunny-sign";
import {
  derivativePrefix,
  hasLadder,
  parseTiers,
  parseVariants,
  type DownloadSizes,
  type DownloadTier,
  type LadderSources,
} from "./ladder";
import { getPhotosByPaths } from "./albums";

// Untyped clients. Kept even after regenerating database.types.ts: the picker
// query embeds a `photos(count)` aggregate, whose inferred type fights with the
// generated Row type for no benefit here. Every field is read defensively below
// anyway.
const untypedRead = () => supabaseRead() as unknown as SupabaseClient;
const untypedAdmin = () => supabaseAdmin() as unknown as SupabaseClient;

const REVALIDATE_SECONDS = 300;

export type GalleryVisibility = "public" | "private";

/** What the picker sheet on /portfolio needs, and nothing more. */
export interface GalleryListing {
  slug: string;
  /** list_label if set, else the gallery title. Private ones can be renamed
   *  here so the picker doesn't publish a client's name to the world. */
  label: string;
  visibility: GalleryVisibility;
  dateLabel: string;
  photoCount: number;
  /** Public galleries only. Private tiles render a lock instead — see below. */
  cover: string | null;
  accentColor: string;
  expired: boolean;
}

export interface ClientGallery {
  id: string;
  slug: string;
  title: string;
  dateLabel: string;
  location: string;
  year: string;
  description: string;
  clientNote: string | null;
  /** Raw storage path. Resolved to a URL by getGalleryContent(), because for a
   *  private gallery the cover needs signing and expiring like everything
   *  else — a hero image that 403s is just as broken as a grid that does. */
  coverPath: string | null;
  accentColor: string;
  photographerHandle: string;
  visibility: GalleryVisibility;
  downloadEnabled: boolean;
  /**
   * Which tiers this gallery hands over — share, full, original.
   *
   * Separate from downloadEnabled, which is the off switch for the whole
   * feature. This says what may be taken when taking is allowed, and it is how
   * originals stay something you grant per client rather than a property of
   * the software. Validated by parseTiers(), which falls back to the default
   * rather than to "everything" when the column is malformed.
   */
  downloadTiers: DownloadTier[];
  expiresAt: string | null;
  photoCount: number;
}

export interface GalleryContent {
  photos: SignedPhoto[];
  /** Falls back to the first photo when no cover_path is set, because
   *  AlbumView's hero always renders an image. */
  cover: string | null;
  /** The hero's derivatives, signed by the same gallery token as everything
   *  else. See the note on AlbumData.coverLadder — the hero is the page's LCP
   *  and was the last thing still going through the Optimizer. */
  coverLadder?: LadderSources;
  coverThumbhash?: string;
  /** Unix seconds. Always set now: every client gallery is signed. */
  signedUntil: number | null;
}

function isExpired(expiresAt: string | null): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
}

function visibilityOf(raw: string): GalleryVisibility {
  // Anything that isn't explicitly public is treated as private. Failing
  // closed matters more here than honouring a typo in a column.
  return raw === "public" ? "public" : "private";
}

// ---------------------------------------------------------------------------
// The picker index
// ---------------------------------------------------------------------------

/**
 * Every client gallery worth showing in the picker.
 *
 * `is_listed = false` hides a gallery from the list while leaving it reachable
 * by direct link — which is what you want for anything sensitive, or for a
 * gallery you've handed to one person over Telegram and nobody else.
 *
 * Note what is NOT returned for private galleries: no cover, no title unless
 * you set list_label, no photo paths. A stranger opening the sheet learns that
 * a private gallery exists and roughly when it was shot. That is the most a
 * picker can show without becoming a leak.
 *
 * Reads with the SERVICE key, not the anon key. Your RLS policy is
 * `is_published AND visibility = 'public'`, which is stricter than this needs —
 * with the anon key the private rows are invisible and the "Private gallery"
 * sheet comes up empty. The columns selected below are the safe ones; the
 * photo paths and the passkey are not among them.
 */
export const getGalleryIndex = unstable_cache(
  async (): Promise<GalleryListing[]> => {
    // ONE string literal, never a concatenation. supabase-js parses this at the
    // TYPE level, and its parser only understands literals — a `"a, b" + "c"`
    // widens to plain `string`, the parser gives up, and every field on the
    // result comes back as GenericStringError. Keep it on one line even when
    // it is long.
    const { data, error } = await untypedAdmin()
      .from("galleries")
      .select("slug, title, list_label, list_cover_path, cover_path, visibility, date_label, accent_color, expires_at, photos(count)")
      .eq("kind", "client")
      .eq("is_published", true)
      .eq("is_listed", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Supabase: failed to load client galleries: ${error.message}`);
    }

    // Resolve the nominated covers through the photos table so the picker uses
    // the ladder too. Anything that does not resolve — a path outside every
    // synced folder — falls back to a plain CDN URL, which after the Optimizer
    // is switched off means a full-size original. Point list_cover_path at a
    // photograph that is actually in an album.
    const coverPaths = (data ?? [])
      .map((r) => r.list_cover_path as string | null)
      .filter((p): p is string => Boolean(p));
    const coverPhotos = await getPhotosByPaths(coverPaths);

    return (data ?? []).map((row) => {
      const visibility = visibilityOf(row.visibility);

      // ONLY list_cover_path, for every client gallery regardless of
      // visibility — and that path must live OUTSIDE /clients/.
      //
      // Two reasons it can never be cover_path. The public zone blocks any URL
      // containing "/clients/", so a cover inside it is refused. And this
      // function is wrapped in unstable_cache: a signed URL cached for five
      // minutes would be handed to visitors long after it expired, and a signed
      // URL is exactly what a cover inside clients/ would have to be.
      //
      // Leave list_cover_path null and the tile renders a lock, which is the
      // safe default — a stranger opening the picker learns only that a gallery
      // exists and roughly when it was shot.
      const coverPath = row.list_cover_path as string | null;

      return {
        slug: row.slug,
        label: (row.list_label as string | null) || row.title,
        visibility,
        dateLabel: row.date_label ?? "",
        photoCount: Array.isArray(row.photos) ? (row.photos[0]?.count ?? 0) : 0,
        cover: coverPath
          ? (() => {
              const photo = coverPhotos[coverPath];
              return hasLadder(photo?.ladder)
                ? `${photo.ladder.base}/480.webp${photo.ladder.query}`
                : bunnyUrl(coverPath, { width: 480 });
            })()
          : null,
        accentColor: row.accent_color ?? "#2a2f36",
        expired: isExpired(row.expires_at as string | null),
      };
    });
  },
  ["client-gallery-index"],
  { revalidate: REVALIDATE_SECONDS, tags: ["client-galleries"] },
);

// ---------------------------------------------------------------------------
// One gallery
// ---------------------------------------------------------------------------

/**
 * Metadata for one gallery. No photos — the caller decides whether the visitor
 * has earned those.
 *
 * Reads with the service key. Row-level security would otherwise have to be
 * loose enough for the anon key to see private rows, and there is no reason to
 * widen it: nothing here runs anywhere but the server.
 */
export async function getClientGallery(
  slug: string,
): Promise<ClientGallery | undefined> {
  // ILIKE treats % and _ as wildcards and slugs contain _, so escape first —
  // same reasoning as fetchAlbumBySlug in albums.ts.
  const pattern = slug.replace(/([%_\\])/g, "\\$1");

  const { data, error } = await untypedAdmin()
    .from("galleries")
    .select("*, photos(count)")
    .eq("kind", "client")
    .eq("is_published", true)
    .ilike("slug", pattern)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase: failed to load gallery "${slug}": ${error.message}`);
  }
  if (!data) return undefined;

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    dateLabel: data.date_label ?? "",
    location: data.location ?? "",
    year: data.year ?? "",
    description: data.description ?? "",
    clientNote: (data.client_note as string | null) ?? null,
    coverPath: (data.cover_path as string | null) ?? null,
    accentColor: data.accent_color ?? "#2a2f36",
    photographerHandle: data.photographer_handle ?? "saycheeeeeze",
    visibility: visibilityOf(data.visibility),
    downloadEnabled: data.download_enabled !== false,
    downloadTiers: parseTiers(data.download_tiers),
    expiresAt: (data.expires_at as string | null) ?? null,
    photoCount: Array.isArray(data.photos) ? (data.photos[0]?.count ?? 0) : 0,
  };
}

/**
 * The photos themselves, with URLs built for whichever pull zone this
 * gallery's visibility calls for.
 *
 * Call this only after establishing that the visitor is allowed in. It does
 * not check the cookie — that is the page's job, and keeping the check in one
 * obvious place is worth more than a second one buried down here.
 */
export async function getGalleryContent(
  gallery: ClientGallery,
): Promise<GalleryContent> {
  const { data, error } = await untypedAdmin()
    .from("photos")
    .select("storage_path, alt, sort_order, id, width, height, file_name, checksum8, thumbhash, variants, ladder_rev, share_bytes, delivery_bytes, source_bytes")
    .eq("gallery_id", gallery.id)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(
      `Supabase: failed to load photos for "${gallery.slug}": ${error.message}`,
    );
  }

  const rows = [...(data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id)),
  );

  const coverPath = gallery.coverPath ?? rows[0]?.storage_path ?? null;

  // The row the cover came from, so the hero can use the ladder too. rows is
  // already sorted, so rows[0] is the same photo the cover falls back to.
  const heroRow = coverPath
    ? rows.find((r) => r.storage_path === coverPath) ?? undefined
    : undefined;

  // ── Client galleries are ALWAYS served from the private zone ──
  //
  // This used to branch on visibility: public ones went through bunnyUrl() to
  // the public zone, private ones were signed. That was broken in two ways.
  //
  // It did not work. Every client photo lives under clients/, and the public
  // pull zone carries an edge rule blocking any URL containing "/clients/", so
  // the "public" branch produced URLs the CDN refused outright.
  //
  // And it was the wrong shape. Visibility is a column you flip from a
  // dashboard; making it decide WHICH ZONE serves the bytes means every flip is
  // a change of URL, of cache entry, and of derivative path. Visibility now
  // decides one thing only — whether a passkey is required to reach this page —
  // and the zone follows `kind`, which never changes.
  //
  // One deadline shared by every URL on the page, so they lapse together and
  // the refresher has a single number to watch.
  const expiresAt = nextExpiry();

  // ONE token for the whole gallery. Signing per file would mean one per width
  // per format — sixteen for a single photo, thousands for a real gallery.
  // Every derivative under this prefix is covered by the same query string.
  const ladderQuery = signDirectoryQuery(`clients/_d/${gallery.id}/`, expiresAt);
  const host = privateHost();

  /**
   * Bytes per tier, straight off the row.
   *
   * A number or nothing — never a zero. The chooser renders an unknown size as
   * "—" and a known one as "4.2 MB"; a coerced 0 would render as "0 B" next to
   * a 30 MB file, which is worse than admitting we do not know. Photos synced
   * before the download-tiers migration legitimately have all three null.
   */
  function sizesOf(row: {
    share_bytes?: number | null;
    delivery_bytes?: number | null;
    source_bytes?: number | null;
  }): DownloadSizes {
    const n = (v: unknown) => (typeof v === "number" ? v : undefined);
    return {
      share: n(row.share_bytes),
      full: n(row.delivery_bytes),
      original: n(row.source_bytes),
    };
  }

  function ladderFor(row: {
    id: string;
    checksum8?: string | null;
    variants?: unknown;
    ladder_rev?: number | null;
  }): LadderSources | undefined {
    const variants = parseVariants(row.variants);
    if (!row.checksum8 || variants.length === 0) return undefined;
    return {
      base: `${host}/${derivativePrefix("client", gallery.id, row.id, row.checksum8, row.ladder_rev ?? 1)}`,
      widths: variants.map((v) => v.w),
      query: ladderQuery,
    };
  }

  return {
    photos: rows.map((p) => ({
      ...signedPhoto(p.storage_path, p.alt, expiresAt, {
        width: p.width,
        height: p.height,
        fileName: p.file_name,
        sizes: sizesOf(p),
      }),
      ladder: ladderFor(p),
      thumbhash: (p.thumbhash as string | null) ?? undefined,
    })),
    cover: coverPath ? signBunnyUrl(coverPath, { expiresAt }) : null,
    coverLadder: heroRow ? ladderFor(heroRow) : undefined,
    coverThumbhash: (heroRow?.thumbhash as string | null) ?? undefined,
    signedUntil: expiresAt,
  };
}

/** Slugs for a sitemap or a build step. Public, listed, unexpired only. */
export const getPublicGallerySlugs = unstable_cache(
  async (): Promise<string[]> => {
    const { data, error } = await untypedRead()
      .from("galleries")
      .select("slug")
      .eq("kind", "client")
      .eq("is_published", true)
      .eq("is_listed", true)
      .eq("visibility", "public");

    if (error) throw new Error(`Supabase: failed to load gallery slugs: ${error.message}`);
    return (data ?? []).map((r) => r.slug);
  },
  ["client-gallery-slugs"],
  { revalidate: REVALIDATE_SECONDS, tags: ["client-galleries"] },
);