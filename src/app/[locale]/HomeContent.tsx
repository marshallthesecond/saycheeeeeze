"use client";

// The Home page (rebuilt 2026-11-17), one column, phone first:
//
//   1  who this is, in one line (the page's h1), and the way to About
//   2  eight quick-access tiles: two across on a phone, four from 640px
//   3  Best picks: the feature, then small photographs, Full portfolio
//   4  one album, scrolling sideways, a different one each visit
//   5  the Portraits session, pitched: what you get, the prices, Book
//
// The profile panel (portrait, bio, details, Book) that was the left column
// until now is the About page's main section. The galleries card, the
// private-gallery card and the session list that were the right column are
// the tiles now: Galleries and Private galleries open the same sheets, and
// Services opens the session list.

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import QuickTiles, { TILE_ICONS, type QuickTile } from "@/src/components/home/QuickTiles";
import AlbumShelf, { type ShelfAlbum } from "@/src/components/home/AlbumShelf";
import PortraitsPitch, { type PortraitsPitchData } from "@/src/components/home/PortraitsPitch";
import ServicesSheet from "@/src/components/home/ServicesSheet";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { bunnyUrl } from "@/src/lib/bunny-url";
import { pfps } from "@/src/lib/pfps";
import { PROFILE } from "@/src/lib/profile";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { SessionSummary } from "@/src/lib/session-summaries";
import BestPicks, { type PickItem } from "./about/BestPicks";
import { FALLBACK_RATIO, PICKS_WANTED, formatPickDate } from "./about/best-picks";
import { BEST_PICKS, QUICK_PHOTOS, type WorksCategory } from "./about/photos";

/** The column stops at 1280px; the grids' `sizes` follow that cap. */
const FEATURE_SIZES = "(min-width: 1280px) 624px, (min-width: 640px) 50vw, 100vw";
const PHONE_TILE_SIZES = "34vw";
const DESKTOP_TILE_SIZES = "(min-width: 1280px) 208px, 17vw";

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
  photosCount,
  galleries,
  sessions,
  servicesFrom,
  shelf,
  pitch,
}: {
  albums: AlbumData[];
  /** storage path → photo, for the best picks and the tiles. */
  photoIndex: Record<string, AlbumPhoto>;
  extraPicks: ExtraPick[];
  /** How many photographs the portfolio shows. */
  photosCount: number;
  galleries: GalleryListing[];
  sessions: SessionSummary[];
  /** The cheapest session's price, formatted; null when none is on offer. */
  servicesFrom: string | null;
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

  const newest = albums[0];
  const tiles: QuickTile[] = [
    {
      key: "book",
      name: t("home.tiles.book"),
      detail: t("home.tiles.bookDetail"),
      art: { kind: "photo", photo: photoIndex[QUICK_PHOTOS.book] ?? { src: bunnyUrl(QUICK_PHOTOS.book) } },
      href: `/${locale}/book`,
    },
    {
      key: "portfolio",
      name: t("home.tiles.portfolio"),
      detail: t("home.tiles.portfolioDetail", { n: photosCount }),
      art: { kind: "photo", photo: photoIndex[QUICK_PHOTOS.portfolio] ?? { src: bunnyUrl(QUICK_PHOTOS.portfolio) } },
      href: `/${locale}/portfolio`,
    },
    {
      key: "services",
      name: t("home.tiles.services"),
      detail: servicesFrom ? t("home.fromPrice", { price: servicesFrom }) : t("home.tiles.servicesDetail"),
      art: { kind: "photo", photo: photoIndex[QUICK_PHOTOS.services] ?? { src: bunnyUrl(QUICK_PHOTOS.services) } },
      onClick: () => setSheet("services"),
    },
    {
      key: "galleries",
      name: t("home.tiles.galleries"),
      detail: t("home.tiles.galleriesDetail", { n: albums.length }),
      art: {
        kind: "photo",
        photo: newest ? { src: newest.cover, ladder: newest.coverLadder, thumbhash: newest.coverThumbhash } : undefined,
      },
      onClick: () => setSheet("albums"),
    },
    {
      key: "private",
      name: t("home.tiles.private"),
      detail: t("home.tiles.privateDetail"),
      art: { kind: "icon", Icon: TILE_ICONS.Lock, tone: "brand" },
      onClick: () => setSheet("private"),
    },
    {
      key: "about",
      name: t("home.tiles.about"),
      detail: t("home.tiles.aboutDetail", { year: PROFILE.sinceYear }),
      art: { kind: "local", src: pfps[0] },
      href: `/${locale}/about`,
    },
    {
      key: "message",
      name: t("home.tiles.message"),
      detail: t("home.tiles.messageDetail"),
      art: { kind: "icon", Icon: TILE_ICONS.Send, tone: "quiet" },
      href: PROFILE.telegram,
      external: true,
    },
    {
      key: "studio",
      name: t("home.tiles.studio"),
      detail: t("home.tiles.studioDetail"),
      art: { kind: "icon", Icon: TILE_ICONS.Studio, tone: "quiet" },
      onClick: () => setNote(true),
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" />

      <main
        className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 pb-32 sm:gap-10 sm:px-6"
        style={{ paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        <div className="flex flex-col gap-3">
          {/* Who this is: one line, and the way to the About page. */}
          <Link href={`/${locale}/about`} className="group flex w-fit max-w-full items-center gap-2.5">
            {/* Through next/image: the first portrait is a 5 MB PNG. */}
            <Image
              src={pfps[0]}
              alt=""
              width={36}
              height={36}
              sizes="36px"
              priority
              className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-foreground underline-offset-2 group-hover:underline">
                {t("profile.name")}
              </p>
              <h1 className="truncate text-xs text-muted-foreground">{t("about.heroTitle")}</h1>
            </div>
          </Link>

          <QuickTiles tiles={tiles} label={t("home.tilesLabel")} />
        </div>

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
