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
import BestPicks, { type PickItem } from "./BestPicks";
import { FALLBACK_RATIO, formatPickDate } from "./best-picks";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import { testimonials } from "@/src/lib/testimonials";
import { entryPackage, getServiceBySlug } from "@/src/lib/services";
import { formatSom } from "@/src/lib/packages";
import type { Locale } from "@/src/lib/i18n/config";
import StickyHeader from "@/src/components/common/StickyHeader";
import Shelf from "@/src/components/common/Shelf";
import BioTypewriter from "@/src/components/common/BioTypewriter";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { Button } from "@/src/components/ui/button";
import { pfps } from "@/src/lib/pfps";
import ProfilePhotos from "@/src/components/common/ProfilePhotos";

// The discipline tags (PORTRAIT | FASHION | GRADUATION | COMMERCIAL) that sat
// in the hero meta bar were removed on 2026-11-02 at Marshall's request; the
// social links took their place on both layouts.

// Text-only in the new hero — the meta bar is a typographic strip, so the
// lucide glyphs that used to sit in the pill buttons are gone.
// Events, weddings, editorial, social-media batches and national dress all
// lost their service pages on 2026-10-06. Marshall still takes that work, so
// the "Open to" row ends with a line pointing at Telegram rather than at a page
// that no longer exists. This is the PUBLIC account, unlike the booking form's
// enquiry link, because this is a first contact and not a booking.
const ON_REQUEST_TELEGRAM = "https://t.me/saycheeeeeze";

const socialLinks = [
  { label: "Instagram", href: "https://www.instagram.com/saycheeeeeze" },
  { label: "Telegram",  href: "https://t.me/saycheeeeeze" },
  { label: "Kavyar",    href: "https://kavyar.com/o6yaavonoqek" },
  { label: "Pixieset",  href: "https://pixies.et/LTdEhFHc" },
];

type WorksFilter = "All" | WorksCategory;
/** Service cards. */
const CARD_SIZES = "(min-width: 1024px) 24vw, 224px";
/** Album shelf cards. */
const ALBUM_COVER_SIZES = "(max-width: 640px) 40vw, 192px";

/**
 * Built from the photographs actually in MY_WORKS, in the order they first
 * appear there. Hand-written, this listed categories that matched no
 * photograph and opened an empty grid; derived, it can't. Add the first
 * Fashion frame and the tab appears, remove the last and it goes. Reorder by
 * moving entries in about/photos.ts.
 */
const WORKS_FILTERS: WorksFilter[] = [
  "All",
  ...Array.from(new Set(MY_WORKS.map((w) => w.cat))),
];

// Page
export default function AboutContent({
  albums,
  photoIndex,
}: {
  albums: AlbumData[];
  /** storage path → the photo record, resolved server-side. */
  photoIndex: Record<string, AlbumPhoto>;
}) {
  /** A storage path becomes a full photo when the database knows it, and a
   *  bare CDN URL when it doesn't — so a path pointing at a file that was
   *  never uploaded stays visibly broken rather than silently disappearing. */
  const pick = useCallback(
    (path: string): AlbumPhoto => photoIndex[path] ?? { src: bunnyUrl(path) },
    [photoIndex],
  );

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
   * shows its own name instead of "about.worksCat.Fashion". The list is
   * derived from the photographs, so a new category can appear before anyone
   * has written a translation for it.
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
  /**
   * Best picks, resolved for the grid: photo, shape and caption.
   *
   * The caption's category goes through worksLabel, so "Portrait" reads
   * "Портрет" here exactly as it does on the MY_WORKS filter below; the date is
   * formatted per language by formatPickDate (written-out month names, so the
   * server and the browser print the same string).
   *
   * `ratio` falls back to 4:5 when the database has no dimensions — a path
   * that was never synced still gets a tile rather than collapsing the column.
   */
  const pickItems = useMemo<PickItem[]>(
    () =>
      BEST_PICKS.map((p, index) => {
        const photo = pick(p.path);
        const category = worksLabel(p.cat);
        const subject = p.title || category;
        return {
          index,
          photo,
          ratio: photo.width && photo.height ? photo.width / photo.height : FALLBACK_RATIO,
          category,
          date: formatPickDate(p.date, locale),
          title: p.title,
          alt: t("about.bestPickAlt", { subject }),
        };
      }),
    [pick, worksLabel, locale, t],
  );
  const pickPhotos = useMemo(
    () => pickItems.map((it) => ({ ...it.photo, alt: it.alt })),
    [pickItems],
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

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">

      {/* Hero wash: a clay veil at the very top that melts into the page
             background. Quiet — the hero carries its weight typographically,
             so the gradient only needs to keep the top of the page from
             reading as flat. Clay rather than red: large areas are cream,
             clay and surface; the red is for the button. Does NOT fade on
             scroll; the sticky header handles that instead. ── */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-105 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in oklab, var(--secondary) 22%, transparent) 0%, color-mix(in oklab, var(--secondary) 7%, transparent) 45%, transparent 100%)",
        }}
      />

      {/* Sticky bar — the wordmark stays centred and legible from first paint,
          and the page-coloured background still fades in as you scroll past the hero */}
      <StickyHeader title="saycheeeeeze" fadeOver={260} variant="wordmark" />

      {/* Hero */}
      <section
        className="relative z-10 px-4 sm:px-8 pb-6 sm:pb-8"
        style={{ paddingTop: "calc(5.25rem + env(safe-area-inset-top))" }}
      >
        {/* Identity row: portrait tile, name block, and (desktop only) CTAs */}
        <div className="flex items-center gap-4 sm:gap-6">

          <div className="flex items-center gap-4 sm:gap-6">
            <ProfilePhotos images={pfps} interval={4000} />
            {/* name block, CTAs */}
          </div>

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

        {/* Meta bar: the social links, on both layouts.

            They used to share this strip with four discipline tags on desktop
            and sit in a separate row below the buttons on a phone. The tags
            are gone (2026-11-02) and the links moved up into their place, so
            the first thing under the name is where else to find the work.
            Spread edge to edge on a phone, where four short words in a
            full-width bar otherwise bunch up on the left; left-aligned with a
            fixed gap on desktop, where spreading them across 1200px would turn
            four links into four islands. Scrolls sideways on a very narrow
            screen rather than wrapping inside a fixed-height bar. */}
        <div className="mt-5 sm:mt-8 flex items-center justify-between lg:justify-start gap-5 lg:gap-8 h-9 lg:h-11 px-3 lg:px-5 rounded-sm border border-border bg-foreground/4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {socialLinks.map((s) => (
            <SocialLink key={s.label} {...s} />
          ))}
        </div>

        {/* Intro, as a film caption (Marshall's pick, 2026-11-02).

            It was a centred 18–24px bold welcome over a 14–15px bio, and on a
            phone the two together took most of the first screen for what is
            only a bio. Now: a tiny mono label, a hairline, and the welcome and
            the bio as ONE small italic paragraph, left-aligned — the way the
            caption under a printed photograph reads.

            The welcome is still static and still first — it is the one line
            that must be readable in the first frame, before anything types,
            and the only sentence that says what the page is. It is passed to
            BioTypewriter as a prefix so it sits at the head of the same
            paragraph, slightly brighter, and the bio types on after it. */}
        <div className="mt-6 sm:mt-8 max-w-2xl">
          <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-fg-faint">
            {t("about.captionLabel")}
          </p>
          <div aria-hidden className="mt-2 h-px w-full bg-border" />
          <BioTypewriter prefix={t("about.welcome")} className="mt-3" />
        </div>

        {/* Mobile CTAs. The social row that used to follow them moved up
            into the meta bar under the name. */}
        <div className="lg:hidden mt-5">
          <HeroActions locale={locale} portfolioLabel={t("about.viewPortfolio")} bookLabel={t("about.bookSession")} />
        </div>
      </section>

      {/* Best picks — the grid from Marshall's sketch. See BestPicks.tsx for
          the layout and photos.ts for what goes in it and the captions. */}
      <BestPicks
        heading={t("about.bestPicks")}
        items={pickItems}
        loadMoreLabel={t("about.loadMore")}
        fullPortfolioLabel={t("about.fullPortfolio")}
        portfolioHref={`/${locale}/portfolio`}
        onOpen={(i) => openLightbox(pickPhotos, i)}
      />

      {/* Albums */}
      <Shelf title={t("about.galleries")} className="pb-6 mt-6 sm:mt-12">
        {albums.map((a) => (
          <Link
            key={a.slug}
            href={`/${locale}/albums/${a.slug}`}
            // Spotify card anatomy: square art, then title + meta BELOW it on a
            // tinted panel — not text overlaid on the photo. Keeps the image clean.
            className="group shrink-0 snap-start w-40 sm:w-48 rounded-xl p-3 bg-foreground/4 hover:bg-foreground/9 active:bg-foreground/12 transition-colors"
          >
            <div
              className="relative w-full aspect-square rounded-lg overflow-hidden mb-3 shadow-lg"
              // A neutral shadow. It was the album's own colour — a tinted glow
              // round every cover — and photographs carry no colour but their own.
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
            <p className="text-sm font-bold text-foreground truncate">{a.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {a.year} · {a.photoCount} photos
            </p>
          </Link>
        ))}
      </Shelf>

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <Shelf title={t("about.testimonials")} className="pb-6 mt-6 sm:mt-12">
          {testimonials.map((quote, i) => (
            <figure
              key={i}
              className="shrink-0 snap-start w-72 sm:w-80 rounded-xl p-5 bg-foreground/4 flex flex-col justify-between"
            >
              <blockquote className="text-sm text-foreground/85 leading-relaxed">
                &ldquo;{quote.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-4 pt-3 border-t border-border">
                <p className="text-sm font-bold text-foreground">{quote.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{quote.context}</p>
              </figcaption>
            </figure>
          ))}
        </Shelf>
      )}

      {/* Open to */}
      <div className="lg:hidden">
        <Shelf title={t("about.openTo")} className="pb-6 mt-6">
          {OPEN_TO.map((o, i) => <OpenToCard key={i} item={o} photo={pick(o.path)} locale={locale} fromLabel={t("about.from")} detailsLabel={t("about.viewDetails")} />)}
        </Shelf>
        <p className="px-4 -mt-2 mb-6 text-xs leading-relaxed text-muted-foreground">
          {t("about.alsoOnRequest")}{" "}
          <a href={ON_REQUEST_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-accent-warm underline underline-offset-2 hover:text-(--sc-accent-hover)">
            {t("about.alsoOnRequestCta")}
          </a>
        </p>
      </div>
      <section className="hidden lg:block relative z-10 pb-10 mt-12 mb-12">
        <h2 className="text-3xl font-extrabold tracking-tight px-8 mb-5">{t("about.openTo")}</h2>
        <div className="grid grid-cols-4 gap-4 px-8">
          {OPEN_TO.map((o, i) => <OpenToCard key={i} item={o} photo={pick(o.path)} locale={locale} fromLabel={t("about.from")} detailsLabel={t("about.viewDetails")} />)}
        </div>
        <p className="px-8 mt-5 text-sm leading-relaxed text-muted-foreground">
          {t("about.alsoOnRequest")}{" "}
          <a href={ON_REQUEST_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-accent-warm underline underline-offset-2 hover:text-(--sc-accent-hover)">
            {t("about.alsoOnRequestCta")}
          </a>
        </p>
      </section>


      {/* CTA banner */}
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

        {/* On the photograph's black scrim, so white in both themes. */}
        <div className="relative z-10 flex h-full min-h-104 sm:min-h-120 flex-col justify-center px-6 sm:px-10 lg:px-16 py-10 text-white">
          <h2 className="text-4xl font-bold leading-[1.08] tracking-tight max-w-68">
            {t("about.ctaTitle")}
          </h2>

          <p className="mt-3 max-w-68 text-sm font-semibold text-white/90">
            {t("about.ctaSub")}
          </p>

          <p className="mt-4 max-w-60 text-[11px] leading-[1.65] text-white/80">
            {t("about.ctaBody")}
          </p>

          <Link
            href={`/${locale}/book`}
            className="mt-6 self-start rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold text-primary-foreground transition hover:bg-primary-hover"
          >
            {t("about.ctaButton")} →
          </Link>
        </div>
      </section>


      {/* My works — full bleed */}
      <section className="relative z-10 pb-32">
        <div className="px-4 sm:px-8 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t("about.myWorks")}</h2>
          <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible pb-1">
            {WORKS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setWorksFilter(f)}
                className={`rounded-full px-4 py-2.5 text-xs font-semibold transition active:scale-95
                  ${worksFilter === f ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-foreground/75 hover:bg-foreground/15 hover:text-foreground"}`}
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

        <p className="text-center text-xs text-muted-foreground mt-6">
          {t("about.viewMorePrefix")}{" "}
          <Link href={`/${locale}/portfolio`} className="text-accent-warm font-medium hover:underline">
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
 * below the bio on mobile — so only one is in the DOM at a given width.
 *
 * Portfolio still comes FIRST — photographs first, booking second — but Book
 * is the one in pomegranate. The palette spends its red on actions, and of
 * these two only booking is an action; two red buttons side by side would
 * spend it twice. Portfolio is the outline.
 */

const heroActionClasses =
  "flex-1 lg:flex-none h-8 lg:h-11 px-5 lg:px-6 rounded-md " +
  "font-mono text-[9.5px] lg:text-xs font-medium uppercase tracking-[0.14em] " +
  "active:scale-[0.98]";


function HeroActions({ locale, portfolioLabel, bookLabel }: { locale: string; portfolioLabel: string; bookLabel: string }) {
  return (
    <div className="flex items-center gap-3 w-full lg:w-auto">
      <Button
        asChild
        variant="outline"
        className={`${heroActionClasses} bg-transparent border-foreground/25 text-foreground hover:bg-foreground/8 dark:bg-transparent dark:border-foreground/25 dark:hover:bg-foreground/8`}
      >
        <Link href={`/${locale}/portfolio`}>{portfolioLabel}</Link>
      </Button>

      <Button asChild className={`${heroActionClasses} hover:bg-primary-hover`}>
        <Link href={`/${locale}/book`}>{bookLabel}</Link>
      </Button>
    </div>
  );
}

/**
 * Gradients for the two links that are somebody else's brand — one per theme.
 *
 * Real Instagram and Telegram hues, each stop moved in lightness only until it
 * clears 4.6:1 on the meta bar: lifted for the dark ground, deepened for
 * cream. The dark set is the old one with two stops lifted a step further for
 * the new wine-black ground (#EE467F and #C551D6 had dropped to 4.5 and 4.3);
 * the light set is new — the dark one on cream starts with a yellow at 1.3:1.
 * .sc-brand-text in globals.css picks the set by theme. The angle is a few
 * degrees off horizontal so the sweep tilts the way Instagram's own mark does.
 *
 * Keyed by label, so a social link with no brand here keeps the
 * muted-to-foreground treatment and nothing has to be passed in.
 */
const BRAND: Record<string, { dark: string; light: string; inkDark: string; inkLight: string }> = {
  Instagram: {
    dark: "linear-gradient(100deg,#FEDA75 0%,#F98033 27%,#F24A82 55%,#CD59DE 78%,#9490FF 100%)",
    light: "linear-gradient(100deg,#826000 0%,#B23F00 27%,#C5125E 55%,#A42DB5 78%,#6057C0 100%)",
    inkDark: "#F24A82",
    inkLight: "#C5125E",
  },
  Telegram: {
    dark: "linear-gradient(100deg,#6FD5FF 0%,#37BBFE 35%,#2AABEE 65%,#2196D6 100%)",
    light: "linear-gradient(100deg,#006D93 0%,#0069A7 35%,#0062A0 65%,#005C99 100%)",
    inkDark: "#2AABEE",
    inkLight: "#0069A8",
  },
};

function SocialLink({ label, href }: { label: string; href: string }) {
  const brand = BRAND[label];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "font-mono text-[11px] lg:text-xs uppercase tracking-[0.14em] whitespace-nowrap " +
        (brand
          ? "sc-brand-text"
          : "text-fg-muted hover:text-foreground transition-colors")
      }
      style={
        brand
          ? ({
              "--sc-brand-gradient-dark": brand.dark,
              "--sc-brand-gradient-light": brand.light,
              // Not decoration: the ink is what shows if background-clip:text
              // is unavailable, and what ::selection and any underline use.
              // Set as variables, not `color`, so the stylesheet can choose.
              "--sc-brand-ink-dark": brand.inkDark,
              "--sc-brand-ink-light": brand.inkLight,
            } as CSSProperties)
          : undefined
      }
    >
      {label}
    </a>
  );
}

function OpenToCard({ item, photo, locale, fromLabel, detailsLabel }: { item: (typeof OPEN_TO)[number]; photo: AlbumPhoto; locale: string; fromLabel: string; detailsLabel: string }) {
  // entryPackage(), not packages[0]: `packages` is optional (a service with
  // grouped packages has none) and the first entry isn't necessarily the
  // cheapest.
  const entry = (() => {
    const service = getServiceBySlug(item.slug);
    return service ? entryPackage(service) : undefined;
  })();
  const fromPrice = entry ? formatSom(entry.priceUzs, locale as Locale) : null;
  return (
    <Link
      href={`/${locale}/services/${item.slug}`}
      className="group shrink-0 snap-start lg:shrink w-56 lg:w-auto bg-foreground/4 hover:bg-foreground/9 active:bg-foreground/12 rounded-xl overflow-hidden flex flex-col transition-colors"
    >
      {/* Black under the photograph in both themes: the image sits at 80% and
          lifts to 100% on hover, which should dim it, not fade it to cream. */}
      <div className="relative h-36 lg:h-54 bg-black">
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
          <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
            {fromLabel} {fromPrice}
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        <p className="text-xl font-semibold">{item.title}</p>
        <p className="text-[11px] text-muted-foreground leading-snug flex-1">{item.sub}</p>
        <span className="mt-2 w-full bg-foreground/10 group-hover:bg-foreground/20 transition text-foreground text-sm font-semibold py-2 rounded-xl text-center">
          {detailsLabel} →
        </span>
      </div>
    </Link>
  );
}