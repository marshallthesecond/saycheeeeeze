"use client";

// The journal spread on /portfolio — see src/app/[locale]/portfolio/journal.ts
// for what it is and how to change its photographs.
//
// From 1024px it is an open magazine: two pages on one sheet, a soft fold down
// the middle, running heads and folios. Below that it reads top to bottom as
// one page: headline, the large photograph, the essay, the two smaller
// photographs, the facts.

import Link from "next/link";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { JournalData, JournalPlate } from "@/src/app/[locale]/portfolio/journal";

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const FACE = "absolute inset-0 h-full w-full object-cover object-[center_30%]";

function RunningHead({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
      <span className="whitespace-nowrap">{left}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="whitespace-nowrap">{right}</span>
    </div>
  );
}

function Folio({ n, align }: { n: number; align: "left" | "right" }) {
  return (
    <p
      aria-hidden
      className={`mt-auto pt-6 font-mono text-[10px] tracking-[0.22em] text-muted-foreground ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {align === "left" ? `— ${n}` : `${n} —`}
    </p>
  );
}

export default function JournalSpread({ journal }: { journal: JournalData }) {
  const { t, locale } = useT();
  const [hero, ...pair] = journal.plates;
  const issue = t("journal.issue", { n: String(journal.issue).padStart(2, "0") });
  const lead = hero.album;

  const plateLabel = (i: number) => `${t("journal.plate")} ${ROMAN.at(i) ?? i + 1}`;
  const plateTitle = (p: JournalPlate) => p.album?.title ?? p.category;
  const plateMeta = (p: JournalPlate) => [p.category, p.album?.year].filter(Boolean).join(" · ");
  const alt = (p: JournalPlate, i: number) => p.photo.alt || `${plateTitle(p)} — ${plateLabel(i)}`;

  const facts: [string, string][] = [
    ...(lead
      ? ([
          [t("journal.factAlbum"), lead.title],
          [t("journal.factFrames"), String(lead.photoCount)],
          [t("journal.factYear"), lead.year],
        ] as [string, string][])
      : []),
    [t("journal.factCity"), t("journal.city")],
  ].filter(([, v]) => v) as [string, string][];

  // `frame` sizes the photograph: a fixed shape on a phone, the full height of
  // the photo block on the right-hand page.
  const heroFigure = (frame: string, fig = "") => (
    <figure className={`relative ${fig}`}>
      <PhotoFrame
        ladder={hero.photo.ladder}
        src={hero.photo.src}
        thumbhash={hero.photo.thumbhash}
        alt={alt(hero, 0)}
        sizes="(min-width: 1400px) 440px, (min-width: 1024px) 30vw, 100vw"
        className={frame}
        imgClassName={FACE}
      />
      {/* The caption box, set over the photograph the way a magazine does. */}
      <figcaption className="absolute bottom-3 left-3 max-w-[80%] bg-black/55 px-3.5 py-3 text-white backdrop-blur-md">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.22em] text-white/75">{plateLabel(0)}</span>
        <span className="mt-1 block font-serif text-2xl leading-none">{plateTitle(hero)}</span>
        {plateMeta(hero) && <span className="mt-1.5 block text-[11px] text-white/80">{plateMeta(hero)}</span>}
      </figcaption>
    </figure>
  );

  const smallFigure = (p: JournalPlate, i: number, frame: string, fig = "") => (
    <figure key={i} className={`relative min-h-0 ${fig}`}>
      <PhotoFrame
        ladder={p.photo.ladder}
        src={p.photo.src}
        thumbhash={p.photo.thumbhash}
        alt={alt(p, i)}
        sizes="(min-width: 1400px) 210px, (min-width: 1024px) 15vw, 50vw"
        className={frame}
        imgClassName={FACE}
      />
      <span className="absolute left-2 top-2 bg-black/55 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.18em] text-white backdrop-blur-md">
        {ROMAN.at(i) ?? i + 1}
      </span>
    </figure>
  );

  return (
    <section aria-labelledby="journal-title" className="relative z-10 px-4 pb-12 sm:px-8">
      <article className="relative mx-auto grid max-w-[1400px] overflow-hidden rounded-[3px] bg-card ring-1 ring-border shadow-[0_2px_4px_rgb(0_0_0/0.06),0_40px_80px_-40px_rgb(0_0_0/0.5)] lg:grid-cols-2">
        {/* The fold. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-24 -translate-x-1/2 lg:block"
          style={{
            background:
              "linear-gradient(to right, transparent, rgb(0 0 0 / 0.05) 44%, rgb(0 0 0 / 0.14) 50%, rgb(0 0 0 / 0.05) 56%, transparent)",
          }}
        />

        {/* ——— Left page: the words ——— */}
        <div className="flex min-w-0 flex-col gap-7 p-6 sm:p-10 xl:p-14">
          <RunningHead left="saycheeeeeze" right={`${t("journal.runningHead")} · ${issue}`} />

          <header>
            <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <span aria-hidden className="h-1 w-8 shrink-0 bg-primary" />
              {t("journal.eyebrow")}
            </p>
            <h2
              id="journal-title"
              className="mt-5 font-serif text-[44px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-6xl xl:text-7xl"
            >
              {t("journal.title")}
            </h2>
            <p className="mt-5 max-w-lg font-serif text-xl italic leading-snug text-muted-foreground sm:text-[22px]">
              {t("journal.dek")}
            </p>
          </header>

          {/* Phone and tablet: the large photograph comes straight after the headline. */}
          <div className="lg:hidden">{heroFigure("aspect-[4/5] w-full")}</div>

          <div className="gap-8 text-[14px] leading-relaxed text-foreground/85 md:columns-2 lg:columns-1 xl:columns-2 [&>p+p]:mt-3">
            <p className="first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-serif first-letter:text-[64px] first-letter:leading-[0.75] first-letter:text-accent-warm">
              {t("journal.p1")}
            </p>
            <p>{t("journal.p2")}</p>
            <p>{t("journal.p3")}</p>
          </div>

          <blockquote className="border-l-2 border-primary pl-5 font-serif text-[26px] italic leading-tight text-foreground sm:text-3xl">
            “{t("journal.quote")}”
          </blockquote>

          {/* Phone and tablet: the two smaller photographs. */}
          {pair.length > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:hidden">
              {pair.map((p, i) => smallFigure(p, i + 1, "aspect-[3/4] w-full"))}
            </div>
          )}

          <dl className="grid gap-x-10 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 border-b border-dashed border-border py-2">
                <span aria-hidden className="size-1.5 shrink-0 translate-y-[-1px] bg-foreground/70" />
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt>
                <dd className="ml-auto truncate text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {lead && (
            <Link
              href={`/${locale}/albums/${lead.slug}`}
              className="group inline-flex h-11 items-center gap-2 self-start rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover"
            >
              {t("journal.openAlbum")}
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          )}

          <Folio n={12 + (journal.issue - 1) * 2} align="left" />
        </div>

        {/* ——— Right page: the photographs (from 1024px) ——— */}
        <div className="relative hidden min-w-0 flex-col gap-6 p-10 lg:flex xl:p-14 xl:pr-16">
          <RunningHead left={t("journal.eyebrow")} right={t("journal.city")} />

          {/* Grows to the height of the left-hand page, so the two pages end
              together instead of leaving a blank lower half on this one. */}
          <div className="grid min-h-[440px] flex-1 grid-cols-[2fr_1fr] gap-4">
            {heroFigure("h-full w-full", "h-full")}
            <div className="grid grid-rows-2 gap-4">
              {pair.map((p, i) => smallFigure(p, i + 1, "h-full w-full", "h-full"))}
            </div>
          </div>

          {/* The plate list, as a magazine credits its pictures. */}
          <ol className="grid gap-1.5 text-[12.5px]">
            {journal.plates.map((p, i) => (
              <li key={i} className="flex items-baseline gap-3">
                <span className="w-8 shrink-0 font-mono text-[10.5px] tracking-[0.18em] text-muted-foreground">
                  {ROMAN.at(i) ?? i + 1}
                </span>
                <span className="font-semibold">{plateTitle(p)}</span>
                <span className="truncate text-muted-foreground">{plateMeta(p)}</span>
              </li>
            ))}
          </ol>

          <Folio n={13 + (journal.issue - 1) * 2} align="right" />

          {/* Down the outer edge. */}
          <span
            aria-hidden
            className="absolute right-4 top-1/2 hidden -translate-y-1/2 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.32em] text-muted-foreground xl:block"
            style={{ writingMode: "vertical-rl" }}
          >
            {t("journal.runningHead")} · {issue} · {t("journal.city")}
          </span>
        </div>
      </article>
    </section>
  );
}
