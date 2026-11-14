"use client";

// The journal spread on /portfolio. journal.ts picks the photographs, the words
// are under `journal.*` in the dictionaries, and the colours and the page grid
// are the `.jr` rules in globals.css.
//
// It should read as a printed page lying on the site, not as part of it: an
// off-white text page and a black picture page in both themes, set in
// Cormorant Garamond and Jost (journal-fonts.ts) instead of the site's type.
// From 1024px the two pages sit side by side. Below that the headline comes
// first, then the pictures on black, then the text.

import Link from "next/link";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { JournalData, JournalPlate } from "@/src/app/[locale]/portfolio/journal";
import { journalDisplay, journalText } from "./journal-fonts";

const FACE = "absolute inset-0 h-full w-full object-cover object-[center_30%]";

export default function JournalSpread({ journal }: { journal: JournalData }) {
  const { t, locale } = useT();
  const [hero, ...pair] = journal.plates;
  const lead = hero.album;
  // Page numbers, as if the spread were pages 12 and 13 of the issue.
  const folio = 12 + (journal.issue - 1) * 2;

  const name = (p: JournalPlate) => p.album?.title ?? p.category;
  const names = journal.plates.map(name).filter(Boolean).join(", ");

  const facts = [
    lead && [t("journal.factAlbum"), lead.title],
    lead && [t("journal.factFrames"), String(lead.photoCount)],
    lead && [t("journal.factYear"), lead.year],
    [t("journal.factCity"), t("journal.city")],
  ].filter((f): f is string[] => Array.isArray(f) && Boolean(f[1]));

  const pairSpan = pair.length === 1 ? "col-span-2 lg:col-span-1 lg:row-span-2" : "";

  return (
    <section aria-labelledby="journal-title" className="relative z-10 px-4 pb-12 sm:px-8">
      <article
        className={`jr ${journalDisplay.variable} ${journalText.variable} mx-auto max-w-[1400px] overflow-hidden
          shadow-[0_1px_2px_rgb(0_0_0/0.08),0_30px_60px_-30px_rgb(0_0_0/0.45)]`}
      >
        {/* The text page, top half: masthead and headline. */}
        <header className="jr-head min-w-0 px-6 pb-10 pt-6 sm:px-10 sm:pt-9 lg:pb-0 xl:px-16 xl:pt-12">
          <div className="flex items-baseline justify-between gap-6">
            <span className="jr-display text-[19px] font-medium leading-none">{t("journal.masthead")}</span>
            <span className="text-[12px] text-[var(--jr-ink-2)]">
              {t("journal.issue", { n: journal.issue })}
            </span>
          </div>

          <p className="jr-display mt-14 text-[22px] italic leading-none text-[var(--jr-ink-2)] sm:mt-20 xl:mt-24">
            {t("journal.eyebrow")}
          </p>
          <h2
            id="journal-title"
            className="jr-display mt-4 text-balance text-[54px] font-light leading-[0.9] tracking-[-0.015em] sm:text-[84px] xl:text-[104px]"
          >
            {t("journal.title")}
          </h2>
          <p className="mt-7 max-w-[30rem] text-pretty text-[17px] font-light leading-[1.55] text-[var(--jr-ink-2)]">
            {t("journal.dek")}
          </p>
        </header>

        {/* The picture page. On a phone it is a black band between the
            headline and the text; from 1024px it is the whole right page and
            grows to the height of the text page. */}
        <div className="jr-photos flex min-w-0 flex-col p-3 sm:p-6 lg:p-10 xl:p-14">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:min-h-[460px] lg:flex-1 lg:grid-cols-[2fr_1fr] lg:grid-rows-2">
            <figure className={`relative col-span-2 min-h-0 lg:row-span-2 ${pair.length ? "lg:col-span-1" : ""}`}>
              <PhotoFrame
                ladder={hero.photo.ladder}
                src={hero.photo.src}
                thumbhash={hero.photo.thumbhash}
                alt={hero.photo.alt || name(hero)}
                sizes="(min-width: 1400px) 460px, (min-width: 1024px) 32vw, 100vw"
                className="aspect-[4/5] w-full lg:aspect-auto lg:h-full"
                imgClassName={FACE}
              />
            </figure>
            {pair.map((p, i) => (
              <figure key={i} className={`relative min-h-0 ${pairSpan}`}>
                <PhotoFrame
                  ladder={p.photo.ladder}
                  src={p.photo.src}
                  thumbhash={p.photo.thumbhash}
                  alt={p.photo.alt || name(p)}
                  sizes="(min-width: 1400px) 230px, (min-width: 1024px) 16vw, 50vw"
                  className="aspect-[3/4] w-full lg:aspect-auto lg:h-full"
                  imgClassName={FACE}
                />
              </figure>
            ))}
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-6 px-1 text-[12px] leading-snug text-[var(--jr-on-black-2)] sm:mt-4 lg:mt-5 lg:px-0">
            <p>
              <span className="lg:hidden">{t("journal.creditsNarrow", { names })}</span>
              <span className="hidden lg:inline">{t("journal.creditsWide", { names })}</span>
            </p>
            <span aria-hidden className="hidden tabular-nums lg:block">{folio + 1}</span>
          </div>
        </div>

        {/* The text page, bottom half: the essay and the facts. */}
        <div className="jr-body flex min-w-0 flex-col px-6 pb-8 pt-10 sm:px-10 sm:pb-9 lg:pt-12 xl:px-16 xl:pb-12">
          <div className="max-w-[40rem] gap-10 text-[14.5px] leading-[1.7] md:columns-2 lg:columns-1 xl:columns-2 [&>p+p]:indent-[1.5em]">
            <p>{t("journal.p1")}</p>
            <p>{t("journal.p2")}</p>
            <p>{t("journal.p3")}</p>
          </div>

          <blockquote className="jr-display mt-12 max-w-[32rem] text-pretty text-[30px] italic leading-[1.12] sm:text-[36px] xl:pl-16">
            {t("journal.quote")}
          </blockquote>

          <dl className="mt-12 grid max-w-[40rem] grid-cols-2 gap-x-6 gap-y-5 border-t border-[var(--jr-rule)] pt-4 sm:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[12px] text-[var(--jr-ink-2)]">{k}</dt>
                <dd className="mt-1 break-words text-[14px] font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          {lead && (
            <Link
              href={`/${locale}/albums/${lead.slug}`}
              className="mt-9 inline-flex h-11 items-center self-start bg-[var(--jr-ink)] px-6 text-[14px] font-medium text-[var(--jr-paper)]
                transition-colors hover:bg-[#3a3a38] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--jr-ink)]"
            >
              {t("journal.openAlbum")}
            </Link>
          )}

          <span aria-hidden className="mt-auto hidden pt-12 text-[12px] tabular-nums text-[var(--jr-ink-2)] lg:block">
            {folio}
          </span>
        </div>
      </article>
    </section>
  );
}
