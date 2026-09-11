"use client";

import { useState, useCallback, useMemo, type CSSProperties } from "react";
import PhotoGrid from "@/src/components/common/PhotoGrid";
import Image from "next/image";
import { bunnyUrl } from "@/src/lib/bunny-url";
import Link from "next/link";
import Lightbox from "@/src/components/common/Lightbox";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import { BEST_PICKS, CTA_BANNER, MY_WORKS, OPEN_TO } from "./photos";
import type { WorksCategory } from "./photos";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import { testimonials } from "@/src/lib/testimonials";
import { entryPackage, getServiceBySlug } from "@/src/lib/services";
import { formatSom } from "@/src/lib/packages";
import type { Locale } from "@/src/lib/i18n/config";
import StickyHeader from "@/src/components/common/StickyHeader";
import Shelf from "@/src/components/common/Shelf";
import BioTypewriter from "@/src/components/common/BioTypewriter";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { pfps } from "@/src/lib/pfps";
import ProfilePhotos from "@/src/components/common/ProfilePhotos";

// ─── Data ─────────────────────────────────────────────────
// Short one-word disciplines — they sit inline in the hero meta bar separated by
// hairline rules, so anything longer than a word breaks the rhythm. (The old
// list read "Fashion photography / Street photography / Whatever-looks-nice
// photography"; the noun is redundant once they're grouped under a photographer.)
const tags = ["Portrait", "Fashion", "Graduation","Commercial"];

// Text-only in the new hero — the meta bar is a typographic strip, so the
// lucide glyphs that used to sit in the pill buttons are gone.
const socialLinks = [
  { label: "Instagram", href: "https://www.instagram.com/saycheeeeeze" },
  { label: "Telegram",  href: "https://t.me/saycheeeeeze" },
  { label: "Kavyar",    href: "https://kavyar.com/o6yaavonoqek" },
  { label: "Pixieset",  href: "https://pixies.et/LTdEhFHc" },
];

type WorksFilter = "All" | WorksCategory;
/** Featured strip tiles: 45vw on a phone, a fixed 208px column above that. */
const PICK_SIZES = "(max-width: 640px) 45vw, 208px";
/** Service cards. */
const CARD_SIZES = "(min-width: 1024px) 24vw, 224px";
/** Album shelf cards. */
const ALBUM_COVER_SIZES = "(max-width: 640px) 40vw, 192px";

/**
 * Built from the photographs that are actually in MY_WORKS, in the order they
 * first appear there.
 *
 * It used to be a hand-written list of all eight categories, six of which —
 * Commercial, Moments, Fashion, Street, Nature — matched no photograph at all
 * and opened an empty grid. A list derived from the data cannot make that
 * claim: add the first Fashion frame and the tab appears, remove the last one
 * and it goes. Reorder by moving entries in about/photos.ts.
 */
const WORKS_FILTERS: WorksFilter[] = [
  "All",
  ...Array.from(new Set(MY_WORKS.map((w) => w.cat))),
];

// ─── Page ─────────────────────────────────────────────────
export default function AboutContent({
  albums,
  photoIndex,
}: {
  albums: AlbumData[];
  /** storage path → the photo record, resolved server-side. */
  photoIndex: Record<string, AlbumPhoto>;
}) {
  /**
   * A storage path becomes a full photo when the database knows it, and a bare
   * CDN URL when it does not. The fallback is exactly the old behaviour, so a
   * path pointing at a file that was never uploaded stays as broken as it was
   * rather than disappearing.
   */
  const pick = useCallback(
    (path: string): AlbumPhoto => photoIndex[path] ?? { src: bunnyUrl(path) },
    [photoIndex],
  );

  const bestPicks = useMemo(() => BEST_PICKS.map(pick), [pick]);
  const myWorks = useMemo(
    () => MY_WORKS.map((w) => ({ ...pick(w.path), cat: w.cat })),
    [pick],
  );
  const { t, locale } = useT();
  const [worksFilter, setWorksFilter] = useState<WorksFilter>("All");

  /**
   * The tag's label in the reader's language.
   *
   * t() echoes the key back when it is missing, so an untranslated category
   * falls back to its own name rather than printing "about.worksCat.Fashion"
   * onto the page — which matters because this list is derived from the
   * photographs, and a new category can appear here before anyone has written
   * a translation for it.
   */
  const worksLabel = useCallback(
    (f: WorksFilter): string => {
      if (f === "All") return t("about.worksAll");
      const key = `about.worksCat.${f}`;
      const value = t(key);
      return value === key ? f : value;
    },
    [t],
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // AlbumPhoto, not { src, alt } — narrowing here would drop ladder and
  // thumbhash on the way into the lightbox and silently undo the migration.
  const [lightboxPhotos, setLightboxPhotos] = useState<AlbumPhoto[]>([]);

  const openLightbox = useCallback((photos: AlbumPhoto[], index: number) => {
    setLightboxPhotos(photos);
    setLightboxIndex(index);
  }, []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prevPhoto = useCallback(() =>
    setLightboxIndex((i) => i !== null ? (i - 1 + lightboxPhotos.length) % lightboxPhotos.length : null),
    [lightboxPhotos.length]);
  const nextPhoto = useCallback(() =>
    setLightboxIndex((i) => i !== null ? (i + 1) % lightboxPhotos.length : null),
    [lightboxPhotos.length]);

  const visibleWorks = worksFilter === "All"
    ? myWorks
    : myWorks.filter((w) => w.cat === worksFilter);

  // const pfps = getPfps();

  return (
    <div className="min-h-screen bg-background text-white overflow-x-clip">

      {/* ── Hero wash: a warm veil at the very top that melts into the page
             background. Much quieter than the old block — the new hero carries
             its weight typographically, so the gradient only needs to keep the
             top of the page from reading as flat black. Does NOT fade on
             scroll; the sticky header handles that instead. ── */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-105 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,236,205,0.045) 0%, rgba(255,236,205,0.018) 45%, rgba(14,12,9,0) 100%)",
        }}
      />

      {/* Sticky bar — the wordmark stays centred and legible from first paint,
          and the tinted background still fades in as you scroll past the hero */}
      <StickyHeader title="saycheeeeeze" accent="#0e0c09" fadeOver={260} variant="wordmark" />

      {/* ══ HERO ══ */}
      <section
        className="relative z-10 px-4 sm:px-8 pb-6 sm:pb-8"
        style={{ paddingTop: "calc(5.25rem + env(safe-area-inset-top))" }}
      >
        {/* ── Identity row: portrait tile, name block, and (desktop only) CTAs ── */}
        <div className="flex items-center gap-4 sm:gap-6">

          <div className="flex items-center gap-4 sm:gap-6">
            <ProfilePhotos images={pfps} interval={4000} />
            {/* name block, CTAs */}
          </div>

          {/* <div className="relative shrink-0 w-18 h-22 sm:w-28 sm:h-34 rounded-2xl overflow-hidden border border-white/8 bg-white/5">
            <Image
              src={pfp}
              alt="Marshall — photographer in Tashkent"
              fill
              sizes="(min-width: 640px) 112px, 72px"
              className="object-cover"
              priority
            />
          </div> */}

          <div className="min-w-0 flex-1 flex flex-col lg:flex-row lg:items-center lg:justify-between lg:gap-8">
            <div className="min-w-0">
              {/* text-balance is what splits this into "Photographer /
                  in Tashkent" on a phone instead of the greedy
                  "Photographer in / Tashkent". */}
              <h1 className="text-xl sm:text-4xl lg:text-[3.25rem] font-bold tracking-[-0.02em] leading-[1.03] text-balance">
                {t("about.heroTitle")}
              </h1>
              <p className="mt-2 sm:mt-3 font-mono text-[7px] sm:text-xs uppercase tracking-[0.16em] text-fg-faint">
                {t("about.heroSubtitle")}
              </p>
            </div>

            {/* Desktop CTAs sit beside the name; on mobile they move below the
                bio (see below) so the fold leads with words, not buttons. */}
            <div className="hidden lg:flex shrink-0">
              <HeroActions locale={locale} portfolioLabel={t("about.viewPortfolio")} bookLabel={t("about.bookSession")} />
            </div>
          </div>
        </div>

        {/* ── Meta bar: disciplines left, socials right (desktop only) ── */}
        <div className="mt-5 sm:mt-8 flex items-center justify-between gap-6 h-9 lg:h-11 px-3 lg:px-5 rounded-sm border border-white/8 bg-white/4">
          <div className="flex items-center min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {tags.map((tag, i) => (
              <span key={tag} className="flex items-center shrink-0">
                {i > 0 && <span aria-hidden className="w-px h-4 bg-white/12 mx-3 lg:mx-4" />}
                <span className="font-mono text-[8.5px] lg:text-xs uppercase tracking-[0.14em] text-fg-muted whitespace-nowrap">
                  {tag}
                </span>
              </span>
            ))}
          </div>

          <div className="hidden lg:flex items-center gap-5 shrink-0">
            {socialLinks.map((s) => (
              <SocialLink key={s.label} {...s} />
            ))}
          </div>
        </div>

        {/* ── Welcome, then bio ── */}
        {/* Static, and deliberately so: it is the one line that has to be
            readable in the first frame, before the variant chunk resolves and
            before anything starts typing. It is also the only sentence on the
            page that says what the page IS.

            A step and a half larger than the bio at each breakpoint (16/18 vs
            the bio's 14/15) so it reads as the greeting and the bio reads as
            the detail under it — same width, so they share a left edge. */}
        <p className="mt-8 sm:mt-10 mx-auto max-w-2xl text-center text-lg sm:text-2xl font-semibold leading-snug text-balance text-white">
          {t("about.welcome")}
        </p>
        {/* Centred column, left-aligned text. The welcome line above is centred
            because it is a statement; this is not, because a typewriter on
            centred text re-centres on every character and the whole paragraph
            jitters as it types. Sharing the column keeps them one block. */}
        <BioTypewriter className="mt-4 sm:mt-5 mx-auto" />

        {/* ── Mobile CTAs + socials ── */}
        <div className="lg:hidden mt-0">
          <HeroActions locale={locale} portfolioLabel={t("about.viewPortfolio")} bookLabel={t("about.bookSession")} />
        </div>
        <div className="lg:hidden mt-6 pt-5 border-t border-white/8 flex flex-wrap gap-x-5 gap-y-3">
          {socialLinks.map((s) => (
            <SocialLink key={s.label} {...s} />
          ))}
        </div>
      </section>

      {/* ══ MY BEST PICKS ══ */}
      <Shelf title={t("about.bestPicks")} showAllLabel={t("common.showAll")} showAllHref={`/${locale}/portfolio`} className="mt-6 sm:mt-4 pb-4">
        {bestPicks.map((p, i) => (
          <button
            key={i}
            className="relative shrink-0 snap-start overflow-hidden rounded-xl bg-white/5 w-44 sm:w-52 h-56 sm:h-64 cursor-pointer group active:scale-[0.97] transition-transform"
            onClick={() => openLightbox(bestPicks.map((b, n) => ({ ...b, alt: `Featured photograph ${n + 1} by saycheeeeeze` })), i)}
          >
            {hasLadder(p.ladder) ? (
              <picture>
                <source type="image/avif" sizes={PICK_SIZES} srcSet={srcSet(p.ladder, "avif")} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fallbackSrc(p.ladder)}
                  srcSet={srcSet(p.ladder, "webp")}
                  sizes={PICK_SIZES}
                  alt={`Featured photograph ${i + 1} by saycheeeeeze`}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover group-hover:brightness-90 transition-[filter] duration-200"
                />
              </picture>
            ) : (
              /* No row for this path — same plain CDN URL as before. */
              <Image src={p.src} alt={`Featured photograph ${i + 1} by saycheeeeeze`} fill sizes={PICK_SIZES} unoptimized className="object-cover group-hover:brightness-90 transition-[filter] duration-200" />
            )}
          </button>
        ))}
      </Shelf>

      {/* ══ ALBUMS ══ */}
      <Shelf title={t("about.galleries")} className="pb-6 mt-6 sm:mt-12">
        {albums.map((a) => (
          <Link
            key={a.slug}
            href={`/${locale}/albums/${a.slug}`}
            // Spotify card anatomy: square art, then title + meta BELOW it on a
            // tinted panel — not text overlaid on the photo. Keeps the image clean.
            className="group shrink-0 snap-start w-40 sm:w-48 rounded-xl p-3 bg-white/4 hover:bg-white/9 active:bg-white/12 transition-colors"
          >
            <div
              className="relative w-full aspect-square rounded-lg overflow-hidden mb-3 shadow-lg"
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
                    alt={`${a.title} — album cover, ${a.location} ${a.year}`}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </picture>
              ) : (
                <Image src={a.cover} alt={`${a.title} — album cover, ${a.location} ${a.year}`} fill sizes={ALBUM_COVER_SIZES} unoptimized className="object-cover" />
              )}
            </div>
            <p className="text-sm font-bold text-white truncate">{a.title}</p>
            <p className="text-xs text-white/50 mt-0.5 truncate">
              {a.year} · {a.photoCount} photos
            </p>
          </Link>
        ))}
      </Shelf>

      {/* ══ TESTIMONIALS ══ */}
      {testimonials.length > 0 && (
        <Shelf title={t("about.testimonials")} className="pb-6 mt-6 sm:mt-12">
          {testimonials.map((quote, i) => (
            <figure
              key={i}
              className="shrink-0 snap-start w-72 sm:w-80 rounded-xl p-5 bg-white/4 flex flex-col justify-between"
            >
              <blockquote className="text-sm text-white/85 leading-relaxed">
                &ldquo;{quote.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-4 pt-3 border-t border-white/10">
                <p className="text-sm font-bold text-white">{quote.name}</p>
                <p className="text-xs text-white/40 mt-0.5">{quote.context}</p>
              </figcaption>
            </figure>
          ))}
        </Shelf>
      )}

      {/* ══ OPEN TO ══ */}
      <div className="lg:hidden">
        <Shelf title={t("about.openTo")} className="pb-6 mt-6">
          {OPEN_TO.map((o, i) => <OpenToCard key={i} item={o} photo={pick(o.path)} locale={locale} fromLabel={t("about.from")} detailsLabel={t("about.viewDetails")} />)}
        </Shelf>
      </div>
      <section className="hidden lg:block relative z-10 pb-10 mt-12 mb-12">
        <h2 className="text-3xl font-extrabold tracking-tight px-8 mb-5">{t("about.openTo")}</h2>
        <div className="grid grid-cols-4 gap-4 px-8">
          {OPEN_TO.map((o, i) => <OpenToCard key={i} item={o} photo={pick(o.path)} locale={locale} fromLabel={t("about.from")} detailsLabel={t("about.viewDetails")} />)}
        </div>
      </section>

      {/* ══ CTA BANNER ══ */}
      {/*       
      <section className="relative z-10 mx-4 sm:mx-8 mb-8 sm:mb-15 rounded-2xl overflow-hidden mt-8 min-h-70 lg:min-h-85">
        <div className="absolute inset-0">
          <Image src="/img4.JPG" alt="photographer" fill sizes="100vw" className="object-cover object-center" />
          <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/50 to-transparent" />
        </div>
        <div className="relative z-10 p-6 sm:p-10 flex flex-col justify-end h-full min-h-70 lg:min-h-85">
          <h2 className="text-2xl sm:text-4xl font-bold leading-tight max-w-xs sm:max-w-sm">
            {t("about.ctaTitle")}
          </h2>
          <p className="text-white/60 text-xs sm:text-sm mt-2 max-w-xs">{t("about.ctaSub")}</p>
          <p className="text-white/50 text-xs mt-3 max-w-sm leading-relaxed hidden sm:block">
            {t("about.ctaBody")}
          </p>
          <Link href={`/${locale}/book`} className="mt-5 self-start bg-white text-black text-xs font-bold px-5 py-2.5 rounded-full hover:bg-white/80 transition">
            {t("about.ctaButton")} →
          </Link>
        </div>
      </section> */}

      {/* ══ CTA BANNER ══ */}
      <section className="relative z-10 w-full overflow-hidden mt-8 mb-8 sm:mb-15 min-h-104 sm:min-h-120">
        <div className="absolute inset-0">
          {(() => {
            const banner = pick(CTA_BANNER);
            return hasLadder(banner.ladder) ? (
              <picture>
                <source type="image/avif" sizes="100vw" srcSet={srcSet(banner.ladder, "avif")} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fallbackSrc(banner.ladder)}
                  srcSet={srcSet(banner.ladder, "webp")}
                  sizes="100vw"
                  alt="photographer"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-center"
                />
              </picture>
            ) : (
              <Image src={banner.src} alt="photographer" fill sizes="100vw" unoptimized className="object-cover object-center" />
            );
          })()}
          {/* dark on the left, fading right */}
          <div className="absolute inset-0 bg-linear-to-r from-black/90 via-black/60 to-black/10" />
          {/* overall dim */}
          <div className="absolute inset-0 bg-black/25" />
        </div>

        <div className="relative z-10 flex h-full min-h-104 sm:min-h-120 flex-col justify-center px-6 sm:px-10 lg:px-16 py-10">
          <h2 className="text-4xl font-bold leading-[1.08] tracking-tight max-w-68">
            {t("about.ctaTitle")}
          </h2>

          <p className="mt-3 max-w-68 text-sm font-semibold text-white/90">
            {t("about.ctaSub")}
          </p>

          <p className="mt-4 max-w-60 text-[11px] leading-[1.65] text-white/70">
            {t("about.ctaBody")}
          </p>

          <Link
            href={`/${locale}/book`}
            className="mt-6 self-start rounded-full bg-white px-5 py-2.5 text-[11px] font-bold text-black transition hover:bg-white/80"
          >
            {t("about.ctaButton")} →
          </Link>
        </div>
      </section>


      {/* ══ MY WORKS — full bleed ══ */}
      <section className="relative z-10 pb-32">
        <div className="px-4 sm:px-8 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t("about.myWorks")}</h2>
          <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible pb-1">
            {WORKS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setWorksFilter(f)}
                className={`rounded-full px-4 py-2.5 text-xs font-semibold transition active:scale-95
                  ${worksFilter === f ? "bg-white text-black" : "bg-white/8 text-white/60 hover:bg-white/15 hover:text-white"}`}
              >
                {worksLabel(f)}
              </button>
            ))}
          </div>
        </div>

        {/* Full bleed Pixieset-style grid */}
        <PhotoGrid
          photos={visibleWorks.map((w) => ({ ...w, alt: `${w.cat} photography by saycheeeeeze` }))}
          onPhotoClick={(i) => openLightbox(visibleWorks.map((w) => ({ ...w, alt: `${w.cat} photography by saycheeeeeze` })), i)}
          gap={2}
        />

        <p className="text-center text-xs text-white/40 mt-6">
          {t("about.viewMorePrefix")}{" "}
          <Link href={`/${locale}/portfolio`} className="text-white font-medium hover:underline">
            {t("about.portfolioPage")}
          </Link>
        </p>
      </section>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          onClose={closeLightbox}
          onPrev={prevPhoto}
          onNext={nextPhoto}
        />
      )}

    </div>
  );
}

/**
 * The hero's two calls to action. Rendered twice — beside the name on desktop,
 * below the bio on mobile — so only one is ever in the DOM at a given width.
 * Portfolio is the gold/primary action: the page's job is to get people looking
 * at photographs first, booking second.
 */

const heroActionClasses =
  "flex-1 lg:flex-none h-8 lg:h-11 px-5 lg:px-6 rounded-md " +
  "font-mono text-[9.5px] lg:text-xs font-medium uppercase tracking-[0.14em] " +
  "active:scale-[0.98]";


function HeroActions({ locale, portfolioLabel, bookLabel }: { locale: string; portfolioLabel: string; bookLabel: string }) {
  return (
    <div className="flex items-center gap-3 w-full lg:w-auto">
      <Button asChild className={heroActionClasses}>
        <Link href={`/${locale}/portfolio`}>{portfolioLabel}</Link>
      </Button>

      <Button asChild variant="outline" className={`${heroActionClasses} bg-black border-white/20 text-white hover:bg-white/8`}>
        <Link href={`/${locale}/book`}>{bookLabel}</Link>
      </Button>
    </div>
  );
}

// function HeroActions({ locale, portfolioLabel, bookLabel }: { locale: string; portfolioLabel: string; bookLabel: string }) {
//   return (
//     <div className="flex items-center gap-3 w-full lg:w-auto">
//       <Link
//         href={`/${locale}/portfolio`}
//         className="flex-1 lg:flex-none flex items-center justify-center h-8 lg:h-11 px-5 lg:px-6 rounded-md border
//                    bg-black border-white/20 text-accent-ink hover:bg-(--sc-accent-hover) active:scale-[0.98]
//                    font-mono text-[9.5px] lg:text-xs font-medium uppercase tracking-[0.14em]
//                    whitespace-nowrap transition"
//       >
//         {portfolioLabel}
//       </Link>
//       <Link
//         href={`/${locale}/book`}
//         className="flex-1 lg:flex-none flex items-center justify-center h-8 lg:h-11 px-5 lg:px-6 rounded-md
//                    border bg-black border-white/20 text-white hover:bg-white/8 active:scale-[0.98]
//                    font-mono text-[9.5px] lg:text-xs font-medium uppercase tracking-[0.14em]
//                    whitespace-nowrap transition"
//       >
//         {bookLabel}
//       </Link>
//     </div>
//   );
// }

/**
 * Gradients for the two links that are somebody else's brand.
 *
 * Real Instagram and Telegram hues, with the dark ends lifted — see
 * .sc-brand-text in globals.css for the contrast measurements and why. The
 * angle is a few degrees off horizontal so the sweep tilts the way Instagram's
 * own mark does; over one short line the vertical component is nearly nothing,
 * which is the point.
 *
 * Keyed by the label, so a social link with no brand here (Kavyar, Pixieset)
 * keeps the muted-to-white treatment and nothing has to be passed in.
 */
const BRAND_GRADIENT: Record<string, string> = {
  Instagram:
    "linear-gradient(100deg,#FEDA75 0%,#F98033 27%,#EE467F 55%,#C551D6 78%,#9490FF 100%)",
  Telegram:
    "linear-gradient(100deg,#6FD5FF 0%,#37BBFE 35%,#2AABEE 65%,#2196D6 100%)",
};

/** What the letters fall back to where the gradient cannot be painted. */
const BRAND_FALLBACK: Record<string, string> = {
  Instagram: "#EE467F",
  Telegram: "#2AABEE",
};

function SocialLink({ label, href }: { label: string; href: string }) {
  const gradient = BRAND_GRADIENT[label];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "font-mono text-[11px] lg:text-xs uppercase tracking-[0.14em] whitespace-nowrap " +
        (gradient
          ? "sc-brand-text"
          : "text-fg-muted hover:text-white transition-colors")
      }
      style={
        gradient
          ? ({
              "--sc-brand-gradient": gradient,
              // Not decoration: this is what shows if background-clip:text is
              // unavailable, and what ::selection and any underline use.
              color: BRAND_FALLBACK[label],
            } as CSSProperties)
          : undefined
      }
    >
      {label}
    </a>
  );
}

function OpenToCard({ item, photo, locale, fromLabel, detailsLabel }: { item: (typeof OPEN_TO)[number]; photo: AlbumPhoto; locale: string; fromLabel: string; detailsLabel: string }) {
  // entryPackage(), not packages[0]: `packages` is now optional (a service with
  // grouped packages has none) and the first entry is not necessarily the
  // cheapest. This read used to be `.packages[0].price`, a field that no longer
  // exists — it would have rendered an empty "from" label rather than erroring.
  const entry = (() => {
    const service = getServiceBySlug(item.slug);
    return service ? entryPackage(service) : undefined;
  })();
  const fromPrice = entry ? formatSom(entry.priceUzs, locale as Locale) : null;
  return (
    <Link
      href={`/${locale}/services/${item.slug}`}
      className="group shrink-0 snap-start lg:shrink w-56 lg:w-auto bg-white/4 hover:bg-white/9 active:bg-white/12 rounded-xl overflow-hidden flex flex-col transition-colors"
    >
      <div className="relative h-36 lg:h-54 bg-gray-900">
        {hasLadder(photo.ladder) ? (
          <picture>
            <source type="image/avif" sizes={CARD_SIZES} srcSet={srcSet(photo.ladder, "avif")} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fallbackSrc(photo.ladder)}
              srcSet={srcSet(photo.ladder, "webp")}
              sizes={CARD_SIZES}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
            />
          </picture>
        ) : (
          <Image src={photo.src} alt={item.title} fill sizes={CARD_SIZES} unoptimized className="object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
        )}
        {fromPrice && (
          <div className="absolute top-2 right-2 bg-[#2a6045] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {fromLabel} {fromPrice}
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        <p className="text-xl font-semibold">{item.title}</p>
        <p className="text-[11px] text-white/40 leading-snug flex-1">{item.sub}</p>
        <span className="mt-2 w-full bg-white/10 group-hover:bg-white/20 transition text-white text-sm font-semibold py-2 rounded-xl text-center">
          {detailsLabel} →
        </span>
      </div>
    </Link>
  );
}