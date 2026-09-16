// One photograph, one mark: keep, publish, delete, or cleared.
//
// The only endpoint in the app a client can WRITE through, so it is worth being
// explicit about what it can and cannot do. It sets a single text column on a
// single row, and only on a row whose gallery is the one the caller has already
// unlocked. It cannot create, delete, or touch a photograph in any other
// gallery, and "delete" is a word in a column — nothing here removes anything.
//
// Authorisation is the same cookie the photos route checks, for the same
// reason: the mark is as private as the photograph it is about.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getClientGallery } from "@/src/lib/client-galleries";
import { accessCookieName, verifyAccessCookie } from "@/src/lib/gallery-access";
import { parseMarkInput } from "@/src/lib/photo-marks";
import { supabaseAdmin } from "@/src/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A UUID and nothing else. The value goes into an `eq` filter, so this is
 *  belt-and-braces over PostgREST's own parameterisation — and it turns a
 *  malformed id into a 400 rather than a database error in the logs. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const gallery = await getClientGallery(slug);
  if (!gallery) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (gallery.expiresAt && new Date(gallery.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Identical to the photos route. A public client gallery has no gate to
  // check, which is a decision made there and mirrored here rather than
  // invented: if that gallery's photographs are readable without a code, so
  // are its marks.
  if (gallery.visibility === "private") {
    const jar = await cookies();
    const cookie = jar.get(accessCookieName(gallery.slug))?.value;
    if (!verifyAccessCookie(gallery.slug, cookie)) {
      return NextResponse.json({ error: "locked" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { photoId, mark: rawMark } = (body ?? {}) as {
    photoId?: unknown;
    mark?: unknown;
  };

  if (typeof photoId !== "string" || !UUID.test(photoId)) {
    return NextResponse.json({ error: "bad_photo_id" }, { status: 400 });
  }

  // `mark: null` is a real instruction — the client un-marking a photograph —
  // so it has to be distinguishable from a missing field, which is why this is
  // a result object rather than a nullable return.
  const parsed = parseMarkInput(rawMark ?? null);
  if (!parsed.ok) {
    return NextResponse.json({ error: "bad_mark" }, { status: 400 });
  }

  // THE line that keeps one client out of another's gallery. Without the
  // gallery_id filter, an unlocked client could mark any photograph in the
  // database by guessing an id — and ids travel to the browser, so they would
  // not even have to guess for a gallery they had once been shown.
  //
  // Service key because the anon RLS policy on photos is scoped to published
  // public galleries, which a private client gallery is not.
  const { data, error } = await (supabaseAdmin() as unknown as SupabaseClient)
    .from("photos")
    .update({
      client_mark: parsed.mark,
      client_marked_at: parsed.mark ? new Date().toISOString() : null,
    })
    .eq("id", photoId)
    .eq("gallery_id", gallery.id)
    .select("id, client_mark")
    .maybeSingle();

  if (error) {
    console.error(`[mark] ${slug}/${photoId}: ${error.message}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  // No row matched: the id is not in this gallery. Reported as not_found
  // rather than forbidden, so the response cannot be used to confirm that a
  // photograph exists somewhere else.
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    { photoId: data.id, mark: data.client_mark ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
