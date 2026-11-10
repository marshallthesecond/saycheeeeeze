"use client";

// A row of filter chips that NEVER wraps to a second line.
//
// However many categories there are, the row stays one line tall and scrolls
// sideways (Marshall's rule, 2026-11-10). When it does overflow, the far edge
// fades out so it is visible that more chips are there — measured, not
// assumed, so a row that fits shows no fade.

import { useEffect, useRef, useState } from "react";

export interface Chip {
  value: string;
  label: string;
}

export default function ChipRow({
  chips,
  value,
  onChange,
  label,
  size = "sm",
  className = "",
}: {
  chips: Chip[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the group. */
  label: string;
  /** sm — side panels; md — the main column. */
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<"none" | "end" | "both" | "start">("none");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const overflow = el.scrollWidth - el.clientWidth > 1;
      if (!overflow) return setFade("none");
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      setFade(atStart ? "end" : atEnd ? "start" : "both");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [chips.length]);

  const mask =
    fade === "end" ? "linear-gradient(to right, #000 85%, transparent)"
    : fade === "start" ? "linear-gradient(to left, #000 85%, transparent)"
    : fade === "both" ? "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)"
    : undefined;

  const chipSize =
    size === "md"
      ? "h-8 px-3.5 text-xs"
      : "h-6.5 px-2.5 text-[10.5px]";

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={`flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {chips.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.value)}
            className={
              `shrink-0 whitespace-nowrap rounded-full border font-semibold transition active:scale-95 ${chipSize} ` +
              (on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-foreground/80 hover:bg-foreground/8 hover:text-foreground")
            }
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
