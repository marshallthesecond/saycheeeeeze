// What the photo menu and the photo panel both need: the photo's link on the
// site, its details as text, and copying or sharing them.

import { SITE_URL } from "@/src/lib/seo";
import type { StudioPhoto } from "@/src/lib/studio/gallery";
import { formatBytes, formatWhen } from "@/src/lib/studio/format";
import { groupBySet, type GallerySet } from "@/src/lib/gallery-sets";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Where a shown photo is on the site: its set's place among the sets shown (from 1; null without sets) and its own place in that set (from 1). */
export interface SitePlace {
  set: number | null;
  p: number;
}

/**
 * The address that opens the gallery on this photo (?p=, as the site's own
 * Share does; ?set=&p= in a gallery divided into sets). Null while the photo
 * is hidden: the site does not show it.
 */
export function photoLink(siteHref: string, photo: StudioPhoto, place: SitePlace | null): string | null {
  if (photo.hidden || !place) return null;
  const query = place.set === null ? `p=${place.p}` : `set=${place.set}&p=${place.p}`;
  return `${SITE_URL.replace(/\/$/, "")}${siteHref}?${query}`;
}

/**
 * Each shown photo's place on the site, from the grid as it is now: a photo
 * hidden, shown or moved to another set a moment ago moves the ones after it.
 * The same grouping as the site's (gallery-sets.ts): only sets with a shown
 * photo are tabs there.
 */
export function sitePositions(photos: StudioPhoto[], sets: readonly GallerySet[] = []): Map<string, SitePlace> {
  const out = new Map<string, SitePlace>();
  const grouped = groupBySet(sets, photos.filter((p) => !p.hidden));
  if (grouped.sets.length === 0) {
    grouped.photosOf(null).forEach((p, i) => out.set(p.id, { set: null, p: i + 1 }));
    return out;
  }
  grouped.sets.forEach((s, k) => grouped.photosOf(s.id).forEach((p, i) => out.set(p.id, { set: k + 1, p: i + 1 })));
  return out;
}

/** "JPEG", "PNG", from the file's name. */
export function formatOf(fileName: string): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1]?.toUpperCase() ?? "";
  return ext === "JPG" ? "JPEG" : ext;
}

export interface DetailRow {
  label: string;
  value: string;
}

/** The facts the database has about the photo, labelled, in reading order. */
export function detailRows(photo: StudioPhoto, galleryTitle: string, t: T, locale: string): DetailRow[] {
  const rows: DetailRow[] = [];
  rows.push({ label: t("gallery.photos.info.name"), value: photo.name });
  if (photo.name !== photo.fileName) rows.push({ label: t("gallery.photos.info.file"), value: photo.fileName });
  if (photo.bytes) rows.push({ label: t("gallery.photos.info.size"), value: formatBytes(photo.bytes, locale, t) });
  if (photo.width && photo.height) {
    rows.push({ label: t("gallery.photos.info.dimensions"), value: `${photo.width} × ${photo.height}` });
  }
  const format = formatOf(photo.fileName);
  if (format) rows.push({ label: t("gallery.photos.info.format"), value: format });
  if (photo.takenAt) rows.push({ label: t("gallery.photos.info.taken"), value: formatWhen(photo.takenAt, locale) });
  if (photo.uploadedAt) rows.push({ label: t("gallery.photos.info.uploaded"), value: formatWhen(photo.uploadedAt, locale) });
  rows.push({ label: t("gallery.photos.info.gallery"), value: galleryTitle });
  if (photo.tags.length) rows.push({ label: t("gallery.photos.info.tags"), value: photo.tags.join(", ") });
  if (photo.description) rows.push({ label: t("gallery.photos.info.description"), value: photo.description });
  return rows;
}

/** The same, as lines to paste: "Size: 12.3 MB". */
export function detailsText(rows: DetailRow[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join("\n");
}

/** True when the text is on the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The phone's share sheet where there is one; else the link is copied.
 * "cancelled" when the sheet was closed without sharing.
 */
export async function shareLink(url: string, title: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
