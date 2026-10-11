// Server shell so this route can export metadata — the interactive content
// lives in AboutContent.tsx, which is a client component.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { alternatesFor, pageMetadata } from "@/src/lib/seo";
import AboutContent from "./AboutContent";
import { getAllAlbums, getPhotosByPaths } from "@/src/lib/albums";
import { ABOUT_PHOTO_PATHS } from "./photos";

/**
 * CANONICALISED TO THE HOME PAGE, on purpose.
 *
 * `[locale]/page.tsx` renders this very component — the landing animation is
 * not launched yet — so /ru and /ru/about are byte-for-byte the same page on
 * two URLs. Left alone, that is textbook duplicate content: the ranking signal
 * splits between them and a search engine picks one on its own, which may not
 * be the one linked from everywhere else.
 *
 * Pointing /about at / consolidates both onto the URL the navigation, the
 * sitemap and every inbound link already use. /about is also removed from the
 * sitemap, because a sitemap should only ever list canonical URLs.
 *
 * WHEN THE LANDING PAGE SHIPS and / stops being this component, delete the
 * `canonical` override below and put /about back in the sitemap — at that
 * point they are two different pages and both deserve to be indexed.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const meta = pageMetadata("about", locale as Locale, "/about");
  return {
    ...meta,
    alternates: {
      // Each language still points at its own /about for hreflang — they are
      // genuine translations of each other — but the canonical names the home
      // page, which renders exactly this content.
      ...meta.alternates,
      canonical: alternatesFor(locale as Locale, "").canonical,
    },
  };
}

export default async function AboutPage() {
  // Resolved server-side so the client gets real dimensions, ThumbHashes and
  // derivative URLs in the first render payload.
  const [albums, photoIndex] = await Promise.all([
    getAllAlbums(),
    getPhotosByPaths(ABOUT_PHOTO_PATHS),
  ]);

  return <AboutContent albums={albums} photoIndex={photoIndex} />;
}