"use client";

// The Home page (rebuilt 2026-11-17). Three columns from 1280px:
//
//   left    the albums as a stack to flick through (GalleryStack)
//   middle  Best picks, then one album to look through (a different one each
//           visit), then the Portraits session, pitched
//   right   the private-gallery door and the session types
//
// Below 1280px one column in that order: the stack first, right under the
// header, then the work, then the cards. The profile panel that used to be
// the left column is the About page's main section; the page's h1 is kept
// for search engines and screen readers but not shown. (For a few hours on
// 2026-11-17 the left column held eight quick-access tiles; the stack took
// their place.)

import { useCallback, useMemo, useState } from "react";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import GalleryStack from "@/src/components/home/GalleryStack";
import PlatformCard from "@/src/components/home/PlatformCard";
import AlbumShelf, { type ShelfAlbum } from "@/src/components/home/AlbumShelf";
import PortraitsPitch, { type PortraitsPitchData } from "@/src/components/home/PortraitsPitch";
import { PrivateGalleryCard, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { bunnyUrl } from "@/src/lib/bunny-url";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { SessionSummary } from "@/src/lib/session-summaries";
import BestPicks, { type PickItem } from "./about/BestPicks";
import { FALLBACK_RATIO, PICKS_WANTED, formatPickDate } from "./about/best-picks";
import { BEST_PICKS, type WorksCategory } from "./about/photos";

/**
 * The middle column is the viewport minus two 300px columns, three 16px gaps
 * and the page padding — so the feature tile is half of that, not half the
 * screen. Below 1280px it is the full width again.
 */
const MIDDLE = "calc(100vw - 664px)";
const FEATURE_SIZES = `(min-width: 1280px) calc(${MIDDLE} / 2), (min-width: 640px) 50vw, 100vw`;
const PHONE_TILE_SIZES = "34vw";
const DESKTOP_TILE_SIZES = `(min-width: 1280px) calc(${MIDDLE} / 6), 17vw`;
const STICKY =
  "xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-y-auto [scrollbar-width:thin]";

/** A portfolio photograph that fills a Best picks slot nobody chose yet. */
export interface ExtraPick {
  photo: AlbumPhoto;
  /** The portfolio's category label ("Portraits"). */
  category: string;
}

export default function HomeContent({
  albums,
  photoIndex,
  extraPicks,
  galleries,
  sessions,
  shelf,
  pitch,
}: {
  albums: AlbumData[];
  /** storage path → photo, for the best picks. */
  photoIndex: Record<string, AlbumPhoto>;
  extraPicks: ExtraPick[];
  galleries: GalleryListing[];
  sessions: SessionSummary[];
  shelf: ShelfAlbum[];
  pitch: PortraitsPitchData | null;
}) {
  const { t, locale } = useT();
  const [privateOpen, setPrivateOpen] = useState(false);
  const closeSheet = useCallback(() => setPrivateOpen(false), []);

  const [lightbox, setLightbox] = useState<{ photos: AlbumPhoto[]; index: number } | null>(null);
  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (by: number) =>
      setLightbox((lb) => (lb ? { ...lb, index: (lb.index + by + lb.photos.length) % lb.photos.length } : lb)),
    [],
  );

  // Best picks: the hand-picked ones, then the portfolio's to fill the grid.
  const pickLabel = useCallback(
    (cat: WorksCategory) => {
      const key = `about.worksCat.${cat}`;
      const value = t(key);
      return value === key ? cat : value;
    },
    [t],
  );
  const pickItems = useMemo<PickItem[]>(() => {
    const chosen: PickItem[] = BEST_PICKS.map((p, index) => {
      const photo = photoIndex[p.path] ?? { src: bunnyUrl(p.path) };
      const category = pickLabel(p.cat);
      return {
        index,
        photo,
        ratio: photo.width && photo.height ? photo.width / photo.height : FALLBACK_RATIO,
        category,
        date: formatPickDate(p.date, locale),
        title: p.title,
        alt: t("about.bestPickAlt", { subject: p.title || category }),
      };
    });
    const extra: PickItem[] = extraPicks.map(({ photo, category }, i) => ({
      index: chosen.length + i,
      photo,
      ratio: photo.width && photo.height ? photo.width / photo.height : FALLBACK_RATIO,
      category,
      date: "",
      alt: t("about.bestPickAlt", { subject: category }),
    }));
    return [...chosen, ...extra].slice(0, PICKS_WANTED);
  }, [photoIndex, extraPicks, pickLabel, locale, t]);
  const pickPhotos = useMemo(() => pickItems.map((it) => ({ ...it.photo, alt: it.alt })), [pickItems]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" />

      <h1 className="sr-only">{`${t("profile.name")}, ${t("about.heroTitle")}`}</h1>

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-7 px-4 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-4"
        style={{ paddingTop: "calc(3rem + env(safe-area-inset-top))" }}
      >
        {/* Left — the albums. Edge to edge on a phone, so the shelves run off the screen. */}
        <aside className={`-mx-4 xl:mx-0 ${STICKY}`}>
          <GalleryStack albums={albums} onPrivate={() => setPrivateOpen(true)} />
          <PlatformCard className="mx-4 mt-6 hidden xl:mx-0 xl:flex" />
        </aside>

        {/* Middle — the work. */}
        <main className="flex min-w-0 flex-col gap-8 sm:gap-10">
          <section aria-labelledby="picks-h" className="flex flex-col gap-3">
            <h2 id="picks-h" className="text-xl font-bold tracking-tight sm:text-2xl">
              {t("about.bestPicks")}
            </h2>
            <BestPicks
              items={pickItems}
              fullPortfolioLabel={t("about.fullPortfolio")}
              portfolioHref={`/${locale}/portfolio`}
              onOpen={(i) => setLightbox({ photos: pickPhotos, index: i })}
              featureSizes={FEATURE_SIZES}
              phoneTileSizes={PHONE_TILE_SIZES}
              desktopTileSizes={DESKTOP_TILE_SIZES}
              className="-mx-4 sm:mx-0"
            />
          </section>

          {shelf.length > 0 && (
            <AlbumShelf albums={shelf} onOpen={(photos, index) => setLightbox({ photos, index })} />
          )}

          {pitch && <PortraitsPitch pitch={pitch} />}
        </main>

        {/* Right — what else. */}
        <aside aria-label={t("home.sessions")} className={`flex flex-col gap-4 ${STICKY}`}>
          <PrivateGalleryCard onOpen={() => setPrivateOpen(true)} />
          <SessionsList sessions={sessions} />
          {/* On a phone the platform card closes the page. */}
          <PlatformCard className="xl:hidden" />
        </aside>
      </div>

      <GalleryPickerSheet
        open={privateOpen}
        onClose={closeSheet}
        mode="private"
        galleries={galleries}
        albums={albums}
        locale={locale}
      />

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={close}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}
