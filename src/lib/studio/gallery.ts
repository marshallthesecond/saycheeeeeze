// One gallery, as the Studio's gallery page shows it: its settings, its
// photographs and its passkeys.
//
// Everything is read as the signed-in photographer, so Row Level Security
// decides what comes back. The account filter is for correctness, as in
// galleries.ts: a member can also read other photographers' public albums.

import "server-only";

import { cache } from "react";
import { formatDay } from "@/src/lib/format-day";
import { parseTiers, type DownloadTier, type GalleryKind, type LadderSources } from "@/src/lib/ladder";
import { nextExpiry } from "@/src/lib/bunny-sign";
import { isSetsMissing, type GallerySet } from "@/src/lib/gallery-sets";
import { COVER_COLUMNS, coverLadder, publicPath } from "./galleries";
import { requireStudio, type StudioSession } from "./session";
import { studioSupabase } from "./supabase";

export interface StudioGalleryDetail {
  id: string;
  slug: string;
  title: string;
  kind: GalleryKind;
  /** Client galleries: a passkey is required. Anything but 'public' counts. */
  isPrivate: boolean;
  isPublished: boolean;
  /** Client galleries: shown in the gallery list on the site. */
  isListed: boolean;
  dateLabel: string;
  location: string;
  year: string;
  description: string;
  accent: string;
  clientNote: string;
  listLabel: string;
  /** "2026-12-31" in Tashkent time, or "" when the gallery never closes. */
  closesOn: string;
  downloadEnabled: boolean;
  downloadTiers: DownloadTier[];
  coverPath: string | null;
  /** Where its files are in the storage zone, e.g. "clients/sara-wedding". */
  folder: string | null;
  photoCount: number;
  /** Its page on the public site, without the language prefix. */
  href: string;
  /**
   * An album that was a client gallery ("Make public"): it can be made
   * private again, with its passkeys as they were.
   */
  privateOrigin: boolean;
}

// The studio is in Tashkent, which has no daylight saving. When photographers
// in other time zones arrive this becomes a column on accounts.
const UTC_OFFSET_HOURS = 5;
const UTC_OFFSET = "+05:00";

/** A stored moment -> the calendar day it falls on in the studio's time zone. */
export function studioDay(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** "2026-12-31" -> the last second of that day in the studio's time zone. */
export function endOfStudioDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = new Date(`${day}T23:59:59${UTC_OFFSET}`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** "11 Nov 2026", "11 ноя 2026", "11-noy 2026". "" for no date. */
export function studioDate(iso: string | null, locale: string): string {
  const day = studioDay(iso);
  const label = day ? formatDay(day, locale) : null;
  return label ? `${label.date} ${day.slice(0, 4)}` : "";
}

/**
 * The gallery with this address in the signed-in account, or null.
 *
 * cache(): the gallery layout and the page under it both ask during one
 * render. Memoised per request, never across requests.
 */
export const getStudioGallery = cache(async (slug: string): Promise<StudioGalleryDetail | null> => {
  const session = await requireStudio();
  const supabase = await studioSupabase();

  const { data, error } = await supabase
    .from("galleries")
    .select(
      "id, slug, title, kind, visibility, is_published, is_listed, date_label, location, year, description, accent_color, client_note, list_label, expires_at, download_enabled, download_tiers, cover_path, bunny_folder, photos(count)",
    )
    .eq("account_id", session.account.id)
    .eq("slug", slug)
    .limit(1);

  if (error) throw new Error(`Studio: could not load the gallery: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;

  const kind: GalleryKind = row.kind === "client" ? "client" : "album";
  const first = Array.isArray(row.photos) ? row.photos[0] : undefined;

  // Separately, so a database before 20261116230000 still opens the gallery.
  let privateOrigin = false;
  if (kind === "album") {
    const origin = await supabase.from("galleries").select("client_folder").eq("id", row.id).limit(1);
    privateOrigin = !origin.error && Boolean(origin.data?.[0]?.client_folder);
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind,
    isPrivate: row.visibility !== "public",
    isPublished: row.is_published,
    isListed: row.is_listed,
    dateLabel: row.date_label,
    location: row.location,
    year: row.year,
    description: row.description,
    accent: row.accent_color,
    clientNote: row.client_note ?? "",
    listLabel: row.list_label ?? "",
    closesOn: studioDay(row.expires_at),
    downloadEnabled: row.download_enabled !== false,
    downloadTiers: parseTiers(row.download_tiers),
    coverPath: row.cover_path,
    folder: row.bunny_folder,
    photoCount: typeof first?.count === "number" ? first.count : 0,
    href: publicPath(kind, row.slug),
    privateOrigin,
  };
});

export interface StudioPhoto {
  id: string;
  /** The file's own name, from its storage path. Never changes. */
  fileName: string;
  /** What the Studio calls it: the name given in the Studio, else the file's. */
  name: string;
  /** Shown under the photo in the gallery viewer. "" for none. */
  description: string;
  /** Portfolio categories it is also filed under. */
  tags: string[];
  /** Off the site; still here, marked. */
  hidden: boolean;
  ladder?: LadderSources;
  thumbhash?: string;
  /** The one the gallery shows first: the chosen cover, or else the first photo. */
  isCover: boolean;
  /** Client galleries: what the client chose for it, if anything. */
  mark?: ClientMark;
  /** Client galleries: the album it is already published in, if any. */
  publishedIn?: string;
  /** For the details: what the database knows about the file. */
  width?: number;
  height?: number;
  bytes?: number;
  takenAt?: string;
  uploadedAt?: string;
  /**
   * Where it is in the gallery as the site shows it, from 1, for a link that
   * opens the gallery on it (?p=). Null while it is hidden.
   */
  sitePosition: number | null;
  /** The set it is in, when the gallery is divided into sets. */
  setId?: string | null;
}

export type ClientMark = "publish" | "keep" | "delete";

function markOf(value: unknown): ClientMark | undefined {
  return value === "publish" || value === "keep" || value === "delete" ? value : undefined;
}

/** Every photograph in the gallery, in the order the site shows them. */
export async function listStudioPhotos(gallery: StudioGalleryDetail): Promise<StudioPhoto[]> {
  return (await listStudioPhotoDetails(gallery)).photos;
}

const BASE_COLUMNS = `${COVER_COLUMNS}, file_name, sort_order, client_mark, width, height, bytes, source_bytes, taken_at, created_at`;
/** 20261121120000_photo_details.sql. */
const DETAIL_COLUMNS = "name, description, tags, hidden";

type PhotoListRow = {
  id: string;
  gallery_id: string;
  storage_path: string;
  checksum8: string | null;
  thumbhash: string | null;
  variants: unknown;
  ladder_rev: number;
  files_at: string;
  file_name: string | null;
  client_mark: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  source_bytes: number | null;
  taken_at: string | null;
  created_at: string;
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  hidden?: boolean | null;
};

/**
 * The photos, and whether the database has the photo details yet
 * (20261121120000_photo_details.sql). Before it is run the photos still show,
 * with no names, descriptions, tags or hiding.
 */
export async function listStudioPhotoDetails(gallery: StudioGalleryDetail): Promise<{
  photos: StudioPhoto[];
  detailsReady: boolean;
  /** The gallery's sets in order; empty when it is not divided into sets. */
  sets: GallerySet[];
  /** The database has sets (20261122120000_gallery_sets.sql). */
  setsReady: boolean;
}> {
  const supabase = await studioSupabase();
  const setsRead = readSets(gallery.id);
  // Awaited below; this only keeps an early failure from going unhandled.
  setsRead.catch(() => {});
  const query = (columns: string) =>
    supabase
      .from("photos")
      .select(columns)
      .eq("gallery_id", gallery.id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

  let detailsReady = true;
  let { data, error } = await query(`${BASE_COLUMNS}, ${DETAIL_COLUMNS}`);
  // 42703: a column that does not exist. The migration is not run yet.
  if (error && (error.code === "42703" || /column .* does not exist/.test(error.message))) {
    detailsReady = false;
    ({ data, error } = await query(BASE_COLUMNS));
  }
  if (error) throw new Error(`Studio: could not load the photos: ${error.message}`);
  const rows = (data ?? []) as unknown as PhotoListRow[];
  const published = gallery.kind === "client" ? await albumsHolding(rows.map((r) => r.storage_path)) : new Map();
  const sets = await setsRead;

  // One deadline for every signed thumbnail on the page.
  const expiresAt = nextExpiry();
  const named = gallery.coverPath ? rows.findIndex((r) => r.storage_path === gallery.coverPath) : -1;
  const coverIndex = named === -1 ? 0 : named;

  let shown = 0;
  const photos = rows.map((r, i) => {
    const fileName = r.file_name ?? r.storage_path.split("/").pop() ?? "";
    const hidden = r.hidden === true;
    return {
      id: r.id,
      fileName,
      name: r.name || fileName,
      description: r.description ?? "",
      tags: Array.isArray(r.tags) ? r.tags : [],
      hidden,
      ladder: coverLadder(gallery.kind, r, expiresAt),
      thumbhash: r.thumbhash ?? undefined,
      isCover: i === coverIndex,
      mark: gallery.kind === "client" ? markOf(r.client_mark) : undefined,
      publishedIn: published.get(r.storage_path),
      ...(r.width ? { width: r.width } : {}),
      ...(r.height ? { height: r.height } : {}),
      ...((r.source_bytes ?? r.bytes) ? { bytes: Number(r.source_bytes ?? r.bytes) } : {}),
      ...(r.taken_at ? { takenAt: r.taken_at } : {}),
      uploadedAt: r.created_at,
      sitePosition: hidden ? null : ++shown,
      ...(sets.setOf ? { setId: sets.setOf.get(r.id) ?? null } : {}),
    };
  });
  return { photos, detailsReady, sets: sets.sets, setsReady: sets.ready };
}

/**
 * A gallery's sets and the set of each of its photos. On a database without
 * sets: none, and `ready` false.
 */
async function readSets(
  galleryId: string,
): Promise<{ sets: GallerySet[]; ready: boolean; setOf?: Map<string, string | null> }> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("gallery_sets")
    .select("id, label")
    .eq("gallery_id", galleryId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (isSetsMissing(error)) return { sets: [], ready: false };
  if (error) throw new Error(`Studio: could not load the sets: ${error.message}`);
  if (!data || data.length === 0) return { sets: [], ready: true };
  const rows = await supabase.from("photos").select("id, set_id").eq("gallery_id", galleryId);
  if (rows.error) throw new Error(`Studio: could not load the sets: ${rows.error.message}`);
  return {
    sets: data.map((x) => ({ id: x.id, label: x.label })),
    ready: true,
    setOf: new Map((rows.data ?? []).map((r) => [r.id, r.set_id])),
  };
}

/** File -> the title of an album of this account that shows it too. */
async function albumsHolding(paths: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (paths.length === 0) return found;
  const session = await requireStudio();
  const supabase = await studioSupabase();
  // In pieces: the list goes into the request's address.
  for (let i = 0; i < paths.length; i += 150) {
    const { data, error } = await supabase
      .from("photos")
      .select("storage_path, galleries!inner(title, kind, account_id)")
      .in("storage_path", paths.slice(i, i + 150))
      .eq("galleries.kind", "album")
      .eq("galleries.account_id", session.account.id);
    if (error) {
      console.error(`Studio: could not tell which photos are published: ${error.message}`);
      return found;
    }
    for (const r of data ?? []) {
      const g = Array.isArray(r.galleries) ? r.galleries[0] : r.galleries;
      if (g && !found.has(r.storage_path)) found.set(r.storage_path, g.title);
    }
  }
  return found;
}

/**
 * Where the account's photos are shown besides their albums (Best picks, the
 * service pages' rails), for the "Add to..." menu on each photo.
 */
export interface PlacementState {
  /** photo id → the places it is in, for this gallery's photos. */
  byPhoto: Record<string, string[]>;
  /** place → how many photos it holds, across the account. */
  counts: Record<string, number>;
}

/**
 * The account's placements, or "missing" before
 * 20261119120000_photo_placements.sql is run. Any other failure throws.
 */
export async function placementState(
  session: StudioSession,
  photoIds: string[],
): Promise<PlacementState | "missing"> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("photo_placements")
    .select("place, photo_id")
    .eq("account_id", session.account.id);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01" || /photo_placements/.test(error.message)) return "missing";
    throw new Error(`Studio: could not load where photos are shown: ${error.message}`);
  }
  const mine = new Set(photoIds);
  const byPhoto: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.place] = (counts[row.place] ?? 0) + 1;
    if (mine.has(row.photo_id)) (byPhoto[row.photo_id] ??= []).push(row.place);
  }
  return { byPhoto, counts };
}

export interface AlbumTarget {
  id: string;
  title: string;
  /** "Portraits": the top-level folder. */
  category: string;
}

/**
 * Where the chosen photos can go: every album of the account but this
 * gallery, and the categories in use (for a new album).
 */
export async function albumTargets(
  session: StudioSession,
  exceptId: string,
): Promise<{ albums: AlbumTarget[]; categories: string[] }> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("galleries")
    .select("id, title, bunny_folder")
    .eq("account_id", session.account.id)
    .eq("kind", "album")
    .order("title", { ascending: true });
  if (error) throw new Error(`Studio: could not load the albums: ${error.message}`);

  const prefix = session.account.storagePrefix.replace(/\/+$/, "");
  const root = prefix ? `${prefix}/` : "";
  const categoryOf = (folder: string | null) =>
    folder && folder.startsWith(root) ? (folder.slice(root.length).split("/")[0] ?? "") : "";

  const albums = (data ?? [])
    .filter((r) => r.id !== exceptId)
    .map((r) => ({ id: r.id, title: r.title, category: categoryOf(r.bunny_folder) }));
  const categories = [...new Set((data ?? []).map((r) => categoryOf(r.bunny_folder)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { albums, categories };
}

export type PasskeyStatus = "active" | "revoked" | "expired";

export interface StudioPasskey {
  id: string;
  label: string;
  status: PasskeyStatus;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
}

/**
 * A gallery's passkeys, newest first. Never the code and never its hash: the
 * code is not stored anywhere, and the hash is not readable through the API
 * (see the column grant in 20261115100000_studio_gallery_writes.sql), which
 * is why the columns are listed one by one and `*` would be refused.
 *
 * cache(): the gallery header asks too, to warn about a private gallery that
 * nobody can open.
 */
export const listPasskeys = cache(async (galleryId: string): Promise<StudioPasskey[]> => {
  const supabase = await studioSupabase();

  const { data, error } = await supabase
    .from("gallery_access")
    .select("id, label, created_at, expires_at, revoked_at, last_used_at, use_count")
    .eq("gallery_id", galleryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Studio: could not load the passkeys: ${error.message}`);

  const now = Date.now();
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    status: r.revoked_at
      ? "revoked"
      : r.expires_at && new Date(r.expires_at).getTime() <= now
        ? "expired"
        : "active",
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
  }));
});

export interface NewGalleryDefaults {
  /** Categories already in use, e.g. ["Portraits", "WIUT"]. */
  categories: string[];
  /** The location of the newest gallery, so it is not typed every time. */
  location: string;
}

/**
 * What the New gallery form starts from.
 *
 * A category is the top-level folder an album's files sit in, which is also
 * what the Portfolio page's filter chips are made from.
 */
export async function newGalleryDefaults(session: StudioSession): Promise<NewGalleryDefaults> {
  const supabase = await studioSupabase();

  const { data, error } = await supabase
    .from("galleries")
    .select("kind, bunny_folder, location, created_at")
    .eq("account_id", session.account.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Studio: could not load the categories: ${error.message}`);
  const rows = data ?? [];

  const prefix = session.account.storagePrefix.replace(/\/+$/, "");
  const root = prefix ? `${prefix}/` : "";

  const categories = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "album" || !r.bunny_folder || !r.bunny_folder.startsWith(root)) continue;
    const first = r.bunny_folder.slice(root.length).split("/")[0];
    if (first) categories.add(first);
  }

  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    location: rows.find((r) => r.location)?.location ?? "",
  };
}
