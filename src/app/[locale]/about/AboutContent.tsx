"use client";

// The About page (rebuilt 2026-11-10, trimmed 2026-11-13, filled 2026-11-22)
// — three columns:
//
//   left    the portfolio, condensed (PortfolioPanel), with the gallery doors
//           that were on the Portfolio page (removed 2026-11-22)
//   middle  the photographer, from the portrait to Book (ProfilePanel), then
//           what was Home's middle column: Best picks, one album to look
//           through (a different one each visit), the Portraits session
//           pitched; then "My story" once it is written
//   right   booking (session types, Book, Telegram), then the Galleries stack
//           that was Home's left column
//
// Below 1280px one column: the photographer, Best picks, the Galleries stack,
// the album, the pitch, booking, the portfolio. The stack is in the page
// twice for that, one copy hidden at each width.
//
// The page is black (2026-11-22): data-page="about" sets --background for the
// whole document in globals.css, so the header, the nav's fade and the
// overscroll are black too. The cards keep their colour.
//
// A section appears only when it has something true to say. "My story" stays
// hidden until aboutPage.story is written in the dictionaries; client quotes
// stay hidden until testimonials.ts holds real ones.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Lightbox from "@/src/components/common/Lightbox";
import StickyHeader from "@/src/components/common/StickyHeader";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import type { Door } from "@/src/components/common/GalleryDoors";
import GalleryStack from "@/src/components/home/GalleryStack";
import AlbumShelf, { type ShelfAlbum } from "@/src/components/home/AlbumShelf";
import PortraitsPitch, { type PortraitsPitchData } from "@/src/components/home/PortraitsPitch";
import PortfolioPanel from "@/src/components/profile/PortfolioPanel";
import ProfilePanel from "@/src/components/profile/ProfilePanel";
import { CARD, CARD_TITLE, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { PROFILE } from "@/src/lib/profile";
import { testimonials } from "@/src/lib/testimonials";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { SessionSummary } from "@/src/lib/session-summaries";
import type { WorkPreview } from "@/src/lib/work-preview";
import BestPicks, { type PickItem } from "./BestPicks";
import { FALLBACK_RATIO, PICKS_WANTED, formatPickDate, type ChosenPick, type ExtraPick } from "./best-picks";
import type { WorksCategory } from "./photos";

const STICKY =
  "xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-x-hidden xl:overflow-y-auto";

const SECTION_TITLE = "text-xl font-bold tracking-tight";

/**
 * The middle column is the viewport minus two 300px columns, three 16px gaps
 * and the page padding — so the feature tile is half of that, not half the
 * screen. Below 1280px it is the full width again.
 */
const MIDDLE = "calc(100vw - 664px)";
const FEATURE_SIZES = `(min-width: 1280px) calc(${MIDDLE} / 2), (min-width: 640px) 50vw, 100vw`;
const PHONE_TILE_SIZES = "34vw";
const DESKTOP_TILE_SIZES = `(min-width: 1280px) calc(${MIDDLE} / 6), 17vw`;

export default function AboutContent({
  work,
  albums,
  galleries,
  photosCount,
  sessions,
  chosenPicks,
  extraPicks,
  shelf,
  pitch,
}: {
  work: WorkPreview;
  albums: AlbumData[];
  galleries: GalleryListing[];
  /** How many photographs the portfolio holds, for the details list. */
  photosCount: number;
  sessions: SessionSummary[];
  /** The chosen Best picks, in order, captioned. */
  chosenPicks: ChosenPick[];
  extraPicks: ExtraPick[];
  shelf: ShelfAlbum[];
  pitch: PortraitsPitchData | null;
}) {
  const { t, locale } = useT();
  const [door, setDoor] = useState<Door | null>(null);
  const closeSheet = useCallback(() => setDoor(null), []);

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
    const chosen: PickItem[] = chosenPicks.map((p, index) => {
      const photo = p.photo;
      const category = p.cat ? pickLabel(p.cat) : p.category ?? "";
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
  }, [chosenPicks, extraPicks, pickLabel, locale, t]);
  const pickPhotos = useMemo(() => pickItems.map((it) => ({ ...it.photo, alt: it.alt })), [pickItems]);

  const story = t("aboutPage.story").trim();
  const hasStory = story.length > 0 && story !== "aboutPage.story";

  const openPrivate = () => setDoor("private");

  return (
    <div data-page="about" className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" backHref={`/${locale}`} />

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-8 px-4 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px] xl:gap-4"
        style={{ paddingTop: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        {/* Left — the work. */}
        <aside className={`order-3 flex flex-col gap-4 xl:order-none ${STICKY}`}>
          <PortfolioPanel
            work={work}
            albums={albums}
            galleries={galleries}
            onDoor={setDoor}
            onOpen={(photos, index) => setLightbox({ photos, index })}
          />
        </aside>

        {/* Middle — who, then the work. */}
        <main className="order-1 flex min-w-0 flex-col gap-8 xl:order-none sm:gap-10">
          <ProfilePanel albumsCount={albums.length} photosCount={photosCount} />

          <section aria-labelledby="picks-h" className="flex flex-col gap-3">
            <h2 id="picks-h" className="text-xl font-bold tracking-tight sm:text-2xl">
              {t("about.bestPicks")}
            </h2>
            <BestPicks
              items={pickItems}
              fullPortfolioLabel={t("about.fullPortfolio")}
              portfolioHref="#portfolio"
              onOpen={(i) => setLightbox({ photos: pickPhotos, index: i })}
              featureSizes={FEATURE_SIZES}
              phoneTileSizes={PHONE_TILE_SIZES}
              desktopTileSizes={DESKTOP_TILE_SIZES}
              className="-mx-4 sm:mx-0"
            />
          </section>

          {/* The Galleries stack, here on a phone (on a computer it is under
              booking). Edge to edge, so the shelves run off the screen. */}
          <GalleryStack albums={albums} onPrivate={openPrivate} headingId="stack-h-phone" className="-mx-4 xl:hidden" />

          {shelf.length > 0 && (
            <AlbumShelf albums={shelf} onOpen={(photos, index) => setLightbox({ photos, index })} />
          )}

          {pitch && <PortraitsPitch pitch={pitch} />}

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

        {/* Right — booking, then the galleries. */}
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

          <div className="mt-2 hidden xl:block">
            <GalleryStack albums={albums} onPrivate={openPrivate} />
          </div>

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

      <GalleryPickerSheet
        open={door !== null}
        onClose={closeSheet}
        mode={door ?? "albums"}
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
