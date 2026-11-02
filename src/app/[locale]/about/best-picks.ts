// Where each "Best picks" photograph goes in the grid — pure arithmetic, no
// React, so it can be tested on its own and the component stays a renderer.
//
// THE SHAPE, from Marshall's sketch (2026-11-02):
//
//   ┌─────────────┬──────┬──────┐
//   │             │ A    │ C    │   A, D  short slots — landscape frames
//   │   FEATURE   ├──────┤      │   B, C  tall slots  — portrait frames
//   │   2 × 2     │ B    ├──────┤
//   │             │      │ D    │   The offset between the two right-hand
//   ├──────┬──────┼──────┼──────┤   columns is the point of the sketch: it is
//   │ rest │ rest │ rest │ rest │   what makes it read as a brick wall rather
//   │      │      └──────┤      │   than a table.
//   └──────┘             └──────┘   Below: masonry, natural aspect ratios.
//
// On a phone the feature runs full width and everything after it is a
// two-column masonry: four columns at 375px is 92px a photo, and a caption
// under a 92px photo is not readable by anyone.
//
// WHY THE FOUR BESIDE THE FEATURE ARE CHOSEN BY SHAPE, not taken in order: a
// short slot is roughly 3:2 and a tall one roughly 4:5. Put a portrait in a
// short slot and object-cover keeps a band across someone's chest; put a
// landscape in a tall slot and it keeps a sliver of the middle. So landscape
// frames go to A and D, portrait frames to B and C, each in list order, and
// anything that does not fit falls through to the masonry in list order. The
// feature is always the first entry — that one is a decision, not a fit.

/** Wider than this is treated as landscape. 1.15 rather than 1, so a 5:4 or
 *  a square counts as portrait-ish and is not squashed into a 3:2 slot. */
const LANDSCAPE_MIN = 1.15;

/** Assumed when a photograph has no dimensions on record. 4:5 is the most
 *  common shape in this portfolio and crops the least badly either way. */
export const FALLBACK_RATIO = 0.8;

/**
 * The caption's height as a fraction of a column's width, for balancing the
 * masonry. Approximate on purpose: the captions are about 36px tall and the
 * columns 180–400px wide, and the only thing this number has to get right is
 * which column is currently shortest.
 */
const CAPTION_UNITS = 0.14;

export interface Shaped {
  /** width / height */
  ratio: number;
}

export interface Plan<T> {
  feature: T | null;
  /** [A short, B tall, C tall, D short] — null where there was nothing left. */
  staggered: [T | null, T | null, T | null, T | null];
  /** Everything after the feature and the four beside it, in list order. */
  rest: T[];
}

const isLandscape = (x: Shaped) => x.ratio >= LANDSCAPE_MIN;

/**
 * The desktop plan.
 *
 * Fewer than five photographs cannot make the staggered block — there would
 * be holes beside the feature — so below that the feature stands alone and the
 * rest go straight to the masonry. The block is all or nothing.
 */
export function planDesktop<T extends Shaped>(items: readonly T[]): Plan<T> {
  if (items.length === 0) return { feature: null, staggered: [null, null, null, null], rest: [] };

  const [feature, ...after] = items;
  if (after.length < 4) {
    return { feature, staggered: [null, null, null, null], rest: [...after] };
  }

  const taken = new Set<number>();
  const takeFirst = (want: (x: T) => boolean): T | null => {
    const i = after.findIndex((x, n) => !taken.has(n) && want(x));
    if (i === -1) return null;
    taken.add(i);
    return after[i];
  };

  // Two passes per kind: the right shape first, then anything at all, so a
  // list of five portraits still fills every slot rather than leaving holes.
  const a = takeFirst(isLandscape);
  const d = takeFirst(isLandscape);
  const b = takeFirst((x) => !isLandscape(x));
  const c = takeFirst((x) => !isLandscape(x));
  const any = () => takeFirst(() => true);

  const staggered: Plan<T>["staggered"] = [a ?? any(), b ?? any(), c ?? any(), d ?? any()];
  const rest = after.filter((_, n) => !taken.has(n));
  return { feature, staggered, rest };
}

/**
 * Shortest-column-first masonry.
 *
 * Deterministic and computed from the aspect ratios already on record, so the
 * server and the browser lay the grid out identically — no measuring after
 * mount, no hydration mismatch, no jump. And because it places items strictly
 * in order, "Load more" only ever appends: nothing already on screen changes
 * column when more arrive.
 */
export function masonry<T extends Shaped>(items: readonly T[], columns: number): T[][] {
  const cols: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const heights = new Array<number>(cols.length).fill(0);
  for (const item of items) {
    let shortest = 0;
    for (let c = 1; c < cols.length; c++) if (heights[c] < heights[shortest] - 1e-9) shortest = c;
    cols[shortest].push(item);
    heights[shortest] += 1 / (item.ratio > 0 ? item.ratio : FALLBACK_RATIO) + CAPTION_UNITS;
  }
  return cols;
}

/** How many show before "Load more" — exactly the sketch: the feature, the
 *  four beside it and one row of four. */
export const INITIAL_VISIBLE = 9;
/** Two masonry rows' worth per press. */
export const LOAD_STEP = 8;

// Dates

/**
 * Month names written out rather than taken from Intl.DateTimeFormat.
 *
 * Two reasons. Server and browser must print the SAME string or React throws
 * a hydration mismatch, and Node's ICU and a phone's ICU do not reliably agree
 * — Uzbek in particular is patchy. And Intl's Russian short month is "нояб." with
 * a trailing "г." after the year, which is not what a caption should look like.
 *
 * Russian uses the genitive, which is what a day-month date takes: "10 мая",
 * not "10 май" — the bug the booking form once shipped with "22 октябрь".
 */
const MONTHS: Record<"en" | "ru" | "uz", readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  uz: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"],
};

/** Russian month in the nominative, for a month-and-year with no day. */
const RU_MONTH_NOMINATIVE = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/**
 * "2026-11-10" → "10 Nov, 2026" · "10 ноя 2026" · "10-noy, 2026".
 * "2026-11"    → "Nov 2026"     · "ноя 2026"    · "noy, 2026".
 * "2026"       → "2026".
 *
 * Anything else is printed exactly as written, so a free-text date ("Spring
 * 2026") still works — it just is not translated.
 */
export function formatPickDate(date: string | undefined, locale: string): string {
  if (!date) return "";
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(date.trim());
  if (!m) return date;

  const [, year, mm, dd] = m;
  if (!mm) return year;

  const month = Number(mm) - 1;
  if (month < 0 || month > 11) return date;
  const lang = locale === "ru" || locale === "uz" ? locale : "en";

  if (!dd) {
    if (lang === "ru") return `${RU_MONTH_NOMINATIVE[month]} ${year}`;
    if (lang === "uz") return `${MONTHS.uz[month]}, ${year}`;
    return `${MONTHS.en[month]} ${year}`;
  }

  const day = Number(dd);
  if (lang === "ru") return `${day} ${MONTHS.ru[month]} ${year}`;
  if (lang === "uz") return `${day}-${MONTHS.uz[month]}, ${year}`;
  return `${day} ${MONTHS.en[month]}, ${year}`;
}
