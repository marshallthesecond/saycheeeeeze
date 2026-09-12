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