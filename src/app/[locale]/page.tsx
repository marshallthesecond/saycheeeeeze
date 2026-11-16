// The site root: the Home page. Rebuilt 2026-11-17 as one column, phone
// first: eight quick-access tiles, Best picks, one album to look through (a
// different one each visit), and the Portraits session pitched properly. See
// HomeContent.tsx for the layout. The profile panel that used to be the left
// column is the About page's main section now.
//
// Until 2026-11-10 this rendered the About page, and /about canonicalised to
// here because the two were the same page on two URLs. They are different
// pages now, so each keeps its own canonical and /about is in the sitemap.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { businessSchema, pageMetadata } from "@/src/lib/seo";
import { getAlbumPhotos, getAllAlbums, getPhotosByPaths, getPortfolioPhotos, type AlbumData } from "@/src/lib/albums";
import { getGalleryIndex } from "@/src/lib/client-galleries";
import { sessionSummaries } from "@/src/lib/session-summaries";
import { formatSom } from "@/src/lib/packages";
import { PROFILE } from "@/src/lib/profile";
import { entryPackage, getServiceBySlug, offeredPackages, pickLocale } from "@/src/lib/services";
import { formatDelivery, formatPhotoCountShort, packageDuration } from "@/src/lib/service-format";
import { daySeed, shuffleWithSeed } from "@/src/lib/work-preview";
import type { ShelfAlbum } from "@/src/components/home/AlbumShelf";
import type { PortraitsPitchData } from "@/src/components/home/PortraitsPitch";
import { BEST_PICKS, HOME_PHOTO_PATHS, SESSION_PHOTOS } from "./about/photos";
import { PICKS_WANTED } from "./about/best-picks";
import HomeContent, { type ExtraPick } from "./HomeContent";

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
 * /api/sync refreshes them at once). It also rotates the albums the shelf can
 * pick from, below.
 */
export const revalidate = 300;

/** Albums the shelf chooses between in the browser; one is shown per visit. */
const SHELF_CANDIDATES = 4;
/** An album with fewer photographs than this is not worth a shelf. */
const SHELF_MIN_PHOTOS = 4;
/** Photographs per shelf; a longer album ends with a card to the album. */
const SHELF_MAX_PHOTOS = 24;
/** The Portraits pitch: its session type and how many of its photographs. */
const PITCH_SERVICE = "portraits";
const PITCH_PHOTOS = 3;

/**
 * `n` of `items`, in a random order. A fresh draw each time the page is
 * rebuilt (every five minutes at most), which is the point: the shelf's
 * choice of albums moves on through the day.
 */
function pickAtRandom<T>(items: readonly T[], n: number): T[] {
  return items
    .map((item) => ({ item, r: Math.random() }))
    .sort((x, y) => x.r - y.r)
    .slice(0, n)
    .map((x) => x.item);
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? (raw as Locale) : "ru";
  const schema = businessSchema(locale);
  const L = (v: Parameters<typeof pickLocale>[0]) => pickLocale(v, locale);

  const service = getServiceBySlug(PITCH_SERVICE);
  const pitchPaths = (service?.galleryPaths ?? []).slice(0, PITCH_PHOTOS);

  const [albums, photoIndex, portfolio, galleries] = await Promise.all([
    getAllAlbums(),
    getPhotosByPaths([...HOME_PHOTO_PATHS, ...pitchPaths]),
    getPortfolioPhotos(),
    getGalleryIndex(),
  ]);

  const sessions = sessionSummaries(locale, (slug) => {
    const path = SESSION_PHOTOS[slug];
    return path ? photoIndex[path] : undefined;
  });

  // The cheapest session on offer, for the Services tile.
  const prices = PROFILE.sessions
    .map((slug) => {
      const s = getServiceBySlug(slug);
      return s ? entryPackage(s)?.priceUzs : undefined;
    })
    .filter((n): n is number => typeof n === "number");
  const servicesFrom = prices.length > 0 ? formatSom(Math.min(...prices), locale) : null;

  // Best picks are chosen by hand. While there are fewer than the grid holds,
  // the rest come from the portfolio, the same ones all day.
  const visible = portfolio.filter((p) => !p.hidden);
  const chosen = new Set(BEST_PICKS.map((p) => photoIndex[p.path]?.src).filter(Boolean));
  const extraPicks: ExtraPick[] = shuffleWithSeed(
    visible.filter((p) => !chosen.has(p.src)),
    daySeed(),
  )
    .slice(0, Math.max(0, PICKS_WANTED - BEST_PICKS.length))
    .map(({ category, hidden: _hidden, ...photo }) => {
      void _hidden;
      return { photo, category };
    });

  // The shelf: a few albums picked at random each time the page is rebuilt;
  // the browser then shows one of them, a different one from last visit.
  const worth = albums.filter((a) => a.photoCount >= SHELF_MIN_PHOTOS);
  const picked = pickAtRandom(worth, SHELF_CANDIDATES);
  const shelf: ShelfAlbum[] = (
    await Promise.all(
      picked.map(async (a: AlbumData) => {
        const photos = await getAlbumPhotos(a).catch(() => []);
        return {
          slug: a.slug,
          title: a.title,
          date: a.date || a.year || "",
          total: Math.max(a.photoCount, photos.length),
          photos: photos.slice(0, SHELF_MAX_PHOTOS),
        };
      }),
    )
  ).filter((s) => s.photos.length >= SHELF_MIN_PHOTOS);

  // The Portraits pitch, resolved here so services.ts stays on the server.
  const entry = service ? entryPackage(service) : undefined;
  const pitch: PortraitsPitchData | null =
    service && entry
      ? {
          slug: service.slug,
          title: L(service.title),
          includes: [0, 2, 4, 5]
            .map((i) => service.includes[i])
            .filter(Boolean)
            .map((v) => L(v)),
          tiers: offeredPackages(service).map((pkg) => ({
            id: pkg.id,
            duration: packageDuration(pkg, locale),
            photos: formatPhotoCountShort(pkg.photos, locale),
            delivery: formatDelivery(pkg.delivery, locale),
            price: formatSom(pkg.priceUzs, locale),
            highlight: Boolean(pkg.highlight),
          })),
          from: formatSom(entry.priceUzs, locale),
          photos: pitchPaths.map((p) => photoIndex[p]).filter((p): p is NonNullable<typeof p> => Boolean(p)),
        }
      : null;

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
        extraPicks={extraPicks}
        photosCount={visible.length}
        galleries={galleries}
        sessions={sessions}
        servicesFrom={servicesFrom}
        shelf={shelf}
        pitch={pitch}
      />
    </>
  );
}
