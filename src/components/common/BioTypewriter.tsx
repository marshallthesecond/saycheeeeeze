"use client";

//
// The typing bio in the About hero. A 1x1 grid with three stacked layers, which
// is what stops the animation moving the page:
//
//   1. measure  the full text, `invisible` — still occupies layout, so the
//               paragraph is at its final height from the first frame
//   2. visible  the growing slice and caret, aria-hidden
//   3. sr-only  the whole bio once, for assistive tech and crawlers
//
// t("about.bio") remains the pre-mount / no-JS fallback, and is what a crawler
// sees in the server-rendered HTML — worth keeping good.
//
// `prefix` (2026-11-02): static text at the head of the same paragraph — the
// About page's welcome line, which used to be a separate centred heading above
// this. It is in all three layers, so it shows in the first frame, never
// types, and the measure layer still reserves the exact final height.

import { useT } from "@/src/lib/i18n/LanguageProvider";
import { useSessionBio } from "@/src/lib/bio/useSessionBio";
import { useTypewriter } from "@/src/lib/bio/useTypewriter";

export default function BioTypewriter({
  className = "",
  prefix,
}: {
  className?: string;
  /** Shown before the bio, already complete, slightly brighter. */
  prefix?: string;
}) {
  const { t, locale } = useT();
  const { text, animate, markTyped } = useSessionBio(locale);

  const fallback = t("about.bio");
  const full = text ?? fallback;

  const { typed, done } = useTypewriter(full, {
    enabled: animate,
    cps: 65,
    onDone: markTyped,
  });

  // Before the variant chunk resolves we deliberately show nothing rather than
  // the fallback: painting the fallback and then retyping a different sentence
  // over it reads as a bug. The height is already reserved, so the gap is just
  // a beat of empty space.
  const visible = text === null ? "" : typed;

  // A trailing space inside the span, not between elements: JSX would drop
  // whitespace between two expressions on separate lines, and the welcome's
  // full stop would run straight into the bio's first word.
  const lead = prefix ? <span className="text-foreground/85">{`${prefix} `}</span> : null;

  return (
    <p
      className={
        // THE FILM-CAPTION STYLE (2026-11-02): small, italic, left-aligned,
        // and muted, with the welcome prefix a step brighter. It was 14–15px
        // upright under a separate 18–24px heading, and the pair took most of
        // a phone's first screen for what is only a bio.
        //
        // min-h covers the pre-mount frame only; once a variant is known the
        // measure layer sets the exact height. Sized for the longest welcome +
        // variant at each breakpoint (≈313 characters, Uzbek): seven lines at
        // 13px on a phone, four at 14px from 640px up.
        `grid max-w-2xl min-h-32 sm:min-h-20 lg:min-h-16 ` +
        `text-[13px] sm:text-sm leading-[1.6] italic text-muted-foreground ${className}`
      }
    >
      <span aria-hidden className="col-start-1 row-start-1 invisible">
        {lead}
        {full}
      </span>

      <span aria-hidden className="col-start-1 row-start-1">
        {lead}
        {visible}
        {!done && text !== null && (
          <span className="ml-0.5 inline-block h-[1em] w-px translate-y-[0.15em] bg-foreground/70 align-baseline animate-pulse" />
        )}
      </span>

      <span className="sr-only">{prefix ? `${prefix} ${full}` : full}</span>

      {/* Without JS the visible layer never fills, so give those visitors the
          canonical bio rather than an empty paragraph. */}
      <noscript>
        <span className="col-start-1 row-start-1">
          {lead}
          {fallback}
        </span>
      </noscript>
    </p>
  );
}