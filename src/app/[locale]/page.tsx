// The site root: the Home page. Rebuilt 2026-11-17 with three columns; on
// 2026-11-22 its middle column (Best picks, one album to look through, the
// Portraits pitch) and its Galleries stack moved to the About page, at
// Marshall's request, leaving the private-gallery door, the session types and
// the platform card. See HomeContent.tsx.
//
// Until 2026-11-10 this rendered the About page, and /about canonicalised to
// here because the two were the same page on two URLs. They are different
// pages now, so each keeps its own canonical and /about is in the sitemap.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { businessSchema, pageMetadata } from "@/src/lib/seo";
import { getAllAlbums, getPhotosByPaths } from "@/src/lib/albums";
import { getGalleryIndex } from "@/src/lib/client-galleries";
import { sessionSummaries } from "@/src/lib/session-summaries";
import { getLiveServices } from "@/src/lib/live-services";
import { HOME_PHOTO_PATHS, SESSION_PHOTOS } from "./about/photos";
import HomeContent from "./HomeContent";

// Localised per locale. A static `metadata` object cannot be, because it is
// evaluated once with no access to params — which is why /ru and /uz were
// both being described to searchers in English.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMetadata("home", locale as Locale);
}

/** Five minutes, like the About page. */
export const revalidate = 300;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? (raw as Locale) : "ru";
  const schema = businessSchema(locale);

  const [albums, photoIndex, galleries, liveServices] = await Promise.all([
    getAllAlbums(),
    getPhotosByPaths(HOME_PHOTO_PATHS),
    getGalleryIndex(),
    getLiveServices(),
  ]);

  // As the site shows them: the Studio's titles and prices. A service turned
  // off is not listed.
  const sessions = sessionSummaries(
    locale,
    (slug) => {
      const path = SESSION_PHOTOS[slug];
      return path ? photoIndex[path] : undefined;
    },
    liveServices,
  );

  return (
    <>
      {/* The home page is where the business entity belongs: one copy, on the
          URL every other page points back to. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <HomeContent albums={albums} galleries={galleries} sessions={sessions} />
    </>
  );
}
