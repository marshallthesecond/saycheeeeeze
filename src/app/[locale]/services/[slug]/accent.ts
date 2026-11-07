// Mixing a service's accent hex into the colours its page needs.
//
// The heroes and text now go through accentMix() and accentText(), which leave
// the mixing to CSS so it can follow the theme. parseHex/shade/accentRgb are
// the older sRGB path, kept because they are exported and cheap.
//
// Lifted out of ServiceHero so both heroes read the same ramp. Two copies of a
// colour function is two copies that will eventually disagree, and the whole
// point of deriving every stop from `accentColor` is that a service gets a
// coherent hero from one hex with no new CSS.

/** #1B4F9C → [27, 79, 156]. Returns null for anything not a 6-digit hex. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes toward white (amount > 0) or black (amount < 0), as an rgba() string. */
export function shade(rgb: [number, number, number], amount: number, alpha = 1): string {
  const t = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const [r, g, b] = rgb.map((c) => Math.round(c + (t - c) * k)) as [number, number, number];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The accent as RGB, with the brand pomegranate (#B8334A) as the fallback.
 *
 * A malformed hex has to land somewhere: returning null here would mean every
 * call site writing its own guard, and one that forgot would emit
 * `rgba(NaN, NaN, NaN)` — which browsers drop silently, so the hero would
 * render with no gradient at all and nothing would say why.
 */
export function accentRgb(hex: string): [number, number, number] {
  return parseHex(hex) ?? [184, 51, 74];
}

/**
 * The accent mixed into a theme colour, as CSS — `accentMix(hex, 18)` is 18%
 * accent over the page ground. For the drawn parts of a hero: they have to
 * sit on cream in light mode and on wine-black in dark, and only the
 * stylesheet knows which, so the mixing is left to the browser.
 */
export function accentMix(hex: string, percent: number, base = 'var(--background)'): string {
  return `color-mix(in oklab, ${safeHex(hex)} ${percent}%, ${base})`;
}

function safeHex(hex: string): string {
  const t = hex.trim();
  return parseHex(t) ? (t.startsWith('#') ? t : `#${t}`) : '#B8334A';
}

/**
 * The accent as a TEXT colour that passes AA in both themes.
 *
 * A raw accent hex is a fill colour. #B8334A as text measures 2.6:1 on the
 * dark ground and graduation navy 2.0:1, so every `style={{ color: accent }}`
 * goes through this instead: the accent mixed with the foreground, by an
 * amount the theme sets (--sc-accent-mix in globals.css). It stays CSS rather
 * than JS because these are server components and only the stylesheet knows
 * which theme the visitor's phone is in.
 *
 * Fills — the icon tile, dots, toggles, the selected radio — keep the raw hex:
 * white on either accent clears AA.
 */
export function accentText(hex: string): string {
  return `color-mix(in oklab, ${safeHex(hex)} var(--sc-accent-mix), var(--foreground))`;
}
