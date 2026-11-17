"use client";

// The About page (rebuilt 2026-11-10, trimmed 2026-11-13) — three columns:
//
//   left    the portfolio, condensed (PortfolioPanel)
//   middle  the photographer, from the portrait to Book (ProfilePanel, moved
//           here from Home on 2026-11-17 in place of the card with a cover
//           photo), then "My story" once it is written
//   right   booking: session types, Book, Telegram
//
// A section appears only when it has something true to say. "My story" stays
// hidden until aboutPage.story is written in the dictionaries; client quotes
// stay hidden until testimonials.ts holds real ones.
//
// "On this page", "How a session works", "Where I shoot" and the next free
// days were removed on 2026-11-13 at Marshall's request.
//
// Below 1280px it is one column: profile, booking, portfolio.

import { useCallback, useState } from "react";
import Link from "next/link";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import PortfolioPanel from "@/src/components/profile/PortfolioPanel";
import ProfilePanel from "@/src/components/profile/ProfilePanel";
import { CARD, CARD_TITLE, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { PROFILE } from "@/src/lib/profile";
import { testimonials } from "@/src/lib/testimonials";
import type { SessionSummary } from "@/src/lib/session-summaries";
import type { WorkPhoto, WorkPreview } from "@/src/lib/work-preview";

const STICKY =
  "xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-y-auto [scrollbar-width:thin]";

const SECTION_TITLE = "text-xl font-bold tracking-tight";

export default function AboutContent({
  work,
  albumsCount,
  photosCount,
  sessions,
}: {
  work: WorkPreview;
  albumsCount: number;
  /** How many photographs the portfolio holds, for the details list. */
  photosCount: number;
  sessions: SessionSummary[];
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

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" backHref={`/${locale}`} />

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-4 px-4 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px]"
        style={{ paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        {/* Left — the work. */}
        <aside className={`order-3 flex flex-col gap-4 xl:order-none ${STICKY}`}>
          <PortfolioPanel
            work={work}
            albumsCount={albumsCount}
            onOpen={(photos, index) => setLightbox({ photos, index })}
          />
        </aside>

        {/* Middle — who. */}
        <main className="order-1 flex min-w-0 flex-col gap-4 xl:order-none">
          <ProfilePanel albumsCount={albumsCount} photosCount={photosCount} />

          {hasStory && (
            <section aria-labelledby="story-h" className={`${CARD} sm:p-6`}>
              <h2 id="story-h" className={SECTION_TITLE}>{t("aboutPage.storyTitle")}</h2>
              <div className="mt-3 flex max-w-prose flex-col gap-3 text-sm leading-relaxed">
                {story.split(/\n\s*\n/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}

        </main>

        {/* Right — booking. */}
        <aside className={`order-2 flex flex-col gap-4 xl:order-none ${STICKY}`}>
          <section aria-labelledby="book-h" className={`${CARD} flex flex-col gap-3.5`}>
            <h2 id="book-h" className={CARD_TITLE}>{t("about.ctaButton")}</h2>
            <SessionsList sessions={sessions} bare />
            <Link
              href={`/${locale}/book`}
              className="btn-glass-primary flex h-11 items-center justify-center text-sm font-semibold"
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
            <section aria-labelledby="words-h" className={`${CARD} flex flex-col gap-3`}>
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
