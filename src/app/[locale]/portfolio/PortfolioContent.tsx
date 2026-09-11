"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Images, KeyRound, ChevronRight } from "lucide-react";
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
import type { GalleryListing } from "@/src/lib/client-galleries";

// How many photos sit above the Albums shelf. Heights are natural, so this
// can't be an exact "half a screen" — 6 lands close to 50vh both on a phone
// (3 columns, ~2 rows of portraits) and on a laptop (4–5 wider columns,
// ~1.5 rows). Raise it to push the albums further down the page.
const PHOTOS_BEFORE_ALBUMS = 6;

// Two doors into the same picker. `mode` decides which galleries it lists.
// Labels are dictionary KEYS, not text — these used to be hardcoded English
// and shipped untranslated to /ru and /uz.
const CLIENT_GALLERY_ENTRIES = [
  {
    mode: "public" as const,
    labelKey: "portfolio.clientGalleries",
    hintKey: "portfolio.clientGalleriesHint",
    Icon: Images,
  },
  {
    mode: "private" as const,
    labelKey: "portfolio.privateGallery",
    hintKey: "portfolio.privateGalleryHint",
    Icon: KeyRound,
  },
];

// Days since the epoch, in Tashkent — the same integer on the server and in
// every visitor's browser, whatever timezone they're in.
function daySeed(): number {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

// mulberry32 — a tiny deterministic PRNG. Same seed in, same sequence out.
function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function PortfolioContent({ 
  photos: allPhotos,
  albums, 
  galleries,
}: { 
  photos: PortfolioPhoto[];
  albums: AlbumData[];
  galleries: GalleryListing[];
}) {
  const { t, locale } = useT();
  // The grid is shuffled so the portfolio doesn't always lead with the same
  // photos. The seed is the calendar day, NOT Math.random(): the server and
  // the browser both have to arrive at the same order or React throws away
  // the server-rendered HTML and re-renders the whole grid on hydration. The
  // order therefore holds steady for a day and rotates at midnight.
  const shuffled = useMemo(() => shuffleWithSeed(allPhotos, daySeed()), [allPhotos]);
  const [filter, setFilter]     = useState<string>("All");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [picker, setPicker] = useState<"public" | "private" | null>(null);

  // Filter pills are derived from whatever top-level folders actually exist
  // in Bunny Storage — no hardcoded category list to keep in sync.
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

  const visibleData = filter === "All" ? shuffled : shuffled.filter((p) => p.category === filter);
  // Spread, not { src, alt }. Narrowing here would throw away ladder,
  // thumbhash and dimensions and put the portfolio straight back onto the
  // Optimizer — the exact mistake that made this page the last one to migrate.
  const photos: Photo[] = visibleData.map((p) => ({ ...p, alt: p.alt }));

  // The grid is rendered in two halves so the Albums shelf can sit inside it
  // rather than after it. Lightbox indices stay global: the lower grid adds
  // the upper grid's length back on, so `photos[index]` is always the photo
  // that was actually clicked.
  const photosAboveAlbums = photos.slice(0, PHOTOS_BEFORE_ALBUMS);
  const photosBelowAlbums = photos.slice(PHOTOS_BEFORE_ALBUMS);

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
    <div className="min-h-screen bg-background text-white overflow-x-clip">

      {/* Hero wash — saturated at the top, melting into the page background */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-95 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(80, 100, 119, 0.28) 0%, rgba(80, 100, 119,0.09) 45%, rgba(14,12,9,0) 100%)",
        }}
      />

      {/* backHref has to carry the locale — a bare "/" sends the visitor
          through the middleware redirect and can land them in another language. */}
      <StickyHeader
        title={t("portfolio.title")}
        accent="#0e0c09"
        fadeOver={200}
        backHref={`/${locale}`}
      />

      {/* Hero */}
      <section
        className="relative z-10 px-4 sm:px-8 pb-6"
        style={{ paddingTop: "calc(5rem + env(safe-area-inset-top))" }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-2">
          {t("portfolio.eyebrow")}
        </p>
        {/* Spotify goes very large and very tight on hero titles */}
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tighter leading-[0.95]">
          {t("portfolio.title")}
        </h1>
        <p className="text-sm text-white/60 mt-3 max-w-sm leading-relaxed">
          {t("portfolio.subtitle")}
        </p>
        <p className="text-xs text-white/40 mt-2 font-medium">
          {t("portfolio.photoCount", { n: allPhotos.length })}
        </p>
      </section>

      {/* Client galleries — two entry points into the delivery pages */}
      <section className="relative z-10 px-4 sm:px-8 pb-5">
        <div className="grid grid-cols-2 gap-2.5 sm:max-w-lg">
          {CLIENT_GALLERY_ENTRIES.map(({ mode, labelKey, hintKey, Icon }) => (
            <button
              key={mode}
              onClick={() => setPicker(mode)}
              className="group flex flex-col gap-3 rounded-xl bg-white/6 hover:bg-white/10 active:bg-white/12 p-3.5 text-left transition active:scale-[0.98]"
            >
              <span className="flex items-center justify-between">
                <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 group-hover:bg-white/15 transition">
                  <Icon className="w-4 h-4 text-white" />
                </span>
                <ChevronRight className="w-4 h-4 text-white/25 group-hover:text-white/60 transition" />
              </span>
              <span>
                <span className="block text-sm font-bold leading-tight">{t(labelKey)}</span>
                <span className="block text-[11px] text-white/40 mt-1 leading-snug">{t(hintKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Category stats */}
      <section className="relative z-10 px-4 sm:px-8 pb-5">
        <div className="flex gap-2.5 overflow-x-auto [&::-webkit-scrollbar]:hidden pb-1 snap-x scroll-px-4">
          {catStats.map(({ label, count }) => (
            <button
              key={label}
              onClick={() => setFilter(label)}
              className={`shrink-0 snap-start rounded-xl px-4 py-2.5 text-center transition active:scale-95
                ${filter === label ? "bg-white text-black" : "bg-white/6 hover:bg-white/10 text-white"}`}
            >
              <p className="text-lg font-bold leading-none">{count}</p>
              <p className={`text-[10px] mt-0.5 ${filter === label ? "text-black/50" : "text-white/40"}`}>{label}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Filter pills */}
      <section className="relative z-10 px-4 sm:px-8 pb-4">
        <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible pb-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full px-4 py-2.5 text-xs font-semibold transition active:scale-95
                ${filter === f ? "bg-white text-black" : "bg-white/8 text-white/60 hover:bg-white/15 hover:text-white"}`}
            >
              {f === "All" ? t("portfolio.all") : f}
            </button>
          ))}
        </div>
      </section>

      {/* ── Photo grid, upper half — full bleed, Pixieset style ── */}
      <section className="relative z-10 pb-8">
        {allPhotos.length === 0 ? (
          <div className="px-6 py-20 text-center flex flex-col items-center gap-3">
            <p className="text-base font-bold text-white/70">{t("portfolio.emptyTitle")}</p>
            <p className="text-sm text-white/40 max-w-xs">
              {t("portfolio.emptyBody")}
            </p>
          </div>
        ) : visibleData.length === 0 ? (
          <div className="px-6 py-16 text-center flex flex-col items-center gap-3">
            <p className="text-sm text-white/40">{t("portfolio.emptyFilter")}</p>
            <button
              onClick={() => setFilter("All")}
              className="rounded-full px-5 min-h-11 bg-white/[0.07] hover:bg-white/12 text-xs font-bold transition active:scale-95"
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
            className="group shrink-0 snap-start w-40 sm:w-48 rounded-xl p-3 bg-white/4 hover:bg-white/9 active:bg-white/12 transition-colors"
          >
            <div
              className="relative w-full aspect-square rounded-lg overflow-hidden mb-3"
              style={{ boxShadow: `0 8px 24px -8px ${a.color}`, ...blurStyle(a.coverThumbhash) }}
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
            <p className="text-sm font-bold text-white truncate">{a.title}</p>
            <p className="text-xs text-white/50 mt-0.5 truncate">
              {t("portfolio.photoCount", { n: a.photoCount })}
            </p>
          </Link>
        ))}
      </Shelf>

      {/* ── Photo grid, the rest ── */}
      {photosBelowAlbums.length > 0 && (
        <section className="relative z-10 pb-10">
          <PhotoGrid
            photos={photosBelowAlbums}
            onPhotoClick={(i) => setLightbox(i + photosAboveAlbums.length)}
            gap={2}
          />
        </section>
      )}

      {/* CTA */}
      <section className="relative z-10 mx-4 sm:mx-8 mb-32 bg-white/5 border border-white/[0.07] p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold">{t("portfolio.ctaTitle")}</h2>
          <p className="text-xs text-white/40 mt-1 max-w-xs leading-relaxed">
            {t("portfolio.ctaBody")}
          </p>
        </div>
        <Link href={`/${locale}/book`} className="shrink-0 bg-white text-black text-xs font-bold px-5 py-2.5 rounded-full hover:bg-white/80 transition">
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
        mode={picker ?? "public"}
        galleries={galleries}
        locale={locale}
      />

    </div>
  );
}