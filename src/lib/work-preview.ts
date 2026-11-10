// The slice of the portfolio that the Home and About pages show.
//
// The full portfolio is 500+ photographs, and its page ships every one of them.
// A page that only previews the work should not: this keeps the first N per
// category, in the same day-shuffled order the portfolio page uses, and drops
// every field a grid tile does not read (download sizes, file names, ids).
// The real totals travel separately, so a tab can say "All work · 524" while
// only the first screenful is in the payload.

import type { PortfolioPhoto } from "@/src/lib/albums";
import type { LadderSources } from "@/src/lib/ladder";

/** How many photographs Home's "All work" shows before handing over to /portfolio. */
export const HOME_PER_VIEW = 48;
/** How many the About page's portfolio panel shows. */
export const ABOUT_PER_VIEW = 12;

// Day-seeded shuffle

/**
 * Days since the epoch, in Tashkent: the same integer on the server and in
 * every visitor's browser, whatever timezone they're in. The order rotates at
 * midnight Tashkent time.
 */
export function daySeed(): number {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** mulberry32 — a tiny deterministic PRNG. Same seed in, same order out. */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Preview

/** What a grid tile needs, and nothing else. */
export interface WorkPhoto {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  ladder?: LadderSources;
  thumbhash?: string;
  category: string;
}

export interface WorkPreview {
  /** First `perView` of "All", then each category's first `perView`, deduplicated. */
  photos: WorkPhoto[];
  /** Filterable categories with their real totals, alphabetical like /portfolio. */
  categories: { name: string; count: number }[];
  /** Every portfolio photograph, hidden categories included — what "All" counts. */
  total: number;
}

function lite(p: PortfolioPhoto): WorkPhoto {
  return {
    src: p.src,
    alt: p.alt,
    width: p.width,
    height: p.height,
    ladder: p.ladder,
    thumbhash: p.thumbhash,
    category: p.category,
  };
}

/**
 * The same rules as /portfolio: "All" is every photograph in the day's order;
 * a category hidden by portfolio-exclude.json still appears under All but gets
 * no tab of its own.
 */
export function workPreview(all: PortfolioPhoto[], perView: number): WorkPreview {
  const shuffled = shuffleWithSeed(all, daySeed());
  const names = Array.from(new Set(all.filter((p) => !p.hidden).map((p) => p.category))).sort();

  const keep = new Map<string, WorkPhoto>();
  for (const p of shuffled.slice(0, perView)) keep.set(p.src, lite(p));
  for (const name of names) {
    let n = 0;
    for (const p of shuffled) {
      if (p.category !== name) continue;
      if (!keep.has(p.src)) keep.set(p.src, lite(p));
      if (++n >= perView) break;
    }
  }

  return {
    photos: Array.from(keep.values()),
    categories: names.map((name) => ({
      name,
      count: all.filter((p) => p.category === name).length,
    })),
    total: all.length,
  };
}

/** One view of a preview: "All" or a category, in the day's order, capped. */
export function workView(preview: WorkPreview, filter: string, perView: number): WorkPhoto[] {
  const list = filter === "All" ? preview.photos : preview.photos.filter((p) => p.category === filter);
  return list.slice(0, perView);
}
