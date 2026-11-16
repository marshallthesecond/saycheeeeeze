"use client";

// The Home page (rebuilt 2026-11-17). Three columns from 1280px, as before:
//
//   left    eight quick-access tiles, one small piece of glass
//   middle  Best picks, then one album to look through (a different one each
//           visit), then the Portraits session, pitched
//   right   albums, the private-gallery door, the session types
//
// Below 1280px one column in that order: the tiles first, right under the
// header, then the work, then the cards. The profile panel that used to be
// the left column is the About page's main section; the page's h1 is kept
// for search engines and screen readers but not shown.

import { useCallback, useMemo, useState } from "react";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import { Album, Aperture, Camera, Briefcase, LayoutDashboard, Lock, Send, User } from "lucide-react";
import QuickTiles, { type QuickTile } from "@/src/components/home/QuickTiles";
import AlbumShelf, { type ShelfAlbum } from "@/src/components/home/AlbumShelf";
import PortraitsPitch, { type PortraitsPitchData } from "@/src/components/home/PortraitsPitch";
import ServicesSheet from "@/src/components/home/ServicesSheet";
import { GalleriesCard, PrivateGalleryCard, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { bunnyUrl } from "@/src/lib/bunny-url";
import { PROFILE } from "@/src/lib/profile";
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
  /** storage path → photo, for the best picks and the tiles. */
  photoIndex: Record<string, AlbumPhoto>;
  extraPicks: ExtraPick[];
  galleries: GalleryListing[];
  sessions: SessionSummary[];
  shelf: ShelfAlbum[];
  pitch: PortraitsPitchData | null;
}) {
  const { t, locale } = useT();
  const [sheet, setSheet] = useState<"services" | "albums" | "private" | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const [note, setNote] = useState(false);

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

  const tiles: QuickTile[] = [
    { key: "book", name: t("home.tiles.book"), Icon: Camera, accent: true, href: `/${locale}/book` },
    { key: "portfolio", name: t("home.tiles.portfolio"), Icon: Briefcase, href: `/${locale}/portfolio` },
    { key: "services", name: t("home.tiles.services"), Icon: Aperture, onClick: () => setSheet("services") },
    { key: "galleries", name: t("home.tiles.galleries"), Icon: Album, onClick: () => setSheet("albums") },
    { key: "private", name: t("home.tiles.private"), Icon: Lock, onClick: () => setSheet("private") },
    { key: "about", name: t("home.tiles.about"), Icon: User, href: `/${locale}/about` },
    { key: "message", name: t("home.tiles.message"), Icon: Send, href: PROFILE.telegram, external: true },
    { key: "studio", name: t("home.tiles.studio"), Icon: LayoutDashboard, onClick: () => setNote(true) },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" />

      <h1 className="sr-only">{`${t("profile.name")}, ${t("about.heroTitle")}`}</h1>

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-8 px-4 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-4"
        style={{ paddingTop: "calc(3rem + env(safe-area-inset-top))" }}
      >
        {/* Left — the ways in. */}
        <aside className={STICKY}>
          <QuickTiles tiles={tiles} label={t("home.tilesLabel")} />
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
        <aside aria-label={t("about.galleries")} className={`flex flex-col gap-4 ${STICKY}`}>
          <GalleriesCard albums={albums} />
          <PrivateGalleryCard onOpen={() => setSheet("private")} />
          <SessionsList sessions={sessions} />
        </aside>
      </div>

      {note && <StudioNote onClose={() => setNote(false)} />}

      <ServicesSheet open={sheet === "services"} onClose={closeSheet} sessions={sessions} />
      <GalleryPickerSheet
        open={sheet === "albums" || sheet === "private"}
        onClose={closeSheet}
        mode={sheet === "private" ? "private" : "albums"}
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

/**
 * The Studio is where photographers will manage their own pages; it is not
 * open to them yet. A short note above the bottom bar, gone after a few
 * seconds or on a tap.
 */
function StudioNote({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <div
      role="status"
      className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg"
      style={{ bottom: "calc(6rem + env(safe-area-inset-bottom))" }}
      ref={(el) => {
        if (!el) return;
        const id = window.setTimeout(onClose, 5000);
        return () => window.clearTimeout(id);
      }}
    >
      <p className="flex-1 text-[13px] leading-snug">{t("home.studioNote")}</p>
      <button type="button" onClick={onClose} className="shrink-0 text-[13px] font-semibold underline underline-offset-2">
        {t("common.close")}
      </button>
    </div>
  );
}
