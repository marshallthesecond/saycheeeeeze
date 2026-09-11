"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import LanguageSwitcher from "@/src/components/common/LanguageSwitcher";
import { useT } from "@/src/lib/i18n/LanguageProvider";

interface StickyHeaderProps {
  title: string;
  /** Hex accent the bar tints toward as it fades in. Defaults to near-black. */
  accent?: string;
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
 * tinted bar with the page title as you scroll past it. Stays out of the way
 * on first paint so the hero image gets the full screen.
 */
export default function StickyHeader({
  title,
  accent = "#0a0a0a",
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
        boxShadow: progress > 0.9 ? "0 1px 0 rgba(255,255,255,0.06)" : "none",
        backdropFilter: progress > 0.15 ? "blur(16px)" : "none",
        WebkitBackdropFilter: progress > 0.15 ? "blur(16px)" : "none",
        // Ignore taps while the bar is still invisible over the hero.
        pointerEvents: progress > 0.5 ? "auto" : "none",
      }}
    >
      {/* Separate tinted layer so the title stays fully opaque while the
          background alone animates its alpha. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ backgroundColor: accent, opacity: progress }}
      />

      {(backHref || onBack) && (
        onBack ? (
          <button
            onClick={onBack}
            className="flex items-center justify-center min-w-9 min-h-9 -ml-1 rounded-full active:bg-white/10 transition"
            style={{
              pointerEvents: "auto",
              backgroundColor: progress > 0.5 ? "transparent" : "rgba(0,0,0,0.35)",
            }}
            aria-label={backLabel}
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        ) : (
          <Link
            href={backHref!}
            className="flex items-center justify-center min-w-9 min-h-9 -ml-1 rounded-full active:bg-white/10 transition"
            style={{
              pointerEvents: "auto",
              backgroundColor: progress > 0.5 ? "transparent" : "rgba(0,0,0,0.35)",
            }}
            aria-label={backLabel}
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </Link>
        )
      )}

      {variant === "wordmark" ? (
        /* Absolutely centred so the back chevron and language switcher don't
           push it off-axis. aria-hidden on the wrapper isn't needed — it's the
           accessible name of the bar, just never a layout participant. */
        <span
          className="absolute left-1/2 -translate-x-1/2 h-10 flex items-center max-w-[55%] truncate
                     font-mono text-[11px] uppercase tracking-[0.22em] text-fg-muted"
          style={{ top: "env(safe-area-inset-top)" }}
        >
          {title}
        </span>
      ) : (
        <span
          className="text-base font-bold text-white truncate"
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