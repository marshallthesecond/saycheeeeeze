"use server";

// What the Services tab does: save the draft, publish it, throw it away, turn
// a service on or off, and order or trim the photos on its page.
//
// Every change is made by a database function as the signed-in photographer
// (20261120120000_service_content.sql). The draft is checked here, with the
// same parseContent() the site reads with, before it is stored, and checked
// again for completeness (every language written) before it is published.
//
// A Publish or the switch expires the site's "services" cache here and, when
// the Studio runs somewhere else, on the live site too. A draft touches
// nothing the site shows.

import { updateTag } from "next/cache";
import { alsoRefreshLiveSite } from "@/src/lib/studio/live-site";
import { requireStudio } from "@/src/lib/studio/session";
import {
  coverChoices,
  getStudioService,
  isPublicAlbumPhoto,
  type ServicePhoto,
} from "@/src/lib/studio/services";
import { studioSupabase } from "@/src/lib/studio/supabase";
import {
  contentFromCode,
  editableContent,
  parseContent,
  publishProblems,
  type Problem,
  type ServiceContent,
} from "@/src/lib/service-content";
import { servicePlace } from "@/src/lib/placements";
import { servicesData } from "@/src/lib/services";
import type { Json } from "@/src/lib/database.types";

/** `error` is a key under `services.errors` in the Studio dictionaries. */
export type ServiceResult =
  | { ok: true; rev: number }
  | { ok?: false; error: string; problems?: Problem[] };

const REASONS: Record<string, string> = {
  conflict: "conflict",
  stale: "stale",
  draft: "invalid",
  service: "invalid",
  place: "invalid",
  not_found: "notFound",
  not_signed_in: "notFound",
  nothing_to_publish: "nothingToPublish",
  photo_not_found: "notFound",
};

function reasonOf(error: { message?: string; code?: string } | null): string {
  const match = /studio:([a-z_]+)/.exec(error?.message ?? "");
  if (match) return REASONS[match[1]] ?? "failed";
  // The functions are not in the database: the migration is not run yet.
  if (error?.code === "PGRST202" || error?.code === "42883") return "notSetUp";
  return "failed";
}

function codeService(slug: string) {
  return servicesData.find((s) => s.slug === slug);
}

/** The site shows services from the "services" cache, here and on the live site. */
async function expireServices(): Promise<void> {
  updateTag("services");
  await alsoRefreshLiveSite("all");
}

/** The service pages' photo rails are cached with the albums. */
async function expirePhotos(): Promise<void> {
  updateTag("albums");
  await alsoRefreshLiveSite("all");
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

export async function saveServiceDraft(slug: string, rev: number, draft: unknown): Promise<ServiceResult> {
  const session = await requireStudio();
  const code = codeService(slug);
  if (!code) return { error: "notFound" };
  if (!Number.isInteger(rev) || rev < 0) return { error: "invalid" };
  const content = parseContent(draft, code);
  if (!content) return { error: "invalid" };

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_save_service_draft", {
    p_account: session.account.id,
    p_slug: slug,
    p_draft: content as unknown as Json,
    p_rev: rev,
  });
  if (error) return { error: reasonOf(error) };
  return { ok: true, rev: data };
}

export async function publishService(slug: string, rev: number): Promise<ServiceResult> {
  const session = await requireStudio();
  const code = codeService(slug);
  if (!code) return { error: "notFound" };

  let row;
  try {
    row = await getStudioService(session, slug);
  } catch {
    return { error: "notSetUp" };
  }
  if (!row) return { error: "notFound" };
  if (row.rev !== rev) return { error: "conflict" };
  if (!row.draft) return { error: "nothingToPublish" };

  const problems = publishProblems(row.draft, Boolean(code.packageGroups?.length));
  if (problems.length > 0) return { error: "incomplete", problems };

  // A cover chosen in the Studio has to be one visitors can load. The code's
  // own cover is let through as it is: the page has always had a way to show it.
  const cover = row.draft.cover.path;
  if (cover !== contentFromCode(code).cover.path && !(await isPublicAlbumPhoto(session, cover))) {
    return { error: "coverNotPublic", problems: [{ where: "cover", code: "cover" }] };
  }

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_publish_service", {
    p_account: session.account.id,
    p_slug: slug,
    p_rev: rev,
  });
  if (error) return { error: reasonOf(error) };

  await expireServices();
  return { ok: true, rev: data };
}

export type DiscardResult = { ok: true; rev: number; content: ServiceContent } | { ok?: false; error: string };

/** Throws the draft away. Answers with what the editor shows now: the published content, or the code's. */
export async function discardServiceDraft(slug: string, rev: number): Promise<DiscardResult> {
  const session = await requireStudio();
  const code = codeService(slug);
  if (!code) return { error: "notFound" };

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_discard_service_draft", {
    p_account: session.account.id,
    p_slug: slug,
    p_rev: rev,
  });
  if (error) return { error: reasonOf(error) };

  const row = await getStudioService(session, slug);
  return { ok: true, rev: data, content: editableContent(code, row?.published ?? null, null) };
}

// ---------------------------------------------------------------------------
// On and off
// ---------------------------------------------------------------------------

export async function setServiceEnabled(slug: string, on: boolean): Promise<{ ok: true } | { error: string }> {
  const session = await requireStudio();
  if (!codeService(slug) || typeof on !== "boolean") return { error: "notFound" };

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_set_service_enabled", {
    p_account: session.account.id,
    p_slug: slug,
    p_on: on,
  });
  if (error) return { error: reasonOf(error) };

  await expireServices();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** The photos a cover can be, for the picker. Loaded when it opens: there can be hundreds. */
export async function listCoverChoices(): Promise<ServicePhoto[] | { error: string }> {
  const session = await requireStudio();
  try {
    return await coverChoices(session);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return { error: "failed" };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's photos in a new order: every one of them, as the list was loaded. Live at once. */
export async function orderServicePhotos(slug: string, photoIds: string[]): Promise<{ ok: true } | { error: string }> {
  const session = await requireStudio();
  if (!codeService(slug)) return { error: "notFound" };
  if (!Array.isArray(photoIds) || photoIds.length > 100 || !photoIds.every((id) => UUID.test(id))) {
    return { error: "invalid" };
  }

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_order_place", {
    p_account: session.account.id,
    p_place: servicePlace(slug),
    p_photo_ids: photoIds,
  });
  if (error) return { error: reasonOf(error) };

  await expirePhotos();
  return { ok: true };
}

/** Takes one photo off the page. The photo stays in its album. Live at once. */
export async function removeServicePhoto(slug: string, photoId: string): Promise<{ ok: true } | { error: string }> {
  await requireStudio();
  if (!codeService(slug)) return { error: "notFound" };
  if (!UUID.test(photoId)) return { error: "invalid" };

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_place_photo", {
    p_photo_id: photoId,
    p_place: servicePlace(slug),
    p_on: false,
  });
  if (error) return { error: reasonOf(error) };

  await expirePhotos();
  return { ok: true };
}
