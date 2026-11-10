"use client";

// The Home page (2026-11-10) — three columns, the LinkedIn-home idea in
// Marshall's own design:
//
//   left    who: the Viewfinder profile panel (ProfilePanel)
//   middle  the work: Best picks / All work, with one-line filter chips
//   right   what else: albums, the private-gallery door, session types
//
// From 1280px the side columns stay in place and scroll on their own; the
// middle column scrolls the page. Below 1280px everything stacks: the profile
// becomes a compact header and the three columns become three tabs
// (Work · Galleries · Sessions), so a phone never scrolls past two columns of
// albums to reach the photographs.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import PhotoGrid from "@/src/components/common/PhotoGrid";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import ChipRow from "@/src/components/common/ChipRow";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import ProfilePanel from "@/src/components/profile/ProfilePanel";
import { GalleriesCard, PrivateGalleryCard, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { bunnyUrl } from "@/src/lib/bunny-url";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { SessionSummary } from "@/src/lib/session-summaries";
import { HOME_PER_VIEW, workView, type WorkPreview } from "@/src/lib/work-preview";
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

type Tab = "picks" | "all";
type MobileTab = "work" | "galleries" | "sessions";

export default function HomeContent({
  albums,
  photoIndex,
  work,
  galleries,
  sessions,
  freeDays,
}: {
  albums: AlbumData[];
  /** storage path → photo, for the best picks. */
  photoIndex: Record<string, AlbumPhoto>;
  work: WorkPreview;
  galleries: GalleryListing[];
  sessions: SessionSummary[];
  freeDays: string[];
}) {
  const { t, locale } = useT();
  const [tab, setTab] = useState<Tab>("picks");
  const [filter, setFilter] = useState("All");
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

  const chips = useMemo(
    () => [
      { value: "All", label: t("portfolio.all") },
      ...work.categories.map((c) => ({ value: c.name, label: c.name })),
    ],
    [work.categories, t],
  );
  const shown = useMemo(() => workView(work, filter, HOME_PER_VIEW), [work, filter]);
  const shownTotal = filter === "All" ? work.total : work.categories.find((c) => c.name === filter)?.count ?? 0;
  const gridPhotos = useMemo(() => shown.map((p) => ({ ...p, alt: p.alt || p.category })), [shown]);

  const pickFilter = (value: string) => {
    setFilter(value);
    setTab("all");
  };

  const mobileTabs: { id: MobileTab; label: string }[] = [
    { id: "work", label: t("home.workTab") },
    { id: "galleries", label: t("home.galleriesTab") },
    { id: "sessions", label: t("home.sessionsTab") },
  ];
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
          <ProfilePanel freeDays={freeDays} albumsCount={albums.length} photosCount={work.total} />
        </aside>

        {/* Phone and tablet: the columns become tabs. */}
        <div
          role="tablist"
          aria-label={t("home.sections")}
          className="mx-4 flex rounded-xl bg-card p-1 xl:hidden"
        >
          {mobileTabs.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mobileTab === m.id}
              onClick={() => setMobileTab(m.id)}
              className={`h-9 flex-1 rounded-lg text-[13px] font-semibold transition ${
                mobileTab === m.id ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Middle — the work. */}
        <main className={`flex min-w-0 flex-col gap-3 ${onMobile("work")}`}>
          <div className="mx-4 flex flex-col gap-2 rounded-2xl bg-card p-2 xl:mx-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div role="tablist" aria-label={t("about.myWorks")} className="flex shrink-0 gap-1">
              <WorkTab on={tab === "picks"} onClick={() => setTab("picks")}>
                {t("about.bestPicks")}
              </WorkTab>
              <WorkTab on={tab === "all"} onClick={() => setTab("all")}>
                {t("home.allWork")} · {work.total}
              </WorkTab>
            </div>
            <ChipRow
              chips={chips}
              value={tab === "all" ? filter : ""}
              onChange={pickFilter}
              label={t("home.filterWork")}
              size="sm"
              className="min-w-0 sm:flex-1 sm:[&>*:first-child]:ml-auto"
            />
          </div>

          {tab === "picks" ? (
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
          ) : (
            <section className="flex flex-col gap-5">
              {shown.length === 0 ? (
                <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t("portfolio.emptyFilter")}</p>
              ) : (
                <div className="overflow-hidden xl:rounded-2xl">
                  <PhotoGrid
                    photos={gridPhotos}
                    onPhotoClick={(i) => setLightbox({ photos: gridPhotos, index: i })}
                    gap={2}
                  />
                </div>
              )}
              {shownTotal > shown.length && (
                <Link
                  href={`/${locale}/portfolio`}
                  className="mx-auto inline-flex h-10 items-center rounded-full bg-foreground/10 px-8 text-[11px] font-bold uppercase tracking-[0.16em] text-foreground transition hover:bg-foreground/16"
                >
                  {t("home.seeAll", { n: shownTotal })}
                </Link>
              )}
            </section>
          )}
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

function WorkTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition ${
        on ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
