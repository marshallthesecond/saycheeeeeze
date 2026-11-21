"use server";

// Everything the Studio can change about a gallery.
//
// Each action starts with requireStudio(), then talks to Supabase as the
// signed-in photographer. The rules that matter are in the database
// (20261115100000_studio_gallery_writes.sql): which columns a member may
// change, and the four studio_ functions for what a plain UPDATE must not do.
// The checks here exist to give a clear sentence, not to be the lock.

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { TablesUpdate } from "@/src/lib/database.types";
import { SITE_URL } from "@/src/lib/seo";
import type { DownloadTier, GalleryKind } from "@/src/lib/ladder";
import { STUDIO_HOME, studioGalleryPath } from "@/src/lib/studio/config";
import { endOfStudioDay } from "@/src/lib/studio/gallery";
import { publicPath } from "@/src/lib/studio/galleries";
import { alsoRefreshLiveSite } from "@/src/lib/studio/live-site";
import { isPlace } from "@/src/lib/placements";
import { nextExpiry } from "@/src/lib/bunny-sign";
import { originalUrl } from "@/src/lib/photo-files";
import { PASSKEY_MAX, PASSKEY_MIN, generatePasskey } from "@/src/lib/studio/passkey";
import { requireStudio } from "@/src/lib/studio/session";
import { categoryProblem, isValidSlug, slugify } from "@/src/lib/studio/slug";
import { studioSupabase } from "@/src/lib/studio/supabase";

/** What a form gets back. `error` is a key under `errors` in the Studio dictionaries. */
export interface FormState {
  ok?: boolean;
  error?: string;
  /** What was typed, sent back so a refused form is not emptied. */
  values?: Record<string, string>;
}

export interface CreatedGallery {
  slug: string;
  title: string;
  /** The link to send the client. No language in it: the site picks one. */
  url: string;
  /** Shown once. Not stored anywhere readable after this. */
  code: string;
}

export interface CreateState extends FormState {
  created?: CreatedGallery;
}

export interface PasskeyState extends FormState {
  created?: { code: string; label: string };
}

export interface DeletePhotosState extends FormState {
  /** How many photos went. */
  deleted?: number;
}

export interface SendPhotosState extends FormState {
  /** Published (from a client gallery) or moved (from an album). */
  done?: number;
  /** Already in the album: left as they were. */
  skipped?: number;
  /** Where they went, for the link in the message. */
  to?: { title: string; href: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const str = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** Every text field of a form, for sending back with a refusal. */
function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    // Never the passkey: a refused form should not carry a secret back and forth.
    if (typeof v === "string" && !k.startsWith("$") && k !== "code") out[k] = v;
  }
  return out;
}

// The reasons the studio_ functions raise, and the sentence each one gets.
const REASONS: Record<string, string> = {
  slug_taken: "slugTaken",
  slug_format: "slugFormat",
  folder_taken: "folderTaken",
  category_format: "categoryFormat",
  category_reserved: "categoryReserved",
  title_length: "titleLength",
  code_length: "codeLength",
  code_in_use: "codeInUse",
  too_many_codes: "tooManyCodes",
  label_length: "labelLength",
  has_photos: "hasPhotos",
  busy: "busy",
  photos: "invalid",
  same_gallery: "sameGallery",
  target_private: "targetPrivate",
  from_private: "invalid",
  from_public: "invalid",
  already_public: "alreadyPublic",
  not_private_origin: "notPrivateOrigin",
  not_found: "notFound",
  not_member: "notFound",
  not_client: "notFound",
  photo_not_found: "notFound",
  not_album: "notAlbum",
  place: "invalid",
  place_full: "placeFull",
  name: "photoName",
  description: "photoDescription",
  tags: "photoTags",
  invalid: "invalid",
};

/** A Supabase error -> a key under `errors`. */
function reasonOf(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? "";
  const match = /studio:([a-z_]+)/.exec(message);
  if (match) return REASONS[match[1]] ?? "failed";
  // PGRST202: the function is not in the database. 42501: the column grant is
  // missing. Both mean the step-3 migration has not been run on this project.
  if (error?.code === "PGRST202" || error?.code === "42501") return "notSetUp";
  // 23514: a table rule refused the value (a colour that is not #rrggbb, ...).
  if (error?.code === "23514") return "invalid";
  return "failed";
}

/**
 * The columns a member may change. The same list as the column grant in the
 * migration: anything outside it is refused by Postgres, so there is no point
 * in this file being able to name it.
 */
type GalleryPatch = Pick<
  TablesUpdate<"galleries">,
  | "title"
  | "date_label"
  | "location"
  | "year"
  | "description"
  | "accent_color"
  | "is_published"
  | "visibility"
  | "is_listed"
  | "list_label"
  | "client_note"
  | "expires_at"
  | "download_enabled"
  | "download_tiers"
>;

interface Own {
  id: string;
  slug: string;
  kind: GalleryKind;
}

/** The gallery with this id, if it is in the signed-in account. */
async function ownGallery(galleryId: string): Promise<Own | null> {
  const session = await requireStudio();
  if (!/^[0-9a-f-]{36}$/i.test(galleryId)) return null;

  const supabase = await studioSupabase();
  const { data } = await supabase
    .from("galleries")
    .select("id, slug, kind")
    .eq("account_id", session.account.id)
    .eq("id", galleryId)
    .limit(1);

  const row = data?.[0];
  return row ? { id: row.id, slug: row.slug, kind: row.kind === "client" ? "client" : "album" } : null;
}

/**
 * The public site keeps album lists and the gallery picker in a cache. After a
 * change, expire them so the next visitor gets the new state, not the old one
 * once more: an album that was just unpublished must be gone on the next load.
 * A client gallery's own page is never cached, so it needs nothing.
 *
 * And the live site too, when the Studio runs somewhere else (a preview).
 */
async function expireSiteCaches(slug: string): Promise<void> {
  updateTag("albums");
  updateTag(`album:${slug.toLowerCase()}`);
  updateTag("client-galleries");
  await alsoRefreshLiveSite(slug);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createGallery(_prev: CreateState, form: FormData): Promise<CreateState> {
  const session = await requireStudio();
  const values = echo(form);

  const kind: GalleryKind = form.get("kind") === "client" ? "client" : "album";
  const title = str(form, "title");
  const slug = str(form, "slug") || slugify(title);
  const picked = str(form, "category");
  const category = picked === "$new" ? str(form, "newCategory") : picked;
  const code = kind === "client" ? str(form, "code") : "";

  if (!title || title.length > 200) return { error: "titleLength", values };
  if (!isValidSlug(slug)) return { error: "slugFormat", values };
  if (kind === "album") {
    const problem = categoryProblem(category);
    if (problem) return { error: problem === "reserved" ? "categoryReserved" : "categoryFormat", values };
  }
  if (code && (code.length < PASSKEY_MIN || code.length > PASSKEY_MAX)) {
    return { error: "codeLength", values };
  }

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_create_gallery", {
    p_account_id: session.account.id,
    p_kind: kind,
    p_title: title,
    p_slug: slug,
    p_category: kind === "album" ? category : undefined,
    p_date_label: str(form, "dateLabel"),
    p_location: str(form, "location"),
    p_passkey: code || undefined,
    p_passkey_label: str(form, "codeLabel") || undefined,
  });

  if (error) {
    console.error(`studio_create_gallery failed: ${error.message}`);
    return { error: reasonOf(error), values };
  }

  // A new gallery is not published, so nothing on the public site changed and
  // no cache needs expiring.
  if (kind === "client" && code) {
    // Stay on the form: this answer is the one time the passkey can be shown.
    return {
      ok: true,
      created: { slug, title, code, url: `${SITE_URL}${publicPath(kind, slug)}` },
    };
  }

  // Outside any try/catch: redirect() works by throwing.
  redirect(studioGalleryPath(slug));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveDetails(_prev: FormState, form: FormData): Promise<FormState> {
  const values = echo(form);
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return { error: "notFound", values };

  const title = str(form, "title");
  const accent = str(form, "accent").toLowerCase();
  if (!title || title.length > 200) return { error: "titleLength", values };
  if (!/^#[0-9a-f]{6}$/.test(accent)) return { error: "invalid", values };

  const patch: GalleryPatch = {
    title,
    date_label: str(form, "dateLabel").slice(0, 120),
    location: str(form, "location").slice(0, 120),
    year: str(form, "year").slice(0, 20),
    description: str(form, "description").slice(0, 4000),
    accent_color: accent,
  };

  if (own.kind === "client") {
    const closesOn = str(form, "closesOn");
    const expiresAt = closesOn ? endOfStudioDay(closesOn) : null;
    if (closesOn && !expiresAt) return { error: "invalid", values };
    patch.client_note = str(form, "clientNote").slice(0, 4000) || null;
    patch.list_label = str(form, "listLabel").slice(0, 120) || null;
    patch.expires_at = expiresAt;
  }

  return applyPatch(own, patch, values);
}

export async function savePublishing(_prev: FormState, form: FormData): Promise<FormState> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return { error: "notFound" };

  const patch: GalleryPatch = { is_published: form.get("published") === "on" };
  if (own.kind === "client") patch.is_listed = form.get("listed") === "on";

  return applyPatch(own, patch);
}

const TIERS: DownloadTier[] = ["share", "full", "original"];

export async function saveDownloads(_prev: FormState, form: FormData): Promise<FormState> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own || own.kind !== "client") return { error: "notFound" };

  const tiers = TIERS.filter((tier) => form.get(`tier-${tier}`) === "on");
  // The table refuses an empty list too; this just says it in a sentence.
  if (tiers.length === 0) return { error: "noTiers" };

  return applyPatch(own, {
    download_enabled: form.get("enabled") === "on",
    download_tiers: tiers,
  });
}

/** The Publish / Unpublish button in a gallery's header. */
export async function setPublished(form: FormData): Promise<void> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return;
  await applyPatch(own, { is_published: form.get("to") === "published" });
}

/** Client galleries: passkey required, or open to anyone with the link. */
export async function setAccess(_prev: FormState, form: FormData): Promise<FormState> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own || own.kind !== "client") return { error: "notFound" };
  return applyPatch(own, { visibility: form.get("to") === "public" ? "public" : "private" });
}

async function applyPatch(
  own: Own,
  patch: GalleryPatch,
  values?: Record<string, string>,
): Promise<FormState> {
  const session = await requireStudio();
  const supabase = await studioSupabase();

  const { data, error } = await supabase
    .from("galleries")
    .update(patch)
    .eq("id", own.id)
    .eq("account_id", session.account.id)
    .select("id");

  if (error) {
    console.error(`Studio: updating gallery "${own.slug}" failed: ${error.message}`);
    return { error: reasonOf(error), values };
  }
  // No error and no row: Row Level Security filtered it out.
  if (!data || data.length === 0) return { error: "notFound", values };

  await expireSiteCaches(own.slug);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

export async function setCover(form: FormData): Promise<void> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return;

  const photo = str(form, "photo");
  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_set_cover", {
    p_gallery_id: own.id,
    p_photo_id: photo || undefined,
  });
  if (error) {
    console.error(`studio_set_cover failed for "${own.slug}": ${error.message}`);
    return;
  }

  await expireSiteCaches(own.slug);
  refresh();
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

export async function addPasskey(_prev: PasskeyState, form: FormData): Promise<PasskeyState> {
  const values = echo(form);
  const own = await ownGallery(str(form, "galleryId"));
  if (!own || own.kind !== "client") return { error: "notFound", values };

  // Left empty, the Studio makes one up.
  const code = str(form, "code") || generatePasskey();
  const label = str(form, "label");
  if (code.length < PASSKEY_MIN || code.length > PASSKEY_MAX) return { error: "codeLength", values };
  if (label.length > 80) return { error: "labelLength", values };

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_create_passkey", {
    p_gallery_id: own.id,
    p_code: code,
    p_label: label || undefined,
  });
  if (error) {
    console.error(`studio_create_passkey failed for "${own.slug}": ${error.message}`);
    return { error: reasonOf(error), values };
  }

  refresh();
  return { ok: true, created: { code, label: label || "client" } };
}

export async function revokePasskey(form: FormData): Promise<void> {
  const own = await ownGallery(str(form, "galleryId"));
  const passkey = str(form, "passkey");
  if (!own || !/^[0-9a-f-]{36}$/i.test(passkey)) return;

  const supabase = await studioSupabase();
  // No .select(): the grant on this table is column by column, and asking for
  // nothing back is the request that cannot trip over it.
  const { error } = await supabase
    .from("gallery_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", passkey)
    .eq("gallery_id", own.id)
    .is("revoked_at", null);
  if (error) console.error(`Studio: revoking a passkey of "${own.slug}" failed: ${error.message}`);

  refresh();
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteGallery(_prev: FormState, form: FormData): Promise<FormState> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return { error: "notFound" };

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_delete_gallery", { p_gallery_id: own.id });
  if (error) {
    console.error(`studio_delete_gallery failed for "${own.slug}": ${error.message}`);
    return { error: reasonOf(error) };
  }

  await expireSiteCaches(own.slug);
  redirect(STUDIO_HOME);
}

// ---------------------------------------------------------------------------
// Deleting photos
// ---------------------------------------------------------------------------

/**
 * Takes the chosen photos out of the gallery. Their rows go at once; the
 * worker removes their files from storage (studio_delete_photos queues it).
 */
export async function deletePhotos(_prev: DeletePhotosState, form: FormData): Promise<DeletePhotosState> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return { error: "notFound" };

  const ids = [...new Set(form.getAll("photo").map(String))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0 || ids.length > 500) return { error: "invalid" };

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_delete_photos", { p_gallery_id: own.id, p_photo_ids: ids });
  if (error) {
    console.error(`studio_delete_photos failed for "${own.slug}": ${error.message}`);
    // PGRST202: the step-6 migration is not in the database yet.
    return { error: error.code === "PGRST202" ? "needsUpdate" : reasonOf(error) };
  }

  await expireSiteCaches(own.slug);
  refresh();
  const deleted = (data as { deleted?: unknown } | null)?.deleted;
  return { ok: true, deleted: typeof deleted === "number" ? deleted : ids.length };
}

/** The Uploads page's Try again, for files the worker could not remove. */
export async function retryCleanup(): Promise<void> {
  await requireStudio();
  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_retry_cleanup");
  if (error) console.error(`studio_retry_cleanup failed: ${error.message}`);
  refresh();
}

// ---------------------------------------------------------------------------
// Publishing and moving photos (step 7)
// ---------------------------------------------------------------------------

/**
 * The chosen photos into an album: from a client gallery they are published
 * (they stay there too), from an album they move. Rows only: no file is
 * copied, so it takes as long as one database call.
 *
 * to = an album's id, or "new" with title and category for a new album,
 * made published so the photos are on the site at once.
 */
export async function sendPhotos(_prev: SendPhotosState, form: FormData): Promise<SendPhotosState> {
  const session = await requireStudio();
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return { error: "notFound" };

  const ids = [...new Set(form.getAll("photo").map(String))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0 || ids.length > 500) return { error: "invalid" };

  const supabase = await studioSupabase();
  const to = str(form, "to");
  let target: { id: string; slug: string; title: string } | null = null;

  if (to === "new") {
    const title = str(form, "title");
    const category = str(form, "category");
    if (!title || title.length > 200) return { error: "titleLength" };
    const problem = categoryProblem(category);
    if (problem) return { error: problem === "reserved" ? "categoryReserved" : "categoryFormat" };

    // The address from the title; -2, -3 when it is taken.
    const base = slugify(title);
    if (!isValidSlug(base)) return { error: "slugFormat" };
    for (let n = 1; n <= 9 && !target; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const { data, error } = await supabase.rpc("studio_create_gallery", {
        p_account_id: session.account.id,
        p_kind: "album",
        p_title: title,
        p_slug: slug,
        p_category: category,
        p_date_label: "",
        p_location: "",
      });
      if (!error && data) target = { id: String(data), slug, title };
      else if (!/studio:(slug_taken|folder_taken)/.test(error?.message ?? "")) {
        console.error(`studio_create_gallery failed: ${error?.message}`);
        return { error: reasonOf(error) };
      }
    }
    if (!target) return { error: "slugTaken" };
    const { error: pubError } = await supabase.from("galleries").update({ is_published: true }).eq("id", target.id);
    if (pubError) console.error(`could not publish the new album "${target.slug}": ${pubError.message}`);
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(to)) return { error: "invalid" };
    const { data } = await supabase
      .from("galleries")
      .select("id, slug, title, kind")
      .eq("id", to)
      .eq("account_id", session.account.id)
      .limit(1);
    const row = data?.[0];
    if (!row) return { error: "notFound" };
    if (row.kind !== "album") return { error: "targetPrivate" };
    target = { id: row.id, slug: row.slug, title: row.title };
  }

  const fn = own.kind === "client" ? "studio_publish_photos" : "studio_move_photos";
  const { data, error } = await supabase.rpc(fn, { p_from: own.id, p_photo_ids: ids, p_to: target.id });
  if (error) {
    console.error(`${fn} failed from "${own.slug}" to "${target.slug}": ${error.message}`);
    return { error: error.code === "PGRST202" ? "needsUpdate" : reasonOf(error) };
  }

  await expireSiteCaches(own.slug);
  await expireSiteCaches(target.slug);
  refresh();
  const answer = (data ?? {}) as { added?: number; moved?: number; skipped?: number };
  return {
    ok: true,
    done: Number(answer.added ?? answer.moved ?? 0),
    skipped: Number(answer.skipped ?? 0),
    to: { title: target.title, href: studioGalleryPath(target.slug) },
  };
}

/**
 * A client gallery onto the Portfolio as an album (to=public, with a
 * category), or back to private (to=private). Instant: rows only.
 */
export async function setGalleryPublic(_prev: FormState, form: FormData): Promise<FormState> {
  const own = await ownGallery(str(form, "galleryId"));
  if (!own) return { error: "notFound" };
  const makePublic = str(form, "to") === "public";
  const category = str(form, "category");
  if (makePublic) {
    const problem = categoryProblem(category);
    if (problem) return { error: problem === "reserved" ? "categoryReserved" : "categoryFormat" };
  }

  const supabase = await studioSupabase();
  const { error } = await supabase.rpc("studio_set_gallery_public", {
    p_gallery_id: own.id,
    p_public: makePublic,
    p_category: makePublic ? category : undefined,
  });
  if (error) {
    console.error(`studio_set_gallery_public failed for "${own.slug}": ${error.message}`);
    return { error: error.code === "PGRST202" ? "needsUpdate" : reasonOf(error) };
  }

  await expireSiteCaches(own.slug);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Where a photo is shown: Best picks and the service pages ("Add to...")
// ---------------------------------------------------------------------------

export interface PlaceResult {
  /** Every place the photo is in now, sorted. */
  places?: string[];
  error?: string;
}

/**
 * Put a photo on a place's list (at the end), or take it off. Plain arguments
 * rather than a form: the menu on each photo calls it on a click, and the
 * grid updates from what comes back.
 *
 * Only album photos go on: a client photo is published to an album first. The
 * database decides that too (studio_place_photo); this gives the sentence.
 */
export async function placePhoto(galleryId: string, photoId: string, place: string, on: boolean): Promise<PlaceResult> {
  const own = await ownGallery(galleryId);
  if (!own) return { error: "notFound" };
  if (!isPlace(place) || !/^[0-9a-f-]{36}$/i.test(photoId)) return { error: "invalid" };
  if (on && own.kind !== "album") return { error: "notAlbum" };

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_place_photo", {
    p_photo_id: photoId,
    p_place: place,
    p_on: on,
  });
  if (error) {
    // PGRST202: the function is not in the database: the migration is not run yet.
    return { error: error.code === "PGRST202" ? "placesNotSetUp" : reasonOf(error) };
  }

  // Best picks and the service pages are cached under "albums", here and on
  // the live site.
  await expireSiteCaches(own.slug);
  return { places: data ?? [] };
}

// ---------------------------------------------------------------------------
// One photo's details: name, description, tags, shown or hidden (2026-11-21)
// ---------------------------------------------------------------------------

/** What a photo's details are after a change. */
export interface PhotoDetails {
  /** The name given in the Studio, or null for the file's own. */
  name: string | null;
  fileName: string;
  description: string | null;
  tags: string[];
  hidden: boolean;
}

export type PhotoResult = { ok: true; photo: PhotoDetails } | { ok?: false; error: string };

export interface PhotoChanges {
  name?: string | null;
  description?: string | null;
  tags?: string[];
  hidden?: boolean;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Is the photo in this gallery? The database checks the account; this checks the gallery. */
async function inGallery(galleryId: string, photoId: string): Promise<{ storage_path: string } | null> {
  if (!UUID.test(photoId)) return null;
  const supabase = await studioSupabase();
  const { data } = await supabase
    .from("photos")
    .select("storage_path")
    .eq("id", photoId)
    .eq("gallery_id", galleryId)
    .limit(1);
  return data?.[0] ?? null;
}

/**
 * Renames, describes, tags, hides or shows one photo. Only the keys given
 * change. Renaming changes the name only: the stored file keeps its address.
 */
export async function updatePhoto(galleryId: string, photoId: string, changes: PhotoChanges): Promise<PhotoResult> {
  const own = await ownGallery(galleryId);
  if (!own) return { error: "notFound" };
  if (!(await inGallery(own.id, photoId))) return { error: "notFound" };

  const patch: Record<string, unknown> = {};
  if ("name" in changes) patch.name = changes.name ?? null;
  if ("description" in changes) patch.description = changes.description ?? null;
  if ("tags" in changes) patch.tags = Array.isArray(changes.tags) ? changes.tags : null;
  if ("hidden" in changes) patch.hidden = changes.hidden;
  if (Object.keys(patch).length === 0) return { error: "invalid" };

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_update_photo", { p_photo_id: photoId, p_changes: patch as never });
  if (error) {
    // PGRST202: the function is not in the database: the migration is not run yet.
    return { error: error.code === "PGRST202" ? "detailsNotSetUp" : reasonOf(error) };
  }

  await expireSiteCaches(own.slug);
  refresh();
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    photo: {
      name: typeof d.name === "string" ? d.name : null,
      fileName: typeof d.fileName === "string" ? d.fileName : "",
      description: typeof d.description === "string" ? d.description : null,
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : [],
      hidden: d.hidden === true,
    },
  };
}

/** Hides or shows many photos of one gallery at once. */
export async function setPhotosHidden(
  galleryId: string,
  photoIds: string[],
  hidden: boolean,
): Promise<{ ok: true; changed: number } | { ok?: false; error: string }> {
  const own = await ownGallery(galleryId);
  if (!own) return { error: "notFound" };
  const ids = [...new Set(photoIds)].filter((id) => UUID.test(id));
  if (ids.length === 0 || ids.length > 500 || typeof hidden !== "boolean") return { error: "invalid" };

  const supabase = await studioSupabase();
  const { data, error } = await supabase.rpc("studio_set_photos_hidden", {
    p_gallery_id: own.id,
    p_photo_ids: ids,
    p_hidden: hidden,
  });
  if (error) return { error: error.code === "PGRST202" ? "detailsNotSetUp" : reasonOf(error) };

  await expireSiteCaches(own.slug);
  refresh();
  return { ok: true, changed: Number(data ?? 0) };
}

/**
 * The address of the photo's original file, for Download original. Signed
 * for a few days when the file is in the private zone.
 */
export async function originalLink(galleryId: string, photoId: string): Promise<{ url: string } | { error: string }> {
  const own = await ownGallery(galleryId);
  if (!own) return { error: "notFound" };
  const row = await inGallery(own.id, photoId);
  if (!row) return { error: "notFound" };
  const url = originalUrl(row.storage_path, nextExpiry());
  return url ? { url } : { error: "failed" };
}
