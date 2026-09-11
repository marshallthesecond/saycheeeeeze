// src/app/api/galleries/[slug]/photos/route.ts
//
// Hands back a freshly signed photo list for a gallery the caller has already
// unlocked. Signed URLs last six hours; a client who leaves the tab open
// overnight would otherwise come back to a page of broken images.
//
// This grants nothing the visitor didn't already have — it re-signs what the
// page they are looking at already showed them. The cookie check is still
// here, because "they must already have it" is an assumption, and assumptions
// are how endpoints leak.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getClientGallery, getGalleryContent } from "@/src/lib/client-galleries";
import { accessCookieName, verifyAccessCookie } from "@/src/lib/gallery-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
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

  if (gallery.visibility === "private") {
    const jar = await cookies();
    const cookie = jar.get(accessCookieName(gallery.slug))?.value;
    if (!verifyAccessCookie(gallery.slug, cookie)) {
      return NextResponse.json({ error: "locked" }, { status: 401 });
    }
  }

  const { photos, cover, coverLadder, signedUntil } =
    await getGalleryContent(gallery);

  return NextResponse.json(
    // coverLadder carries its own signature, so it lapses with everything
    // else and has to be re-issued here too.
    { photos, cover, coverLadder, signedUntil },
    // Signed URLs must never be cached by a shared cache — the next visitor
    // would get someone else's still-valid tokens.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}