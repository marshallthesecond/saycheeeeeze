// src/lib/ladder.ts
//
// The derivative ladder, described once.
//
// Pure functions and constants only — no "server-only", no secrets, no storage
// API. This is deliberately importable from a client component, because
// PhotoGrid and the lightbox both need to build srcset strings in the browser.
// Anything that needs the token key lives in bunny-sign.ts instead.
//
// ── The contract with the worker ─────────────────────────────
// scripts/build-ladder.mjs writes the files this module builds URLs for. The
// two must agree on the path layout exactly, and they are kept in step by hand
// rather than sharing code: a plain node script cannot import a TypeScript
// module out of a Next app, and the same reasoning applies here as in
// verify-private-zone.mjs — a test that shares an implementation with the thing
// it tests can only prove the two agree with each other, not that either is
// right. If you change the layout, change it in both places and say so here.

import type React from "react";
import { thumbHashToDataURL } from "thumbhash";

/**
 * ThumbHash → a data URL, decoded once per distinct hash.
 *
 * Module-level cache rather than a hook, because the decode is pure — same hash,
 * same PNG, always — and the same photo can appear in more than one place on a
 * page. A gallery decodes each hash once and never again.
 *
 * Note atob(), not Buffer. The canonical ThumbHash snippet uses
 * Buffer.from(hash, "base64"), which is a Node global and throws in a browser.
 *
 * Lives here rather than in PhotoGrid so album covers, service cards and the
 * grid all share one implementation.
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
 * Reads photos.variants, which is jsonb and therefore `Json` — anything at all
 * as far as the type system is concerned.
 *
 * Validating beats asserting here. A cast would compile and then hand a
 * malformed row straight into a srcset, where the failure mode is a broken
 * image rather than an error anyone sees. Rows with no usable width are
 * dropped, so a partially-written row degrades to "no ladder" and the caller
 * falls back to the Optimizer path instead of rendering nothing.
 *
 * Sorted ascending, because srcset entries should read small to large and no
 * caller should have to remember that.
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
 * The escape hatch.
 *
 * Set NEXT_PUBLIC_IMAGE_MODE=legacy to make every surface fall back to the old
 * Optimizer URLs even where derivatives exist. That is the rollback for this
 * whole migration: flip the variable, re-enable Optimizer on the pull zone, and
 * the app is exactly where it started. No data moves in either direction,
 * because the ladder never touched storage_path.
 */
export const IMAGE_MODE: "ladder" | "legacy" =
  process.env.NEXT_PUBLIC_IMAGE_MODE === "legacy" ? "legacy" : "ladder";

/**
 * Where a photo's derivatives live, relative to the storage zone root.
 *
 * Keyed on gallery KIND, never on visibility — see the long note in
 * scripts/build-ladder.mjs. Short version: the public pull zone blocks any URL
 * containing "/clients/", kind never changes, and visibility is a column you
 * flip from a dashboard. Keying on visibility would mean every flip either
 * exposes files or breaks them.
 *
 * `ladderRev` is in the path because checksum8 hashes the ORIGINAL only. Change
 * the encoder settings and the same paths would be rewritten with different
 * bytes — fatal under the one-year immutable cache these files are served with,
 * and recoverable only by the CDN purge this whole design exists to avoid.
 * Bump the revision and everything lands at fresh URLs instead.
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
 * Everything needed to build one photo's URLs, resolved server-side.
 *
 * `base` is absolute and already points at the right pull zone; `query` carries
 * the signature for a client gallery and is "" for an album. Both are decided
 * on the server so the browser never sees a token key or has to know which zone
 * a gallery belongs to.
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

/**
 * The <img> src inside a <picture>. WebP rather than AVIF, and the widest rung
 * rather than the narrowest: this is only reached by browsers that ignored both
 * <source> elements, which in 2026 means something old enough that guessing
 * small would look worse than spending the bytes.
 */
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

// ─────────────────────────────────────────────────────────────
// Download tiers
// ─────────────────────────────────────────────────────────────

/**
 * What a client can take away.
 *
 *   share     2048px wide, q82      ~400-600 KB   posting, messaging
 *   full      full resolution, q92  ~3-5 MB       printing, cropping, keeping
 *   original  the untouched source  5-30 MB       archive, retoucher
 *
 * Named for what they are FOR rather than by a quality word, because "medium"
 * tells a client nothing about which one they want and "for printing" tells
 * them everything.
 */
export type DownloadTier = "share" | "full" | "original";

/** Matches the column default in the download_tiers migration. */
export const DEFAULT_DOWNLOAD_TIERS: DownloadTier[] = ["share", "full"];

const TIER_ORDER: DownloadTier[] = ["share", "full", "original"];

/**
 * Reads galleries.download_tiers, which is text[] and arrives as `unknown`.
 *
 * Validated rather than cast, for the same reason parseVariants is: a bad value
 * here decides what a client is allowed to download. An unrecognised entry is
 * dropped, and a column that ends up empty or malformed falls back to the
 * DEFAULT rather than to "everything" — the failure mode of a typo must never
 * be handing out originals.
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

/**
 * The subset of a photo that downloading, zipping and sharing care about.
 *
 * Lives here rather than in gallery.ts so that the tier resolver below is pure
 * and importable anywhere; gallery.ts re-exports it so existing imports keep
 * working.
 */
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
 * The tiers this photo can actually be handed over as, in order.
 *
 * Two filters, and they are different things. `allowed` is the gallery's
 * policy — what you are willing to give this client. Everything else here is
 * availability: a photo with no ladder has no share.jpg and no download.jpg to
 * point at, whatever the policy says, so it degrades to the original alone.
 * That is also what NEXT_PUBLIC_IMAGE_MODE=legacy produces, which is the
 * rollback behaving exactly as documented.
 *
 * The original is always reachable — it is `src`, already signed for a client
 * gallery — so it needs no ladder and no extra file.
 *
 * ── Why a share-only gallery can still yield an original ─────
 * The `out.length === 0` clause looks like it defeats the policy, and it is
 * deliberate. A photo with no ladder has no share.jpg and no download.jpg in
 * existence; the choice is between handing over the original and rendering a
 * download button that does nothing. And withholding it would protect nothing,
 * because that same original is what the PAGE is already displaying for an
 * un-laddered photo — the client can save it from the browser without asking
 * us. Blocking the button would be theatre paid for with a broken feature.
 *
 * This is an edge case by construction: it means a photo was synced but never
 * built. If it is showing up for a whole gallery, the ladder worker has not
 * run, and that is the actual thing to fix.
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
 * The tiers worth OFFERING for a whole selection.
 *
 * A tier is offered if ANY photo in the selection can supply it, not if all of
 * them can. One photo that has not been through the worker yet should not
 * remove "For sharing" from a sheet covering fifty that have — that photo falls
 * back to its original through preferredTier(), which is the documented
 * degradation, and the client gets what they asked for everywhere it exists.
 *
 * ── Why "full" can disappear ─────────────────────────────────
 * download.jpg is a q92 re-encode at full resolution. When the source is
 * already a modest JPEG — a 370 KB frame off a phone rather than a 38 MB PNG
 * off the camera — that re-encode comes out BIGGER than the file it came from,
 * while also being a generation worse. Offering it there would mean asking a
 * client to choose "Full quality" over "Original file" when it is larger and
 * lossier: strictly worse on both axes.
 *
 * So when originals are on offer and the full tier is not actually smaller, the
 * full tier is dropped. Only ever when both totals are known — a tier is never
 * removed on the strength of a missing number.
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
 * The name to save a file under, with an extension that matches the actual bytes.
 *
 * Two bugs live here if you get it wrong.
 *
 * Parsing the name out of the URL worked while URLs ended in "3M0A0675.png".
 * Ladder URLs end in "share.jpg" or "download.jpg" — so every photo in a zip
 * would arrive under the same name and overwrite the last. The real name
 * travels from the database instead.
 *
 * And the derivative IS a JPEG even when the original was a PNG, so keeping the
 * original ".png" would hand the client a file whose extension lies about its
 * contents — which some photo software simply refuses to open. The original
 * tier is the one case where the source name is exactly right.
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
 * Total bytes for a selection at one tier, or undefined if ANY photo's size is
 * unknown.
 *
 * All-or-nothing on purpose. A total that silently omits the photos it has no
 * figure for reads as authoritative and is wrong, and "1.2 GB" turning out to
 * mean 3 GB is precisely the surprise the size labels exist to prevent. Better
 * to show no total than a confident wrong one.
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
 * `sizes` for a justified/masonry grid. Getting this wrong is how a browser
 * cheerfully pulls the 2048 rung into a 300 px tile and undoes the entire
 * migration — audit it in DevTools by comparing an <img>'s intrinsic size
 * against its rendered size; they should be within the device pixel ratio.
 *
 * Kept here rather than inline at each call site so there is one place to fix
 * when the grid breakpoints move. These mirror columnsForWidth() in PhotoGrid.
 */
export const GRID_SIZES = "(max-width: 520px) 50vw, (max-width: 900px) 33vw, (max-width: 1400px) 25vw, 20vw";
export const FULL_SIZES = "100vw";
