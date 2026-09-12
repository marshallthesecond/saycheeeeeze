// One client gallery: locked (the passkey screen), expired (a note and
// contact details), or open — and open is AlbumView, unchanged. A client
// gallery is an album with a door in front of it, so reusing AlbumView rather
// than copying it means the two can't drift.
//
// force-dynamic because the signed URLs carry a deadline. Caching this route
// would hand the next visitor expired tokens — and hand them to someone who
// never entered the code.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { getClientGallery, getGalleryContent } from "@/src/lib/client-galleries";
import { accessCookieName, verifyAccessCookie } from "@/src/lib/gallery-access";
import ClientGalleryView from "./ClientGalleryView";
import GalleryGate from "./GalleryGate";

export const dynamic = "force-dynamic";

/** Module scope: reading the clock during render trips the React Compiler
 *  lint rule, harmless as it is on a force-dynamic route. */
function hasExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

/** Never indexed, not even for a public client gallery — "public" means "no
 *  code required", not "put the client's photos in Google Images". */
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
      // Note what is not passed down: no photo list, no cover, no description.
      // The locked page must not contain the thing it is locking.
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