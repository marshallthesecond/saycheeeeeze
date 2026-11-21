// Server shell so this route can export metadata — the interactive content
// lives in AboutContent.tsx, which is a client component.
//
// Its own page since 2026-11-10. Until then the site root rendered this same
// component and /about canonicalised to the root to avoid duplicate content;
// now the root is the Home page, so /about keeps its own canonical and is back
// in the sitemap.
//
// 2026-11-22: Home's middle column (Best picks, one album to look through,
// the Portraits pitch) and its Galleries stack moved here, and the Portfolio
// page's gallery doors went into the Portfolio section. /portfolio redirects
// here.

import type { Metadata, Viewport } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { pageMetadata } from "@/src/lib/seo";
import { getAlbumPhotos, getAllAlbums, getPhotosByPaths, getPlacements, getPortfolioPhotos, type AlbumData } from "@/src/lib/albums";
import { bunnyUrl } from "@/src/lib/bunny-url";
import { BEST_PICKS_PLACE, servicePlace } from "@/src/lib/placements";
import { getGalleryIndex } from "@/src/lib/client-galleries";
import { sessionSummaries } from "@/src/lib/session-summaries";
import { formatSom } from "@/src/lib/packages";
import { entryPackage, getServiceBySlug, offeredPackages, pickLocale } from "@/src/lib/services";
import { getLiveServices } from "@/src/lib/live-services";
import { formatDelivery, formatPhotoCountShort, packageDuration } from "@/src/lib/service-format";
import { ABOUT_PER_VIEW, daySeed, shuffleWithSeed, workPreview } from "@/src/lib/work-preview";
import type { ShelfAlbum } from "@/src/components/home/AlbumShelf";
import type { PortraitsPitchData } from "@/src/components/home/PortraitsPitch";
import AboutContent from "./AboutContent";
import { PICKS_WANTED, type ChosenPick, type ExtraPick } from "./best-picks";
import { ABOUT_PHOTO_PATHS, BEST_PICKS, SESSION_PHOTOS } from "./photos";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMetadata("about", locale as Locale, "/about");
}

/** The phone's browser bar is black on this page too, like the page. */
export const viewport: Viewport = { themeColor: "#000000" };

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

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? (raw as Locale) : "ru";
  const L = (v: Parameters<typeof pickLocale>[0]) => pickLocale(v, locale);

  // galleryPaths is the code's (the rail before the placements migration).
  const pitchPaths = (getServiceBySlug(PITCH_SERVICE)?.galleryPaths ?? []).slice(0, PITCH_PHOTOS);

  // Resolved server-side so the client gets real dimensions, ThumbHashes and
  // derivative URLs in the first render payload.
  const [albums, portfolio, photoIndex, liveServices, galleries, placements] = await Promise.all([
    getAllAlbums(),
    getPortfolioPhotos(),
    getPhotosByPaths([...ABOUT_PHOTO_PATHS, ...pitchPaths]),
    getLiveServices(),
    getGalleryIndex(),
    getPlacements(),
  ]);

  // The Studio's titles and prices; a service turned off is not listed, and
  // the pitch goes when Portraits is off.
  const sessions = sessionSummaries(
    locale,
    (slug) => {
      const path = SESSION_PHOTOS[slug];
      return path ? photoIndex[path] : undefined;
    },
    liveServices,
  );
  const live = liveServices.find((s) => s.slug === PITCH_SERVICE);
  const service = live && !live.off ? live : undefined;

  // Best picks are chosen by hand: in the Studio ("Add to..." on a photo), or
  // before the placements migration, in BEST_PICKS. A photo that is also in
  // BEST_PICKS keeps the caption written there; one added in the Studio is
  // captioned from its album. While there are fewer than the grid holds, the
  // rest come from the portfolio, the same ones all day.
  const written = new Map(BEST_PICKS.map((p) => [p.path, p]));
  const chosenPicks: ChosenPick[] = placements
    ? (placements[BEST_PICKS_PLACE] ?? []).map((placed) => {
        const caption = written.get(placed.path);
        return caption
          ? { photo: placed.photo, cat: caption.cat, title: caption.title, date: caption.date }
          : {
              photo: placed.photo,
              category: placed.category,
              title: placed.albumTitle || undefined,
              date: placed.albumDate || undefined,
            };
      })
    : BEST_PICKS.map((p) => ({
        photo: photoIndex[p.path] ?? { src: bunnyUrl(p.path) },
        cat: p.cat,
        title: p.title,
        date: p.date,
      }));
  const visible = portfolio.filter((p) => !p.hidden);
  const chosen = new Set(chosenPicks.map((p) => p.photo.src));
  const extraPicks: ExtraPick[] = shuffleWithSeed(
    visible.filter((p) => !chosen.has(p.src)),
    daySeed(),
  )
    .slice(0, Math.max(0, PICKS_WANTED - chosenPicks.length))
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
            ...(pkg.name ? { name: L(pkg.name) } : {}),
            duration: packageDuration(pkg, locale),
            photos: formatPhotoCountShort(pkg.photos, locale),
            delivery: formatDelivery(pkg.delivery, locale),
            price: formatSom(pkg.priceUzs, locale),
            highlight: Boolean(pkg.highlight),
          })),
          from: formatSom(entry.priceUzs, locale),
          // The first photos of the Portraits page's rail: chosen in the
          // Studio, or before the migration, its galleryPaths.
          photos: placements
            ? (placements[servicePlace(PITCH_SERVICE)] ?? []).slice(0, PITCH_PHOTOS).map((p) => p.photo)
            : pitchPaths.map((p) => photoIndex[p]).filter((p): p is NonNullable<typeof p> => Boolean(p)),
        }
      : null;

  return (
    <AboutContent
      work={workPreview(portfolio, ABOUT_PER_VIEW)}
      albums={albums}
      galleries={galleries}
      photosCount={visible.length}
      sessions={sessions}
      chosenPicks={chosenPicks}
      extraPicks={extraPicks}
      shelf={shelf}
      pitch={pitch}
    />
  );
}
