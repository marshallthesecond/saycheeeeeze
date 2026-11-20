// The services as the Studio's Services tab sees them: the code, what is
// published, the draft and the on/off switch, per service.
//
// Read through studio_services() as the signed-in photographer: visitors are
// never granted the draft column, and the function checks membership.

import "server-only";

import { cache } from "react";
import { nextExpiry } from "@/src/lib/bunny-sign";
import type { LadderSources } from "@/src/lib/ladder";
import { servicePlace } from "@/src/lib/placements";
import { COVER_COLUMNS, coverLadder, type CoverRow } from "./galleries";
import { getStudioState, type StudioSession } from "./session";
import { studioSupabase } from "./supabase";
import { applyContent, parseContent, type ServiceContent } from "@/src/lib/service-content";
import { servicesData, type ServiceData } from "@/src/lib/services";

export interface StudioServiceRow {
  slug: string;
  /** The code's version. */
  code: ServiceData;
  enabled: boolean;
  /** null: nothing published, the site shows the code's version. */
  published: ServiceContent | null;
  /** null: no unpublished changes. */
  draft: ServiceContent | null;
  /** 0 before the first change. Sent back with every change. */
  rev: number;
  publishedAt: string | null;
  updatedAt: string | null;
}

/** The services in the order the site lists them. */
const ORDER = servicesData.map((s) => s.slug);

export class ServicesNotSetUp extends Error {
  constructor() {
    super("The Services tab needs supabase/migrations/20261120120000_service_content.sql.");
  }
}

function isMissing(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    /studio_services|service_content/.test(error.message ?? "")
  );
}

/**
 * Every service, with its row. Throws ServicesNotSetUp before the migration
 * is run; any other failure throws as it is.
 */
export const listStudioServices = cache(async (session: StudioSession): Promise<StudioServiceRow[]> => {
  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_services", { p_account: session.account.id });
  if (error) {
    if (isMissing(error)) throw new ServicesNotSetUp();
    throw new Error(`Studio: could not load the services: ${error.message}`);
  }

  const rows = new Map((data ?? []).map((r) => [r.slug, r]));
  return ORDER.map((slug) => {
    const code = servicesData.find((s) => s.slug === slug) as ServiceData;
    const row = rows.get(slug);
    const read = (value: unknown, what: string) => {
      if (value === null || value === undefined) return null;
      const parsed = parseContent(value, code);
      if (!parsed) console.error(`Studio: the ${what} of "${slug}" is not valid content; ignored.`);
      return parsed;
    };
    return {
      slug,
      code,
      enabled: row?.enabled ?? true,
      published: read(row?.published, "published content"),
      draft: read(row?.draft, "draft"),
      rev: row?.rev ?? 0,
      publishedAt: row?.published_at ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
});

export async function getStudioService(session: StudioSession, slug: string): Promise<StudioServiceRow | null> {
  return (await listStudioServices(session)).find((s) => s.slug === slug) ?? null;
}

/** The service as the site shows it now: published content and the switch applied. */
export function liveOf(row: StudioServiceRow): ServiceData {
  const applied = row.published ? applyContent(row.code, row.published) : row.code;
  return row.enabled ? applied : { ...applied, off: true };
}

/**
 * For the service page in preview (draft mode): the service with its draft
 * applied, as the signed-in photographer would publish it. Null for anyone
 * who is not signed in to the Studio, or if it cannot be read: the page then
 * shows what visitors see.
 */
export async function previewService(slug: string): Promise<ServiceData | null> {
  try {
    const state = await getStudioState();
    if (state.kind !== "ok") return null;
    const row = await getStudioService(state.session, slug);
    if (!row) return null;
    const content = row.draft ?? row.published;
    const applied = content ? applyContent(row.code, content) : row.code;
    return row.enabled ? applied : { ...applied, off: true };
  } catch (e) {
    console.warn(`Studio: no preview of "${slug}": ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** A photo the editor shows: the cover, a rail photo, a choice in the picker. */
export interface ServicePhoto {
  id: string;
  path: string;
  fileName: string;
  ladder?: LadderSources;
  thumbhash?: string;
  /** Its shape, for a frame that holds it before it loads. */
  width?: number;
  height?: number;
  /** The album it is in. */
  album: string;
}

type PhotoRow = CoverRow & { file_name: string | null; width?: number | null; height?: number | null; galleries: unknown };

function albumTitle(row: PhotoRow): string {
  const g = Array.isArray(row.galleries) ? row.galleries[0] : row.galleries;
  return g && typeof g === "object" && "title" in g && typeof g.title === "string" ? g.title : "";
}

function toServicePhoto(row: PhotoRow, expiresAt: number): ServicePhoto {
  return {
    id: row.id,
    path: row.storage_path,
    fileName: row.file_name ?? row.storage_path.split("/").pop() ?? "",
    ladder: coverLadder("album", row, expiresAt),
    thumbhash: row.thumbhash ?? undefined,
    ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
    album: albumTitle(row),
  };
}

/**
 * What a cover can be: every photo in the account's published, public albums,
 * album by album. A cover anywhere else would not load for visitors.
 */
export async function coverChoices(session: StudioSession): Promise<ServicePhoto[]> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("photos")
    .select(`${COVER_COLUMNS}, file_name, width, height, sort_order, galleries!inner(title, kind, is_published, visibility, account_id)`)
    .eq("galleries.account_id", session.account.id)
    .eq("galleries.kind", "album")
    .eq("galleries.is_published", true)
    .eq("galleries.visibility", "public")
    .order("gallery_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`Studio: could not load the album photos: ${error.message}`);
  const expiresAt = nextExpiry();
  return (data ?? [])
    .map((r) => toServicePhoto(r as PhotoRow, expiresAt))
    .sort((a, b) => a.album.localeCompare(b.album));
}

/** Is this file in one of the account's published, public albums? */
export async function isPublicAlbumPhoto(session: StudioSession, path: string): Promise<boolean> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("photos")
    .select("id, galleries!inner(kind, is_published, visibility, account_id)")
    .eq("storage_path", path)
    .eq("galleries.account_id", session.account.id)
    .eq("galleries.kind", "album")
    .eq("galleries.is_published", true)
    .eq("galleries.visibility", "public")
    .limit(1);
  if (error) throw new Error(`Studio: could not check the cover: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The cover's photo, for the editor's preview. Undefined if it is in no album of the account. */
export async function coverPhoto(session: StudioSession, path: string): Promise<ServicePhoto | undefined> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("photos")
    .select(`${COVER_COLUMNS}, file_name, width, height, galleries!inner(title, kind, account_id)`)
    .eq("storage_path", path)
    .eq("galleries.account_id", session.account.id)
    .eq("galleries.kind", "album")
    .limit(1);
  if (error) throw new Error(`Studio: could not load the cover: ${error.message}`);
  const row = data?.[0];
  return row ? toServicePhoto(row as PhotoRow, nextExpiry()) : undefined;
}

/**
 * The photos on the service page's rail, in order, or "missing" before
 * 20261119120000_photo_placements.sql.
 */
export async function servicePhotos(session: StudioSession, slug: string): Promise<ServicePhoto[] | "missing"> {
  const supabase = await studioSupabase();
  const { data, error } = await supabase
    .from("photo_placements")
    .select(`position, photos!inner(${COVER_COLUMNS}, file_name, width, height, galleries!inner(title))`)
    .eq("account_id", session.account.id)
    .eq("place", servicePlace(slug))
    .order("position", { ascending: true });
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01" || /photo_placements/.test(error.message)) return "missing";
    throw new Error(`Studio: could not load the page's photos: ${error.message}`);
  }
  const expiresAt = nextExpiry();
  return (data ?? []).flatMap((r) => {
    const row = Array.isArray(r.photos) ? r.photos[0] : r.photos;
    return row ? [toServicePhoto(row as PhotoRow, expiresAt)] : [];
  });
}
