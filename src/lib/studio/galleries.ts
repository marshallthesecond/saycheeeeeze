// What the Studio's Galleries screen shows: every gallery in the account, with
// its cover and photo count.
//
// Read as the signed-in photographer, so Row Level Security is what stops one
// account seeing another's. The explicit account filter below is not for
// safety, it is for correctness: the visitor rules also let a member read
// other photographers' PUBLIC albums, and those do not belong in this list.

import "server-only";

import { type GalleryKind, type LadderSources } from "@/src/lib/ladder";
import { nextExpiry } from "@/src/lib/bunny-sign";
import { photoLadder } from "@/src/lib/photo-files";
import type { StudioSession } from "./session";
import { studioSupabase } from "./supabase";

export interface StudioGallery {
  id: string;
  slug: string;
  title: string;
  kind: GalleryKind;
  /** Not open to everyone. For a client gallery: a passkey is required. */
  isPrivate: boolean;
  isPublished: boolean;
  photoCount: number;
  dateLabel: string;
  accent: string;
  cover?: LadderSources;
  coverThumbhash?: string;
  /** Its page on the public site, without the language prefix. */
  href: string;
}

export interface CoverRow {
  id: string;
  gallery_id: string;
  storage_path: string;
  checksum8: string | null;
  thumbhash: string | null;
  variants: unknown;
  ladder_rev: number | null;
  files_at: string | null;
}

export const COVER_COLUMNS = "id, gallery_id, storage_path, checksum8, thumbhash, variants, ladder_rev, files_at";

/**
 * A photo's optimized versions for the Studio: from the public zone when its
 * files are in a public folder, signed from the private zone when they are
 * under clients/. Where the files ARE (photos.files_at), which since step 7
 * need not match the gallery the row is in now.
 */
export function coverLadder(kind: GalleryKind, row: CoverRow, expiresAt: number): LadderSources | undefined {
  return photoLadder(row, kind, expiresAt);
}

/** A gallery's page on the public site, without the language prefix. */
export function publicPath(kind: GalleryKind, slug: string): string {
  return kind === "client" ? `/galleries/${slug}` : `/albums/${slug}`;
}

export async function listStudioGalleries(session: StudioSession): Promise<StudioGallery[]> {
  const supabase = await studioSupabase();

  const { data, error } = await supabase
    .from("galleries")
    .select(
      "id, slug, title, kind, visibility, is_published, cover_path, accent_color, date_label, year, created_at, photos(count)",
    )
    .eq("account_id", session.account.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Studio: could not load galleries: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const countOf = (row: (typeof rows)[number]): number => {
    const first = Array.isArray(row.photos) ? row.photos[0] : undefined;
    return typeof first?.count === "number" ? first.count : 0;
  };

  // COVERS. One query for every gallery that names a cover. A gallery that
  // names none (most client galleries) shows its first photograph, as its own
  // page does, and that takes one small query each.
  const covers = new Map<string, CoverRow>();

  const named = rows.filter((r) => r.cover_path);
  if (named.length > 0) {
    const { data: found } = await supabase
      .from("photos")
      .select(COVER_COLUMNS)
      .in("gallery_id", named.map((r) => r.id))
      .in("storage_path", named.map((r) => r.cover_path as string));
    for (const row of found ?? []) {
      const owner = named.find((r) => r.id === row.gallery_id);
      // Both halves must match: the same path under another gallery is
      // another photograph.
      if (owner && owner.cover_path === row.storage_path) covers.set(row.gallery_id, row);
    }
  }

  const unnamed = rows.filter((r) => !covers.has(r.id) && countOf(r) > 0);
  await Promise.all(
    unnamed.map(async (r) => {
      const { data: first } = await supabase
        .from("photos")
        .select(COVER_COLUMNS)
        .eq("gallery_id", r.id)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .limit(1);
      if (first?.[0]) covers.set(r.id, first[0]);
    }),
  );

  // One deadline for every signed cover on the page.
  const expiresAt = nextExpiry();

  return rows.map((r) => {
    const kind: GalleryKind = r.kind === "client" ? "client" : "album";
    const cover = covers.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      kind,
      // Anything that is not exactly 'public' is closed, the same reading the
      // site itself takes (visibilityOf() in client-galleries.ts).
      isPrivate: r.visibility !== "public",
      isPublished: r.is_published,
      photoCount: countOf(r),
      dateLabel: r.date_label || r.year || "",
      accent: r.accent_color,
      cover: cover ? coverLadder(kind, cover, expiresAt) : undefined,
      coverThumbhash: cover?.thumbhash ?? undefined,
      href: publicPath(kind, r.slug),
    };
  });
}
