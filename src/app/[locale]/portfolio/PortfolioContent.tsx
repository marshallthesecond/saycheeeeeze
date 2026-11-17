"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import PhotoGrid, { type Photo } from "@/src/components/common/PhotoGrid";
import Lightbox from "@/src/components/common/Lightbox";
import type { AlbumData } from "@/src/lib/albums";
import Shelf from "@/src/components/common/Shelf";
import StickyHeader from "@/src/components/common/StickyHeader";
import type { PortfolioPhoto } from "@/src/lib/albums";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";

/** Album shelf cards: 40vw on a phone, a fixed 192px column above that. */
const ALBUM_COVER_SIZES = "(max-width: 640px) 40vw, 192px";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import GalleryDoors, { type Door } from "@/src/components/common/GalleryDoors";
import ChipRow from "@/src/components/common/ChipRow";
import JournalSpread from "@/src/components/portfolio/JournalSpread";
import type { JournalData } from "./journal";
// One shuffle for the portfolio and the Home/About previews, so a photograph
// sits in the same place in the day's order on every page.
import { daySeed, shuffleWithSeed } from "@/src/lib/work-preview";
import type { GalleryListing } from "@/src/lib/client-galleries";

// How many photos sit above the Albums shelf. Heights are natural so this
// can't be an exact half-screen; 6 lands close to 50vh on a phone and on a
// laptop alike. Raise it to push the albums further down.
const PHOTOS_BEFORE_ALBUMS = 6;

export default function PortfolioContent({ 
  photos: allPhotos,
  albums, 
  galleries,
  journal = null,
}: { 
  photos: PortfolioPhoto[];
  albums: AlbumData[];
  galleries: GalleryListing[];
  /** The journal spread, or null to leave it out. See ./journal.ts. */
  journal?: JournalData | null;
}) {
  const { t, locale } = useT();
  // Shuffled so the portfolio doesn't always lead with the same photos. The
  // seed is the calendar day rather than Math.random() because server and
  // browser must reach the same order — otherwise React discards the
  // server-rendered HTML on hydration. The order rotates at midnight.
  const shuffled = useMemo(() => shuffleWithSeed(allPhotos, daySeed()), [allPhotos]);
  const [filter, setFilter]     = useState<string>("All");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [picker, setPicker] = useState<Door | null>(null);

  // Pills derived from the top-level folders that exist in Bunny Storage, so
  // there's no hardcoded category list to keep in sync.
  const filters = useMemo(
    () => ["All", ...Array.from(new Set(allPhotos.filter((p) => !p.hidden).map((p) => p.category))).sort()],
    [allPhotos]
  );

  const catStats = useMemo(
    () => filters.slice(1).map((cat) => ({
      label: cat,
      count: allPhotos.filter((p) => p.category === cat).length,
    })),
    [filters, allPhotos]
  );

  // One row: each category with its count (2026-11-14). The count tiles and
  // the plain filter pills used to repeat each other, one above the other.
  const chips = useMemo(
    () => [
      { value: "All", label: t("portfolio.all"), count: allPhotos.length },
      ...catStats.map(({ label, count }) => ({ value: label, label, count })),
    ],
    [catStats, allPhotos.length, t]
  );

  const visibleData = filter === "All" ? shuffled : shuffled.filter((p) => p.category === filter);
  // Spread, not { src, alt }: narrowing here would drop ladder, thumbhash and
  // dimensions and put the portfolio back onto the Optimizer.
  const photos: Photo[] = visibleData.map((p) => ({ ...p, alt: p.alt }));

  // Two halves, so the Albums shelf can sit inside the grid rather than after
  // it. Lightbox indices stay global — the lower grid adds the upper grid's
  // length back on, so `photos[index]` is always the photo that was clicked.
  const photosAboveAlbums = photos.slice(0, PHOTOS_BEFORE_ALBUMS);
  // The journal spread breaks the grid a second time, further down — on the
  // unfiltered view only, where it reads as part of the whole portfolio
  // rather than as a stray page inside one category.
  const showJournal =
    journal !== null && filter === "All" && photos.length > PHOTOS_BEFORE_ALBUMS + journal.after;
  const journalAt = showJournal && journal ? PHOTOS_BEFORE_ALBUMS + journal.after : photos.length;
  const photosBelowAlbums = photos.slice(PHOTOS_BEFORE_ALBUMS, journalAt);
  const photosBelowJournal = photos.slice(journalAt);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const prevPhoto = useCallback(() => setLightbox((i) => i !== null ? (i - 1 + visibleData.length) % visibleData.length : null), [visibleData.length]);
  const nextPhoto = useCallback(() => setLightbox((i) => i !== null ? (i + 1) % visibleData.length : null), [visibleData.length]);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")     closeLightbox();
      if (e.key === "ArrowLeft")  prevPhoto();
      if (e.key === "ArrowRight") nextPhoto();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, closeLightbox, prevPhoto, nextPhoto]);

  useEffect(() => {
    document.body.style.overflow = lightbox !== null ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [lightbox]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">

      {/* Hero wash — saturated at the top, melting into the page background */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-95 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in oklab, var(--secondary) 30%, transparent) 0%, color-mix(in oklab, var(--secondary) 9%, transparent) 45%, transparent 100%)",
        }}
      />

      {/* backHref has to carry the locale — a bare "/" sends the visitor
          through the middleware redirect and can land them in another language. */}
      <StickyHeader
        title={t("portfolio.title")}
        fadeOver={200}
        backHref={`/${locale}`}
      />

      {/* Hero: the words on the left; from 1280px the three gallery doors fill
          the space on their right, just above the photographs. Below that
          they follow the words. */}
      <section
        className="relative z-10 flex flex-col gap-5 px-4 pb-5 sm:px-8 xl:flex-row xl:items-end xl:justify-between xl:gap-10"
        style={{ paddingTop: "calc(5rem + env(safe-area-inset-top))" }}
      >
        <div className="xl:max-w-md xl:shrink-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            {t("portfolio.eyebrow")}
          </p>
          {/* Spotify goes very large and very tight on hero titles */}
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tighter leading-[0.95]">
            {t("portfolio.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-sm leading-relaxed">
            {t("portfolio.subtitle")}
          </p>
        </div>

        <GalleryDoors
          albums={albums}
          galleries={galleries}
          onOpen={setPicker}
          className="xl:w-full xl:max-w-3xl"
        />
      </section>

      {/* Categories, each with its count, on one line that scrolls sideways. */}
      <section className="relative z-10 px-4 sm:px-8 pb-4">
        <ChipRow chips={chips} value={filter} onChange={setFilter} label={t("home.filterWork")} size="lg" />
      </section>

      {/* Photo grid, upper half — full bleed, Pixieset style */}
      <section className="relative z-10 pb-8">
        {allPhotos.length === 0 ? (
          <div className="px-6 py-20 text-center flex flex-col items-center gap-3">
            <p className="text-base font-bold text-foreground/70">{t("portfolio.emptyTitle")}</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {t("portfolio.emptyBody")}
            </p>
          </div>
        ) : visibleData.length === 0 ? (
          <div className="px-6 py-16 text-center flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">{t("portfolio.emptyFilter")}</p>
            <button
              onClick={() => setFilter("All")}
              className="btn-glass px-5 min-h-11 text-xs font-bold"
            >
              {t("portfolio.showAllPhotos")}
            </button>
          </div>
        ) : (
          <PhotoGrid photos={photosAboveAlbums} onPhotoClick={(i) => setLightbox(i)} gap={2} />
        )}
      </section>

      {/* Albums — a break in the grid rather than a footer to it */}
      <Shelf title={t("about.albums")} className="pb-8">
        {albums.map((a) => (
          <Link
            key={a.slug}
            href={`/${locale}/albums/${a.slug}`}
            className="group shrink-0 snap-start w-40 sm:w-48 rounded-xl p-3 bg-foreground/4 hover:bg-foreground/9 active:bg-foreground/12 transition-colors"
          >
            <div
              className="relative w-full aspect-square rounded-lg overflow-hidden mb-3"
              // Neutral shadow, not the album's colour — see AboutContent.
              style={{ boxShadow: "0 8px 24px -10px rgba(0,0,0,0.35)", ...blurStyle(a.coverThumbhash) }}
            >
              {hasLadder(a.coverLadder) ? (
                <picture>
                  <source type="image/avif" sizes={ALBUM_COVER_SIZES} srcSet={srcSet(a.coverLadder, "avif")} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fallbackSrc(a.coverLadder)}
                    srcSet={srcSet(a.coverLadder, "webp")}
                    sizes={ALBUM_COVER_SIZES}
                    alt={`${a.title} — album cover`}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </picture>
              ) : (
                <Image src={a.cover} alt={`${a.title} — album cover`} fill sizes={ALBUM_COVER_SIZES} unoptimized className="object-cover" />
              )}
            </div>
            <p className="text-sm font-bold text-foreground truncate">{a.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {t("portfolio.photoCount", { n: a.photoCount })}
            </p>
          </Link>
        ))}
      </Shelf>

      {/* Photo grid, the middle */}
      {photosBelowAlbums.length > 0 && (
        <section className={`relative z-10 ${showJournal ? "pb-12" : "pb-10"}`}>
          <PhotoGrid
            photos={photosBelowAlbums}
            onPhotoClick={(i) => setLightbox(i + photosAboveAlbums.length)}
            gap={2}
          />
        </section>
      )}

      {/* The journal — a magazine spread among the photographs */}
      {showJournal && journal && <JournalSpread journal={journal} />}

      {/* Photo grid, the rest */}
      {photosBelowJournal.length > 0 && (
        <section className="relative z-10 pb-10">
          <PhotoGrid
            photos={photosBelowJournal}
            onPhotoClick={(i) => setLightbox(i + journalAt)}
            gap={2}
          />
        </section>
      )}

      {/* CTA */}
      <section className="relative z-10 mx-4 sm:mx-8 mb-32 bg-foreground/5 border border-border p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold">{t("portfolio.ctaTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
            {t("portfolio.ctaBody")}
          </p>
        </div>
        <Link href={`/${locale}/book`} className="btn-glass-primary shrink-0 text-xs font-bold px-5 py-2.5">
          {t("service.bookSession")} →
        </Link>
      </section>

      {/* Lightbox — shared component */}
      {lightbox !== null && (
        <Lightbox
          photos={photos}
          index={lightbox}
          onClose={closeLightbox}
          onPrev={prevPhoto}
          onNext={nextPhoto}
        />
      )}

      <GalleryPickerSheet
        open={picker !== null}
        onClose={() => setPicker(null)}
        mode={picker ?? "albums"}
        galleries={galleries}
        albums={albums}
        locale={locale}
      />

    </div>
  );
}