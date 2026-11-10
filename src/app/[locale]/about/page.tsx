// Server shell so this route can export metadata — the interactive content
// lives in AboutContent.tsx, which is a client component.
//
// Its own page since 2026-11-10. Until then the site root rendered this same
// component and /about canonicalised to the root to avoid duplicate content;
// now the root is the Home page, so /about keeps its own canonical and is back
// in the sitemap.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { pageMetadata } from "@/src/lib/seo";
import { getAllAlbums, getPhotosByPaths, getPortfolioPhotos } from "@/src/lib/albums";
import { BOOKING_LOCATIONS } from "@/src/lib/locations";
import { nextFreeDays } from "@/src/lib/next-free-days";
import { sessionSummaries } from "@/src/lib/session-summaries";
import { ABOUT_PER_VIEW, workPreview } from "@/src/lib/work-preview";
import AboutContent from "./AboutContent";
import { ABOUT_PHOTO_PATHS, SESSION_PHOTOS } from "./photos";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMetadata("about", locale as Locale, "/about");
}

/** Five minutes, for the next free days — see [locale]/page.tsx. */
export const revalidate = 300;

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? (raw as Locale) : "ru";

  // Resolved server-side so the client gets real dimensions, ThumbHashes and
  // derivative URLs in the first render payload.
  const [albums, portfolio, photoIndex, freeDays] = await Promise.all([
    getAllAlbums(),
    getPortfolioPhotos(),
    getPhotosByPaths(ABOUT_PHOTO_PATHS),
    nextFreeDays(3),
  ]);

  const sessions = sessionSummaries(locale, (slug) => {
    const path = SESSION_PHOTOS[slug];
    return path ? photoIndex[path] : undefined;
  });

  // The places a client can pick in the booking form today. Restricted ones
  // (an event venue, a retired park) are bookable only through their own
  // package, so they are not advertised here.
  const places = BOOKING_LOCATIONS.filter((l) => !l.restricted).map((l) => l.id);

  return (
    <AboutContent
      photoIndex={photoIndex}
      work={workPreview(portfolio, ABOUT_PER_VIEW)}
      albumsCount={albums.length}
      sessions={sessions}
      freeDays={freeDays}
      places={places}
    />
  );
}
