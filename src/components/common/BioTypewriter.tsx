"use client";

// src/components/common/BioTypewriter.tsx
//
// Drop-in replacement for the static <p>{t("about.bio")}</p> in the hero.
//
// The paragraph is a 1x1 CSS grid with three stacked children, each doing one
// job. This is what keeps a typing animation from wrecking the layout:
//
//   1. measure  — the FULL text, `invisible`. visibility:hidden still occupies
//                 layout, so the paragraph sits at its final height from the
//                 first frame and the buttons below never jump as it types.
//   2. visible  — the growing slice plus the caret. aria-hidden, because a
//                 screen reader should not narrate a paragraph letter by letter.
//   3. sr-only  — the whole bio, once, for assistive tech and crawlers.
//
// t("about.bio") is still used, as the pre-mount / no-JS / failed-chunk
// fallback. That key stays in the dictionaries and is worth keeping good: it is
// what a crawler sees in the server-rendered HTML.

import { useT } from "@/src/lib/i18n/LanguageProvider";
import { useSessionBio } from "@/src/lib/bio/useSessionBio";
import { useTypewriter } from "@/src/lib/bio/useTypewriter";

export default function BioTypewriter({ className = "" }: { className?: string }) {
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

  return (
    <p
      className={
        // min-h covers the pre-mount frame only; once a variant is known the
        // measure layer sets the exact height. Sized for the longest variant at
        // each breakpoint — trim it once your final pool is settled.
        `mt-5 sm:mt-6 grid max-w-3xl min-h-36 sm:min-h-26 lg:min-h-20 ` +
        `text-sm sm:text-[15px] leading-relaxed text-white/80 ${className}`
      }
    >
      <span aria-hidden className="col-start-1 row-start-1 invisible">
        {full}
      </span>

      <span aria-hidden className="col-start-1 row-start-1">
        {visible}
        {!done && text !== null && (
          <span className="ml-0.5 inline-block h-[1em] w-px translate-y-[0.15em] bg-white/70 align-baseline animate-pulse" />
        )}
      </span>

      <span className="sr-only">{full}</span>

      {/* Without JS the visible layer never fills, so give those visitors the
          canonical bio rather than an empty paragraph. */}
      <noscript>
        <span className="col-start-1 row-start-1">{fallback}</span>
      </noscript>
    </p>
  );
}