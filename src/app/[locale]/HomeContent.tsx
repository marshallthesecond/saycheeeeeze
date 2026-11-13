"use client";

// The Home page (2026-11-10) — three columns, the LinkedIn-home idea in
// Marshall's own design:
//
//   left    who: the Viewfinder profile panel (ProfilePanel)
//   middle  the work: Best picks (the "All work" tab and its category chips
//           were removed on 2026-11-13 — /portfolio is where all of it lives)
//   right   what else: albums, the private-gallery door, session types
//
// From 1280px the side columns stay in place and scroll on their own; the
// middle column scrolls the page. Below 1280px everything stacks: the profile
// becomes a compact header and the three columns become three tabs
// (Work · Galleries · Sessions), so a phone never scrolls past two columns of
// albums to reach the photographs.
//
// Those phone tabs are a sticky bar under the header (2026-11-13): big,
// with icons, the chosen one filled in the brand red, so they read as the way
// around the page rather than as a caption. Choosing a tab while the bar is
// stuck brings the top of the new tab into view.

import { useCallback, useMemo, useRef, useState } from "react";
import { Album, Aperture, Images, type LucideIcon } from "lucide-react";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import ProfilePanel from "@/src/components/profile/ProfilePanel";
import { GalleriesCard, PrivateGalleryCard, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { bunnyUrl } from "@/src/lib/bunny-url";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { SessionSummary } from "@/src/lib/session-summaries";
import BestPicks, { type PickItem } from "./about/BestPicks";
import { FALLBACK_RATIO, formatPickDate } from "./about/best-picks";
import { BEST_PICKS, type WorksCategory } from "./about/photos";

/**
 * The middle column is the viewport minus two 300px columns, three 16px gaps
 * and the page padding — so the feature tile is half of that, not half the
 * screen. Below 1280px it is the full width again.
 */
const MIDDLE = "calc(100vw - 664px)";
const FEATURE_SIZES = `(min-width: 1280px) calc(${MIDDLE} / 2), (min-width: 640px) 50vw, 100vw`;
const TILE_SIZES = `(min-width: 1280px) calc(${MIDDLE} / 4), (min-width: 640px) 25vw, 50vw`;

type MobileTab = "work" | "galleries" | "sessions";

export default function HomeContent({
  albums,
  photoIndex,
  photosCount,
  galleries,
  sessions,
}: {
  albums: AlbumData[];
  /** storage path → photo, for the best picks. */
  photoIndex: Record<string, AlbumPhoto>;
  /** How many photographs the portfolio holds, for the profile's details. */
  photosCount: number;
  galleries: GalleryListing[];
  sessions: SessionSummary[];
}) {
  const { t, locale } = useT();
  const [mobileTab, setMobileTab] = useState<MobileTab>("work");
  const [picker, setPicker] = useState(false);

  const [lightbox, setLightbox] = useState<{ photos: AlbumPhoto[]; index: number } | null>(null);
  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (by: number) =>
      setLightbox((lb) => (lb ? { ...lb, index: (lb.index + by + lb.photos.length) % lb.photos.length } : lb)),
    [],
  );

  // Best picks, resolved exactly as the old About page did.
  const pickLabel = useCallback(
    (cat: WorksCategory) => {
      const key = `about.worksCat.${cat}`;
      const value = t(key);
      return value === key ? cat : value;
    },
    [t],
  );
  const pickItems = useMemo<PickItem[]>(
    () =>
      BEST_PICKS.map((p, index) => {
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
      }),
    [photoIndex, pickLabel, locale, t],
  );
  const pickPhotos = useMemo(() => pickItems.map((it) => ({ ...it.photo, alt: it.alt })), [pickItems]);


  const mobileTabs: { id: MobileTab; label: string; Icon: LucideIcon }[] = [
    { id: "work", label: t("home.workTab"), Icon: Images },
    { id: "galleries", label: t("home.galleriesTab"), Icon: Album },
    { id: "sessions", label: t("home.sessionsTab"), Icon: Aperture },
  ];

  // The tabs and what they switch between share one box on a phone, so the
  // sticky bar stays stuck for the whole length of the tab's content.
  const tabbed = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLDivElement>(null);
  const chooseTab = (id: MobileTab) => {
    setMobileTab(id);
    const box = tabbed.current;
    const bar = tabBar.current;
    if (!box || !bar) return;
    // The bar is stuck, so the reader is somewhere down the old tab: start
    // the new one at its top rather than part-way down it.
    if (box.getBoundingClientRect().top < parseFloat(getComputedStyle(bar).top)) {
      requestAnimationFrame(() => box.scrollIntoView({ block: "start" }));
    }
  };
  /** Hidden on a phone unless its tab is chosen; always shown from 1280px. */
  const onMobile = (id: MobileTab) => (mobileTab === id ? "" : "max-xl:hidden");

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" />

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-4 px-0 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:px-4"
        style={{ paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        {/* Left — who. */}
        <aside
          aria-label={t("profile.name")}
          className="px-4 xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-y-auto xl:px-0 [scrollbar-width:thin]"
        >
          <ProfilePanel albumsCount={albums.length} photosCount={photosCount} />
        </aside>

        {/* Phone and tablet: the middle and right columns become tabs, in one
            box with the tab bar. From 1280px the box steps aside (contents) and
            both are columns of the grid again. */}
        <div
          ref={tabbed}
          className="flex min-w-0 flex-col gap-3 scroll-mt-[calc(2.5rem+env(safe-area-inset-top))] xl:contents"
        >
          {/* Stuck right under the header, which is 2.5rem tall. */}
          <div
            ref={tabBar}
            className="sticky top-[calc(2.5rem+env(safe-area-inset-top))] z-30 bg-background/90 px-4 py-2 backdrop-blur-md xl:hidden"
          >
            <div
              role="tablist"
              aria-label={t("home.sections")}
              className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm"
            >
              {mobileTabs.map(({ id, label, Icon }) => {
                const on = mobileTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => chooseTab(id)}
                    className={`flex h-14 min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1 text-xs font-semibold transition active:scale-[0.98] sm:h-11 sm:flex-row sm:gap-2 sm:text-sm ${
                      on
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "text-foreground hover:bg-foreground/6"
                    }`}
                  >
                    <Icon aria-hidden className="size-5 shrink-0 sm:size-4" strokeWidth={on ? 2.25 : 1.75} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

        {/* Middle — the work. */}
        <main className={`flex min-w-0 flex-col gap-3 ${onMobile("work")}`}>
          <h2 className="mx-4 flex h-12 items-center rounded-2xl bg-card px-4 text-[15px] font-bold tracking-tight xl:mx-0">
            {t("about.bestPicks")}
          </h2>

          <BestPicks
            heading=""
            items={pickItems}
            loadMoreLabel={t("about.loadMore")}
            fullPortfolioLabel={t("about.fullPortfolio")}
            portfolioHref={`/${locale}/portfolio`}
            onOpen={(i) => setLightbox({ photos: pickPhotos, index: i })}
            featureSizes={FEATURE_SIZES}
            tileSizes={TILE_SIZES}
            className="relative overflow-hidden xl:rounded-2xl"
          />
        </main>

        {/* Right — what else. */}
        <aside
          aria-label={t("home.galleriesTab")}
          className={`flex flex-col gap-4 px-4 xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-y-auto xl:px-0 [scrollbar-width:thin] ${
            mobileTab === "work" ? "max-xl:hidden" : ""
          }`}
        >
          <div className={`flex flex-col gap-4 ${onMobile("galleries")}`}>
            <GalleriesCard albums={albums} />
            <PrivateGalleryCard onOpen={() => setPicker(true)} />
          </div>
          <div className={onMobile("sessions")}>
            <SessionsList sessions={sessions} />
          </div>
        </aside>
        </div>
      </div>

      <GalleryPickerSheet
        open={picker}
        onClose={() => setPicker(false)}
        mode="private"
        galleries={galleries}
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
