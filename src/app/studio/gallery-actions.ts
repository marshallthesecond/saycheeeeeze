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
  not_found: "notFound",
  not_member: "notFound",
  not_client: "notFound",
  photo_not_found: "notFound",
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
 */
function expireSiteCaches(slug: string): void {
  updateTag("albums");
  updateTag(`album:${slug.toLowerCase()}`);
  updateTag("client-galleries");
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

  expireSiteCaches(own.slug);
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

  expireSiteCaches(own.slug);
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

  expireSiteCaches(own.slug);
  redirect(STUDIO_HOME);
}
