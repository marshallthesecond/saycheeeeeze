// src/app/[locale]/galleries/[slug]/page.tsx
//
// One client gallery. Three things can happen here:
//
//   locked   → the passkey screen
//   expired  → a note and your contact details
//   open     → the gallery, which is AlbumView, unchanged
//
// That last point is the whole design. A client gallery is an album with a
// door in front of it. Reusing AlbumView rather than copying it means the two
// can't drift: fix a swipe bug in the lightbox and both get it.
//
// force-dynamic because private galleries hand out signed URLs with a deadline
// baked in. Caching this route at the edge would serve the next visitor a set
// of tokens that expired hours ago — and, worse, would serve them to someone
// who never entered the code.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { getClientGallery, getGalleryContent } from "@/src/lib/client-galleries";
import { accessCookieName, verifyAccessCookie } from "@/src/lib/gallery-access";
import ClientGalleryView from "./ClientGalleryView";
import GalleryGate from "./GalleryGate";

export const dynamic = "force-dynamic";

/**
 * Module scope, not the component body. Reading the clock during render is
 * impure — harmless on a force-dynamic server component, but it trips the
 * React Compiler lint rule and it reads better out here anyway.
 */
function hasExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

/**
 * Never indexed, never followed, never summarised in a search result — not
 * even for a public client gallery. "Public" here means "no code required",
 * not "please put my client's graduation photos in Google Images".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const gallery = await getClientGallery(slug);

  return {
    title: gallery?.title ?? "Gallery",
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
  };
}

export default async function ClientGalleryPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;

  const gallery = await getClientGallery(slug);
  if (!gallery) notFound();

  if (hasExpired(gallery.expiresAt)) {
    return <GalleryGate slug={gallery.slug} title={gallery.title} state="expired" />;
  }

  if (gallery.visibility === "private") {
    const jar = await cookies();
    const unlocked = verifyAccessCookie(
      gallery.slug,
      jar.get(accessCookieName(gallery.slug))?.value,
    );

    if (!unlocked) {
      // Note what is NOT passed down: no photo list, no cover, no description.
      // The locked page must not contain the thing it is locking, however
      // hidden it is in the markup.
      return (
        <GalleryGate
          slug={gallery.slug}
          title={gallery.title}
          state="locked"
          photoCount={gallery.photoCount}
          dateLabel={gallery.dateLabel}
        />
      );
    }
  }

  const { photos, cover, coverLadder, coverThumbhash, signedUntil } =
    await getGalleryContent(gallery);

  return (
    <ClientGalleryView
      slug={gallery.slug}
      signedUntil={signedUntil}
      clientNote={gallery.clientNote}
      downloadTiers={gallery.downloadTiers}
      downloadEnabled={gallery.downloadEnabled}
      album={{
        slug: gallery.slug,
        title: gallery.title,
        date: gallery.dateLabel,
        location: gallery.location,
        year: gallery.year,
        description: gallery.description,
        cover: cover ?? "",
        coverLadder,
        coverThumbhash,
        color: gallery.accentColor,
        photographerHandle: gallery.photographerHandle,
        photos,
        photoCount: photos.length,
      }}
    />
  );
}