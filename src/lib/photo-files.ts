// Where a photo's files are, and the address a page uses for them.
//
// Since step 7 (20261116230000) each photos row says where its derivatives
// are (files_at), set once when the row is made. A photo can then move to
// another gallery, or be published from a client gallery into an album,
// without a file moving: the row changes, the files stay.
//
// The zone follows the FILES, never the gallery. Anything under /clients/ is
// refused by the public pull zone, so such a photo is served through the
// private zone with a token signed for that one photo's folder, even on a
// public album page. A token for one folder opens nothing else in the client's
// gallery.
//
// Server-only: it signs.

import "server-only";

import { bunnyUrl } from "./bunny-url";
import { privateHost, privateZoneConfigured, signBunnyUrl, signDirectoryQuery } from "./bunny-sign";
import { derivativeDir, parseVariants, type GalleryKind, type LadderSources } from "./ladder";

const PUBLIC_CDN = (process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE ?? "").replace(/\/$/, "");

/** The columns a photo's files are found from. */
export interface FilesRow {
  id: string;
  gallery_id: string;
  files_at?: string | null;
  checksum8?: string | null;
  variants?: unknown;
  ladder_rev?: number | null;
}

/** "clients/kamila/1.jpg", "clients/_d/…" and later "u/x/clients/…": private. */
export function isPrivatePath(path: string): boolean {
  return `/${path.replace(/^\/+/, "")}`.includes("/clients/");
}

/** The row's derivative folder; before 20261116230000, worked out as it used to be. */
export function filesFolder(row: FilesRow, kind: GalleryKind): string {
  return row.files_at || derivativeDir(kind, row.gallery_id, row.id);
}

/**
 * How long a link on a CACHED public page lasts: at least 30 days, at most
 * 60, and the same for every page built within one 30-day stretch, so a page
 * cached for an hour, or a browser's image cache, keeps working. Only photos
 * whose files are private get one; the rest are plain public URLs.
 */
export function publicPageExpiry(now = Date.now()): number {
  const stretch = 30 * 24 * 3600;
  const t = Math.floor(now / 1000);
  return Math.floor(t / stretch) * stretch + 2 * stretch;
}

/**
 * One photo's derivatives.
 *
 * `shared`: a token already signed for a whole folder (a client gallery's own
 * page signs clients/_d/<gallery>/ once); used when this photo's folder is
 * inside it, otherwise the photo gets a token of its own.
 */
export function photoLadder(
  row: FilesRow,
  kind: GalleryKind,
  expiresAt: number,
  shared?: { folder: string; query: string },
): LadderSources | undefined {
  const variants = parseVariants(row.variants);
  if (!row.checksum8 || variants.length === 0) return undefined;
  const folder = filesFolder(row, kind);
  const path = `${folder}/${row.checksum8}/v${row.ladder_rev ?? 1}`;
  const widths = variants.map((v) => v.w);

  if (isPrivatePath(folder)) {
    if (!privateZoneConfigured()) return undefined;
    const query =
      shared && `${folder}/`.startsWith(shared.folder) ? shared.query : signDirectoryQuery(`${folder}/`, expiresAt);
    return { base: `${privateHost()}/${path}`, widths, query };
  }
  if (!PUBLIC_CDN) return undefined;
  return { base: `${PUBLIC_CDN}/${path}`, widths, query: "" };
}

/** The original: a public URL, or signed when it lives under /clients/. */
export function originalUrl(storagePath: string, expiresAt: number): string {
  if (isPrivatePath(storagePath)) {
    return privateZoneConfigured() ? signBunnyUrl(storagePath, { expiresAt }) : "";
  }
  return bunnyUrl(storagePath);
}
