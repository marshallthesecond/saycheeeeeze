"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import LanguageSwitcher from "@/src/components/common/LanguageSwitcher";
import { useT } from "@/src/lib/i18n/LanguageProvider";

/** Frosted page ground behind the chevron while the bar is still transparent:
 *  over a hero photograph it has to carry an ink chevron in light mode and a
 *  cream one in dark, and a fixed black pill only did the second. */
const BACK_PILL = "color-mix(in oklab, var(--background) 90%, transparent)";

interface StickyHeaderProps {
  title: string;
  /** Scroll distance (px) over which the bar fades from transparent to solid. */
  fadeOver?: number;
  /** Optional back link. Omit to show no chevron. */
  backHref?: string;
  /** Optional back handler — use instead of backHref for in-page navigation. */
  onBack?: () => void;
  /**
   * "default" — left-aligned page title that fades in with the bar (original).
   * "wordmark" — brand mark centred in the bar and legible from first paint,
   * for pages whose hero already states the title in full.
   */
  variant?: "default" | "wordmark";
}

/**
 * Spotify-style top bar: transparent over the hero, then fades into a solid
 * bar with the page title as you scroll past it. Stays out of the way on first
 * paint so the hero image gets the full screen.
 *
 * The bar is the page ground, not a colour. It used to take an `accent` hex
 * and fade into that — a service's accent, an album's colour — which under the
 * pomegranate palette would put a full-width red bar over every service page.
 * Red is for actions; the bar is furniture.
 */
export default function StickyHeader({
  title,
  fadeOver = 220,
  backHref,
  onBack,
  variant = "default",
}: StickyHeaderProps) {
  const [progress, setProgress] = useState(0);

  // The back chevron is the one piece of this bar with an accessible name of
  // its own, and it was hardcoded English on every page. useT() degrades to
  // returning the key when there's no provider above (an isolated test), so
  // the comparison below is what keeps "common.back" out of a screen reader.
  const { t } = useT();
  const translated = t("common.back");
  const backLabel = translated === "common.back" ? "Back" : translated;

  useEffect(() => {
    // Scroll fires far more often than the screen refreshes, and every raw
    // float here would be a fresh React render plus a backdrop-filter recalc —
    // the single most expensive thing to do 100+ times a second on a phone.
    // So: coalesce to one update per animation frame, and quantise to 20 steps
    // so identical values bail out of rendering entirely. The fade still looks
    // continuous; it just stops re-rendering between visually identical states.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const raw = Math.min(window.scrollY / fadeOver, 1);
      setProgress(Math.round(raw * 20) / 20);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    onScroll(); // account for a restored scroll position on mount
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [fadeOver]);

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 px-4 h-14"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(2.5rem + env(safe-area-inset-top))",
        boxShadow: progress > 0.9 ? "0 1px 0 var(--border)" : "none",
        backdropFilter: progress > 0.15 ? "blur(16px)" : "none",
        WebkitBackdropFilter: progress > 0.15 ? "blur(16px)" : "none",
        // Ignore taps while the bar is still invisible over the hero.
        pointerEvents: progress > 0.5 ? "auto" : "none",
      }}
    >
      {/* Separate layer so the title stays fully opaque while the
          background alone animates its alpha. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-background"
        style={{ opacity: progress }}
      />

      {(backHref || onBack) && (
        onBack ? (
          <button
            onClick={onBack}
            className="flex items-center justify-center min-w-9 min-h-9 -ml-1 rounded-full backdrop-blur-md active:bg-foreground/10 transition"
            style={{ pointerEvents: "auto", backgroundColor: progress > 0.5 ? "transparent" : BACK_PILL }}
            aria-label={backLabel}
          >
            <ChevronLeft className="w-6 h-6 text-foreground" />
          </button>
        ) : (
          <Link
            href={backHref!}
            className="flex items-center justify-center min-w-9 min-h-9 -ml-1 rounded-full backdrop-blur-md active:bg-foreground/10 transition"
            style={{ pointerEvents: "auto", backgroundColor: progress > 0.5 ? "transparent" : BACK_PILL }}
            aria-label={backLabel}
          >
            <ChevronLeft className="w-6 h-6 text-foreground" />
          </Link>
        )
      )}

      {variant === "wordmark" ? (
        /* Absolutely centred so the back chevron and language switcher don't
           push it off-axis. aria-hidden on the wrapper isn't needed — it's the
           accessible name of the bar, just never a layout participant. */
        // The same frosted ground as the chevron until the bar is solid:
        // "legible from first paint" has to hold over a hero photograph too,
        // which on an album page is exactly where it first paints.
        <span
          className="absolute left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+0.3125rem)] h-7.5 px-3 rounded-full flex items-center max-w-[55%] truncate
                     font-mono text-[11px] uppercase tracking-[0.22em] text-fg-muted backdrop-blur-md transition-colors"
          style={{ backgroundColor: progress > 0.5 ? "transparent" : BACK_PILL }}
        >
          {title}
        </span>
      ) : (
        <span
          className="text-base font-bold text-foreground truncate"
          style={{ opacity: progress }}
        >
          {title}
        </span>
      )}

      {/* Language switcher — stays tappable even while the bar is transparent. */}
      <div className="ml-auto" style={{ pointerEvents: "auto" }}>
        <LanguageSwitcher />
      </div>
    </header>
  );
}