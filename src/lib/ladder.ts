// The derivative ladder, described once.
//
// Pure functions and constants, no secrets — PhotoGrid and the lightbox build
// srcsets in the browser. Anything needing the token key is in bunny-sign.ts.
//
// scripts/build-ladder.mjs writes the files these URLs point at. The two agree
// on the path layout by hand, not by shared code (a node script cannot import
// from the Next app). Change the layout in one and you must change the other.

import type React from "react";
import { thumbHashToDataURL } from "thumbhash";

/**
 * ThumbHash → data URL, decoded once per distinct hash. Module-level cache
 * because the decode is pure and one photo appears in several places.
 *
 * atob(), not Buffer — the canonical snippet uses a Node global that throws in
 * a browser.
 */
const blurCache = new Map<string, string>();

export function blurDataUrl(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  const cached = blurCache.get(hash);
  if (cached) return cached;
  try {
    const binary = atob(hash);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = thumbHashToDataURL(bytes);
    blurCache.set(hash, url);
    return url;
  } catch {
    // A malformed hash must not take a page down — that tile just shows the
    // flat background instead of a blurred preview.
    return undefined;
  }
}

/** A background-image style for a ThumbHash, or undefined when there is none. */
export function blurStyle(hash: string | undefined): React.CSSProperties | undefined {
  const url = blurDataUrl(hash);
  return url
    ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;
}

/** Grid tiles are never displayed above ~720 CSS px, even on a large screen. */
export const GRID_WIDTHS = [240, 480, 720] as const;

/** Lightbox frames go to the display width. */
export const FULL_WIDTHS = [1080, 1440, 2048] as const;

export const ALL_WIDTHS = [...GRID_WIDTHS, ...FULL_WIDTHS] as const;

export type GalleryKind = "album" | "client";

/** One rung, as the worker records it: width, avif bytes, webp bytes. */
export interface Variant {
  w: number;
  a: number;
  p: number;
}

/**
 * photos.variants is jsonb, so it arrives untyped. Validated rather than cast:
 * a malformed row would otherwise reach a srcset, where the failure is a broken
 * image rather than an error. Rows with no usable width are dropped, so a
 * half-written row degrades to "no ladder". Sorted ascending for srcset.
 */
export function parseVariants(value: unknown): Variant[] {
  if (!Array.isArray(value)) return [];

  const out: Variant[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { w, a, p } = entry as Record<string, unknown>;
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) continue;
    out.push({
      w,
      a: typeof a === "number" ? a : 0,
      p: typeof p === "number" ? p : 0,
    });
  }
  return out.sort((x, y) => x.w - y.w);
}

/**
 * Rollback switch. NEXT_PUBLIC_IMAGE_MODE=legacy sends every surface back to
 * the Optimizer URLs. Flip it, re-enable Optimizer on the pull zone, and the
 * app is where it started — the ladder never touched storage_path.
 */
export const IMAGE_MODE: "ladder" | "legacy" =
  process.env.NEXT_PUBLIC_IMAGE_MODE === "legacy" ? "legacy" : "ladder";

/**
 * Where a photo's derivatives live, relative to the storage zone root.
 *
 * Keyed on gallery KIND, never visibility: the public zone blocks any URL
 * containing "/clients/", kind never changes, and visibility is a dashboard
 * toggle that would otherwise expose or break files on every flip.
 *
 * ladderRev is in the path because checksum8 hashes the original only. Changing
 * encoder settings without bumping it rewrites the same URLs with different
 * bytes, under a one-year immutable cache. Always bump.
 */
export function derivativePrefix(
  kind: GalleryKind,
  galleryId: string,
  photoId: string,
  checksum8: string,
  ladderRev: number,
): string {
  const root = kind === "client" ? "clients/_d" : "d";
  return `${root}/${galleryId}/${photoId}/${checksum8}/v${ladderRev}`;
}

/**
 * Everything needed to build one photo's URLs. `base` already points at the
 * right pull zone and `query` carries the signature ("" for an album), both
 * decided server-side so the browser never sees a token key.
 */
export interface LadderSources {
  base: string;
  widths: number[];
  query: string;
}

/** Is there anything to render from? */
export function hasLadder(l: LadderSources | null | undefined): l is LadderSources {
  return Boolean(l && l.widths.length > 0 && IMAGE_MODE === "ladder");
}

export function srcSet(l: LadderSources, ext: "avif" | "webp"): string {
  return l.widths.map((w) => `${l.base}/${w}.${ext}${l.query} ${w}w`).join(", ");
}

/** The <img> inside a <picture>: only reached by browsers that ignored both
 *  <source> elements, so WebP and the widest rung rather than guessing small. */
export function fallbackSrc(l: LadderSources): string {
  const widest = l.widths[l.widths.length - 1];
  return `${l.base}/${widest}.webp${l.query}`;
}

/** The delivery JPEG. Full resolution, q92 — the "full" download tier. */
export function downloadSrc(l: LadderSources): string {
  return `${l.base}/download.jpg${l.query}`;
}

/** The light JPEG. 2048px wide, q82 — the "share" download tier. */
export function shareSrc(l: LadderSources): string {
  return `${l.base}/share.jpg${l.query}`;
}

// Download tiers

/**
 * What a client can take away.
 *
 *   share     2048px, q82           ~400-600 KB   posting, messaging
 *   full      full resolution, q92  ~3-5 MB       printing, keeping
 *   original  untouched source      5-30 MB       archive, retoucher
 */
export type DownloadTier = "share" | "full" | "original";

/** Matches the column default in the download_tiers migration. */
export const DEFAULT_DOWNLOAD_TIERS: DownloadTier[] = ["share", "full"];

const TIER_ORDER: DownloadTier[] = ["share", "full", "original"];

/**
 * galleries.download_tiers arrives untyped and decides what a client may take.
 * Unrecognised entries are dropped and an empty result falls back to the
 * DEFAULT, not to "everything" — a typo must never hand out originals.
 */
export function parseTiers(value: unknown): DownloadTier[] {
  if (!Array.isArray(value)) return DEFAULT_DOWNLOAD_TIERS;
  const out = TIER_ORDER.filter((t) => value.includes(t));
  return out.length > 0 ? out : DEFAULT_DOWNLOAD_TIERS;
}

/** Bytes per tier, as recorded by the worker. Any of them may be unknown. */
export interface DownloadSizes {
  share?: number;
  full?: number;
  original?: number;
}

/** The part of a photo that downloading, zipping and sharing care about.
 *  Here rather than gallery.ts so the resolver below stays importable. */
export interface DownloadablePhoto {
  src: string;
  /** Real filename from the database — see tierFileName() for why it matters. */
  fileName?: string;
  ladder?: LadderSources;
  sizes?: DownloadSizes;
}

export interface DownloadOption {
  tier: DownloadTier;
  url: string;
  /** Undefined when the worker never recorded it. The UI shows "—", not "0 B". */
  bytes?: number;
}

/**
 * The tiers this photo can be handed over as, in order.
 *
 * Two different filters: `allowed` is the gallery's policy, everything else is
 * availability. A photo with no ladder has no share.jpg to point at whatever
 * the policy says, so it degrades to the original alone.
 *
 * The `out.length === 0` clause looks like it defeats the policy and does not.
 * An un-laddered photo is already being displayed at full size by the page, so
 * the client can save it from the browser anyway; blocking the button would be
 * theatre. It only happens when a photo was synced but never built — if a whole
 * gallery does this, the worker has not run.
 */
export function downloadOptions(
  photo: DownloadablePhoto,
  allowed: DownloadTier[] = DEFAULT_DOWNLOAD_TIERS,
): DownloadOption[] {
  const out: DownloadOption[] = [];
  const l = photo.ladder;

  if (hasLadder(l)) {
    if (allowed.includes("share")) {
      out.push({ tier: "share", url: shareSrc(l), bytes: photo.sizes?.share });
    }
    if (allowed.includes("full")) {
      out.push({ tier: "full", url: downloadSrc(l), bytes: photo.sizes?.full });
    }
  }

  if (allowed.includes("original") || out.length === 0) {
    out.push({ tier: "original", url: photo.src, bytes: photo.sizes?.original });
  }

  return out;
}

/**
 * The tiers worth offering for a whole selection. A tier counts if ANY photo
 * can supply it: one unbuilt photo should not remove "For sharing" from a sheet
 * covering fifty that have it.
 *
 * "Full" can disappear. download.jpg is a q92 re-encode, so when the source is
 * already a modest JPEG it comes out BIGGER than the original and a generation
 * worse — strictly worse on both axes. Dropped only when originals are on offer
 * and both totals are known; never on a missing number.
 */
export function availableTiers(
  photos: DownloadablePhoto[],
  allowed: DownloadTier[] = DEFAULT_DOWNLOAD_TIERS,
): DownloadTier[] {
  const union = new Set<DownloadTier>();
  for (const p of photos) {
    for (const o of downloadOptions(p, allowed)) union.add(o.tier);
  }

  let tiers = TIER_ORDER.filter((t) => union.has(t));

  if (tiers.includes("full") && tiers.includes("original")) {
    const full = totalBytes(photos, "full");
    const original = totalBytes(photos, "original");
    if (typeof full === "number" && typeof original === "number" && full >= original) {
      tiers = tiers.filter((t) => t !== "full");
    }
  }

  return tiers;
}

/** The one option to use when the client has not chosen, or their choice is gone. */
export function preferredTier(
  options: DownloadOption[],
  wanted: DownloadTier | null,
): DownloadOption {
  return (
    (wanted && options.find((o) => o.tier === wanted)) ??
    options.find((o) => o.tier === "full") ??
    options[0]
  );
}

/**
 * Save name, with an extension matching the actual bytes. Two traps:
 *
 * Ladder URLs end in "share.jpg", so parsing the name out of the URL gives
 * every photo in a zip the same name. The real name comes from the database.
 *
 * And the derivative is a JPEG even when the original was a PNG — keeping
 * ".png" produces a file some photo software refuses to open. Only the original
 * tier keeps its source name.
 */
export function tierFileName(photo: DownloadablePhoto, tier: DownloadTier): string {
  const raw = photo.fileName ?? urlFileName(photo.src);
  if (tier === "original") return raw;
  const dot = raw.lastIndexOf(".");
  return `${dot === -1 ? raw : raw.slice(0, dot)}.jpg`;
}

/** "…/Portraits/Sara/3M0A1432.png?width=800" -> "3M0A1432.png" */
export function urlFileName(src: string): string {
  const raw = src.split("?")[0].split("/").pop() || "photo";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Total bytes for a selection, or undefined if any photo's size is unknown.
 * All-or-nothing: "1.2 GB" turning out to mean 3 GB is the surprise these
 * labels exist to prevent.
 */
export function totalBytes(
  photos: DownloadablePhoto[],
  tier: DownloadTier,
): number | undefined {
  let sum = 0;
  for (const p of photos) {
    const n = p.sizes?.[tier];
    if (typeof n !== "number") return undefined;
    sum += n;
  }
  return sum;
}

/** "480 KB", "24.6 MB", "1.2 GB". Undefined in, em dash out. */
export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  // One decimal below 10 ("4.2 MB"), none above it ("480 KB") — the extra digit
  // is noise once the number is large enough to read at a glance.
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/**
 * `sizes` for the justified grid. Get this wrong and the browser pulls the 2048
 * rung into a 300px tile, undoing the migration — check in DevTools that
 * intrinsic and rendered size agree within the pixel ratio. Mirrors
 * columnsForWidth() in PhotoGrid.
 */
export const GRID_SIZES = "(max-width: 520px) 50vw, (max-width: 900px) 33vw, (max-width: 1400px) 25vw, 20vw";
export const FULL_SIZES = "100vw";
