// Mixing a service's accent hex into the shades its hero needs.
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
 * The accent as RGB, with the graduation navy as the fallback.
 *
 * A malformed hex has to land somewhere: returning null here would mean every
 * call site writing its own guard, and one that forgot would emit
 * `rgba(NaN, NaN, NaN)` — which browsers drop silently, so the hero would
 * render with no gradient at all and nothing would say why.
 */
export function accentRgb(hex: string): [number, number, number] {
  return parseHex(hex) ?? [27, 79, 156];
}
