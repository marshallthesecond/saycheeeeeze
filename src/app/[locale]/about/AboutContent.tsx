"use client";

// The About page (rebuilt 2026-11-10) — three columns like Home:
//
//   left    "On this page" + the portfolio, condensed (PortfolioPanel)
//   middle  the profile card, then the sections that have real content
//   right   booking: the next free days, session types, Book, Telegram
//
// A section appears only when it has something true to say. "My story" stays
// hidden until aboutPage.story is written in the dictionaries; client quotes
// stay hidden until testimonials.ts holds real ones. The "On this page" list
// is built from whatever is actually on the page, so it never links to a
// section that isn't there.
//
// Below 1280px it is one column: profile, sections, booking, portfolio.

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import ProfilePhotos from "@/src/components/common/ProfilePhotos";
import BioTypewriter from "@/src/components/common/BioTypewriter";
import SocialLinks from "@/src/components/common/SocialLinks";
import FreeDays from "@/src/components/profile/FreeDays";
import PortfolioPanel from "@/src/components/profile/PortfolioPanel";
import { CARD, CARD_TITLE, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { pfps } from "@/src/lib/pfps";
import { PROFILE } from "@/src/lib/profile";
import { testimonials } from "@/src/lib/testimonials";
import { bunnyUrl } from "@/src/lib/bunny-url";
import { fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import type { AlbumPhoto } from "@/src/lib/albums";
import type { SessionSummary } from "@/src/lib/session-summaries";
import type { WorkPhoto, WorkPreview } from "@/src/lib/work-preview";
import { ABOUT_COVER } from "./photos";

const STICKY =
  "xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-y-auto [scrollbar-width:thin]";

const SECTION_TITLE = "text-xl font-bold tracking-tight";

export default function AboutContent({
  photoIndex,
  work,
  albumsCount,
  sessions,
  freeDays,
  places,
}: {
  /** storage path → photo: the cover. */
  photoIndex: Record<string, AlbumPhoto>;
  work: WorkPreview;
  albumsCount: number;
  sessions: SessionSummary[];
  freeDays: string[];
  /** Location ids from the booking form, in its order. */
  places: string[];
}) {
  const { t, locale } = useT();

  const [lightbox, setLightbox] = useState<{ photos: WorkPhoto[]; index: number } | null>(null);
  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (by: number) =>
      setLightbox((lb) => (lb ? { ...lb, index: (lb.index + by + lb.photos.length) % lb.photos.length } : lb)),
    [],
  );

  const story = t("aboutPage.story").trim();
  const hasStory = story.length > 0 && story !== "aboutPage.story";

  // What is on the page, in page order — the source for "On this page".
  const sections = useMemo(
    () =>
      [
        hasStory && { id: "story", label: t("aboutPage.storyTitle") },
        { id: "how", label: t("aboutPage.howShort") },
        places.length > 0 && { id: "places", label: t("aboutPage.placesShort") },
        testimonials.length > 0 && { id: "words", label: t("about.testimonials") },
      ].filter(Boolean) as { id: string; label: string }[],
    [hasStory, places.length, t],
  );
  const active = useActiveSection(sections.map((s) => s.id));

  const cover = photoIndex[ABOUT_COVER] ?? { src: bunnyUrl(ABOUT_COVER) };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" backHref={`/${locale}`} />

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-4 px-4 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px]"
        style={{ paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        {/* Left — where to go on this page, and the work. */}
        <aside className={`order-3 flex flex-col gap-4 xl:order-none ${STICKY}`}>
          {sections.length > 1 && (
            <nav aria-label={t("aboutPage.onThisPage")} className={`${CARD} flex flex-col gap-2 max-xl:hidden`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("aboutPage.onThisPage")}
              </p>
              <ul className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={active === s.id ? "location" : undefined}
                      className={`block truncate rounded-md px-2.5 py-1.5 text-[12.5px] transition ${
                        active === s.id
                          ? "bg-background font-semibold text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <PortfolioPanel
            work={work}
            albumsCount={albumsCount}
            onOpen={(photos, index) => setLightbox({ photos, index })}
          />
        </aside>

        {/* Middle — who, and how it works. */}
        <main className="order-1 flex min-w-0 flex-col gap-4 xl:order-none">
          <section aria-label={t("profile.name")} className="overflow-hidden rounded-2xl bg-card">
            <div className="relative h-28 bg-foreground/6 sm:h-33">
              {hasLadder(cover.ladder) ? (
                <picture>
                  <source type="image/avif" sizes="(min-width: 1280px) 60vw, 100vw" srcSet={srcSet(cover.ladder, "avif")} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fallbackSrc(cover.ladder)}
                    srcSet={srcSet(cover.ladder, "webp")}
                    sizes="(min-width: 1280px) 60vw, 100vw"
                    alt=""
                    decoding="async"
                    fetchPriority="high"
                    className="absolute inset-0 h-full w-full object-cover object-[center_35%]"
                  />
                </picture>
              ) : (
                <Image src={cover.src} alt="" fill sizes="100vw" unoptimized priority className="object-cover object-[center_35%]" />
              )}
            </div>

            <div className="-mt-13 flex flex-col items-center px-5 pb-5 text-center sm:px-10">
              <ProfilePhotos
                images={pfps}
                interval={4000}
                alt={t("profile.portraitAlt")}
                progress={false}
                frameClassName="size-26 rounded-full border-4! border-card!"
                sizes="104px"
              />
              <h1 className="mt-3 text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[34px]">
                {t("aboutPage.greeting")}
              </h1>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("aboutPage.metaLine")}
              </p>
              <BioTypewriter size="body" className="mt-3 max-w-150 text-center" />
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <SocialLinks
                links={PROFILE.socials}
                maxPx={11.5}
                spread={false}
                label={t("profile.links")}
                className="flex-1"
              />
              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/${locale}/portfolio`}
                  className="flex h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-input px-4 text-[13px] font-semibold text-foreground transition hover:bg-foreground/6 sm:flex-none"
                >
                  {t("aboutPage.seeMyWork")}
                </Link>
                <Link
                  href={`/${locale}/book`}
                  className="flex h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition hover:bg-primary-hover sm:flex-none"
                >
                  {t("about.bookSession")}
                </Link>
              </div>
            </div>
          </section>

          {hasStory && (
            <section id="story" aria-labelledby="story-h" className={`${CARD} scroll-mt-20 sm:p-6`}>
              <h2 id="story-h" className={SECTION_TITLE}>{t("aboutPage.storyTitle")}</h2>
              <div className="mt-3 flex max-w-prose flex-col gap-3 text-sm leading-relaxed">
                {story.split(/\n\s*\n/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}

          <section id="how" aria-labelledby="how-h" className={`${CARD} scroll-mt-20 sm:p-6`}>
            <h2 id="how-h" className={SECTION_TITLE}>{t("aboutPage.howTitle")}</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="flex flex-col gap-1.5 rounded-xl bg-background p-4">
                  <span className="font-mono text-[11px] tracking-[0.14em] text-accent-warm">0{n}</span>
                  <span className="text-[15px] font-bold">{t(`aboutPage.how${n}Title`)}</span>
                  <span className="text-[13px] leading-normal text-muted-foreground">{t(`aboutPage.how${n}`)}</span>
                </li>
              ))}
            </ol>
          </section>

          {places.length > 0 && (
            <section id="places" aria-labelledby="places-h" className={`${CARD} scroll-mt-20 sm:p-6`}>
              <h2 id="places-h" className={SECTION_TITLE}>{t("aboutPage.placesTitle")}</h2>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{t("aboutPage.placesBody")}</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {places.map((id) => (
                  <li key={id} className="rounded-xl bg-background px-4 py-3">
                    <span className="block text-sm font-semibold">{t(`book.loc.${id}.label`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`book.loc.${id}.sub`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>

        {/* Right — booking. */}
        <aside className={`order-2 flex flex-col gap-4 xl:order-none ${STICKY}`}>
          <section aria-labelledby="book-h" className={`${CARD} flex flex-col gap-3.5`}>
            <h2 id="book-h" className={CARD_TITLE}>{t("about.ctaButton")}</h2>
            <FreeDays days={freeDays} variant="chips" />
            <SessionsList sessions={sessions} bare />
            <Link
              href={`/${locale}/book`}
              className="flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover active:scale-[0.99]"
            >
              {t("about.ctaButton")}
            </Link>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("about.alsoOnRequest")}{" "}
              <a
                href={PROFILE.telegram}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-accent-warm underline underline-offset-2"
              >
                {t("about.alsoOnRequestCta")}
              </a>
            </p>
          </section>

          {testimonials.length > 0 && (
            <section id="words" aria-labelledby="words-h" className={`${CARD} flex scroll-mt-20 flex-col gap-3`}>
              <h2 id="words-h" className={CARD_TITLE}>{t("about.testimonials")}</h2>
              {testimonials.map((q, i) => (
                <figure key={i} className="flex flex-col gap-2">
                  <blockquote className="text-[13.5px] leading-relaxed">&ldquo;{q.quote}&rdquo;</blockquote>
                  <figcaption className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    {q.name} · {q.context}
                  </figcaption>
                </figure>
              ))}
            </section>
          )}
        </aside>
      </div>

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

/** The section nearest the top of the viewport, for "On this page". */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join(",");

  useEffect(() => {
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        if (visible.size > 0) {
          const [first] = [...visible.entries()].sort((a, b) => a[1] - b[1]);
          setActive(first[0]);
        }
      },
      { rootMargin: "-56px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);

  return active;
}
