// A row of social links that NEVER wraps to a second line.
//
// Marshall's rule (2026-11-10): however many links there are, they stay on
// one line; the type may get smaller to make that true. So the font size is
// computed from the row itself:
//
//   width of the row ≈ font-size × (characters × 0.7 + gaps × 1.25)
//
// 0.7em per character is a monospace advance (0.6em) plus the 0.1em letter
// spacing; 1.25em is the gap between links. Solving for font-size against the
// container's own width (`cqi` — 1% of the container's inline size) gives a
// size that fills the row exactly, clamped between a readable minimum and the
// design size. Below the minimum the row scrolls sideways rather than wrapping.
// No measuring after mount, so the server's HTML is already the final layout.

import type { CSSProperties } from "react";
import type { SocialLink } from "@/src/lib/profile";

/**
 * Real Instagram and Telegram hues, each stop moved in lightness only until it
 * clears 4.6:1 on a card in its theme. `.sc-brand-text` in globals.css picks
 * the set by theme. Keyed by label: a link with no brand here gets the
 * muted-to-foreground treatment.
 */
const BRAND: Record<string, { dark: string; light: string; inkDark: string; inkLight: string }> = {
  Instagram: {
    dark: "linear-gradient(100deg,#FEDA75 0%,#F98033 27%,#F24A82 55%,#CD59DE 78%,#9490FF 100%)",
    light: "linear-gradient(100deg,#826000 0%,#B23F00 27%,#C5125E 55%,#A42DB5 78%,#6057C0 100%)",
    inkDark: "#F24A82",
    inkLight: "#C5125E",
  },
  Telegram: {
    dark: "linear-gradient(100deg,#6FD5FF 0%,#37BBFE 35%,#2AABEE 65%,#2196D6 100%)",
    light: "linear-gradient(100deg,#006D93 0%,#0069A7 35%,#0062A0 65%,#005C99 100%)",
    inkDark: "#2AABEE",
    inkLight: "#0069A8",
  },
};

const CHAR_EM = 0.7;
const GAP_EM = 1.25;

export default function SocialLinks({
  links,
  maxPx = 12,
  minPx = 8,
  spread = true,
  label,
  className = "",
}: {
  links: readonly SocialLink[];
  /** The design size — the row never grows past it. */
  maxPx?: number;
  /** Below this the row scrolls instead of shrinking further. */
  minPx?: number;
  /** Spread across the full width (true) or packed to the start. */
  spread?: boolean;
  /** Accessible name for the row. */
  label?: string;
  className?: string;
}) {
  if (links.length === 0) return null;

  const chars = links.reduce((n, l) => n + l.label.length, 0);
  const ems = chars * CHAR_EM + (links.length - 1) * GAP_EM;

  return (
    <nav aria-label={label} className={`min-w-0 ${className}`} style={{ containerType: "inline-size" }}>
      <ul
        className="flex flex-nowrap items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          fontSize: `clamp(${minPx}px, calc(100cqi / ${ems.toFixed(3)}), ${maxPx}px)`,
          gap: `${GAP_EM}em`,
          justifyContent: spread ? "space-between" : "flex-start",
        }}
      >
        {links.map((l) => {
          const brand = BRAND[l.label];
          return (
            <li key={l.label} className="shrink-0">
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  "font-mono uppercase whitespace-nowrap tracking-[0.1em] leading-none " +
                  (brand ? "sc-brand-text" : "text-fg-muted hover:text-foreground transition-colors")
                }
                style={
                  brand
                    ? ({
                        "--sc-brand-gradient-dark": brand.dark,
                        "--sc-brand-gradient-light": brand.light,
                        "--sc-brand-ink-dark": brand.inkDark,
                        "--sc-brand-ink-light": brand.inkLight,
                      } as CSSProperties)
                    : undefined
                }
              >
                {l.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
