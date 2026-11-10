// The site root: the Home page (2026-11-10). Three columns — the profile, the
// work, and albums + sessions. See HomeContent.tsx for the layout.
//
// Until 2026-11-10 this rendered the About page, and /about canonicalised to
// here because the two were the same page on two URLs. They are different
// pages now, so each keeps its own canonical and /about is back in the sitemap.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { businessSchema, pageMetadata } from "@/src/lib/seo";
import { getAllAlbums, getPhotosByPaths, getPortfolioPhotos } from "@/src/lib/albums";
import { getGalleryIndex } from "@/src/lib/client-galleries";
import { nextFreeDays } from "@/src/lib/next-free-days";
import { sessionSummaries } from "@/src/lib/session-summaries";
import { HOME_PER_VIEW, workPreview } from "@/src/lib/work-preview";
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

/**
 * Five minutes. The photographs are cached for an hour underneath (and
 * /api/sync refreshes them at once); what goes stale fastest here is the "next
 * free day", which should not still show a day that was booked this morning.
 */
export const revalidate = 300;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? (raw as Locale) : "ru";
  const schema = businessSchema(locale);

  const [albums, photoIndex, portfolio, galleries, freeDays] = await Promise.all([
    getAllAlbums(),
    getPhotosByPaths(HOME_PHOTO_PATHS),
    getPortfolioPhotos(),
    getGalleryIndex(),
    nextFreeDays(3),
  ]);

  const sessions = sessionSummaries(locale, (slug) => {
    const path = SESSION_PHOTOS[slug];
    return path ? photoIndex[path] : undefined;
  });

  return (
    <>
      {/* The home page is where the business entity belongs: one copy, on the
          URL every other page points back to. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <HomeContent
        albums={albums}
        photoIndex={photoIndex}
        work={workPreview(portfolio, HOME_PER_VIEW)}
        galleries={galleries}
        sessions={sessions}
        freeDays={freeDays}
      />
    </>
  );
}
