// Sets inside a gallery (20261122120000_gallery_sets.sql): the parts a
// gallery is divided into, shown as tabs on its page. Shared by the site and
// the Studio, so a link the Studio copies opens the photo it was copied for.
//
// A gallery's page shows the sets that have a photo on it, in their order.
// The address names the set by that order and the photo by its place in the
// set: /albums/sara?set=2&p=5 is the fifth photo of the second set shown.
// A gallery with no sets has no tabs and no ?set=, as before.

export interface GallerySet {
  id: string;
  label: string;
}

/**
 * The sets the page shows and each one's photos, in the order given.
 *
 * A photo whose set is not in the list (none, or a set made after the page
 * was read) is counted in the first set, which is where the database would
 * put it. No sets: one group, `sets` empty.
 */
export function groupBySet<P extends { setId?: string | null }>(
  sets: readonly GallerySet[] | undefined,
  photos: readonly P[],
): { sets: GallerySet[]; photosOf: (setId: string | null) => P[] } {
  if (!sets || sets.length === 0) {
    const all = [...photos];
    return { sets: [], photosOf: () => all };
  }
  const known = new Set(sets.map((s) => s.id));
  const groups = new Map<string, P[]>(sets.map((s) => [s.id, []]));
  for (const p of photos) {
    const id = p.setId && known.has(p.setId) ? p.setId : sets[0].id;
    groups.get(id)!.push(p);
  }
  const shown = sets.filter((s) => groups.get(s.id)!.length > 0);
  return {
    sets: shown,
    photosOf: (setId) => (setId ? (groups.get(setId) ?? []) : []),
  };
}

/** ?set= for the set at this place among the shown ones (0 first). */
export function setParam(index: number): string {
  return String(index + 1);
}

/** The place among the shown sets that ?set= names, or 0. */
export function setIndexFromParam(raw: string | null, count: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
}

/**
 * The answer of a database without 20261122120000_gallery_sets.sql: no table
 * (42P01, or PostgREST's PGRST205), or no set_id column (42703). Read as a
 * gallery with no sets.
 */
export function isSetsMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") return true;
  return /gallery_sets|set_id/.test(error.message ?? "") && /does not exist|could not find/i.test(error.message ?? "");
}
