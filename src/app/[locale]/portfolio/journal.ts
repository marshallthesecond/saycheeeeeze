// The journal spread on /portfolio (2026-11-14): a magazine-style spread that
// sits among the photographs, a little further down than the Albums shelf.
//
// Text page: masthead, headline, a short essay, a pull quote and a few facts
// about the lead album. Picture page: one large photograph and two smaller
// ones, credited underneath. The words live in the dictionaries under
// `journal.*`, the look in JournalSpread.tsx and the `.jr` rules in
// globals.css; this file picks the photographs and works out which album each
// one belongs to.
//
// To change the photographs, change the paths below. They are storage paths,
// never URLs, so each arrives with its ladder, dimensions and ThumbHash. A path
// with no photo row is skipped; if the large one is missing the spread does not
// render at all.

import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";

export const JOURNAL = {
  /** Shown as "Issue 1" in the masthead. */
  issue: 1,
  /** The large photograph. Its album supplies the facts and the link. */
  hero: "Portraits/Mekhrangiz/4P5A1850.png",
  /** The two smaller photographs. */
  pair: ["Portraits/Sara/3M0A1432.png", "Portraits/Radmir/3M0A0675.png"],
  /** How many grid photographs come between the Albums shelf and the spread. */
  after: 15,
} as const;

export const JOURNAL_PATHS: string[] = [JOURNAL.hero, ...JOURNAL.pair];

export interface JournalPlate {
  photo: AlbumPhoto;
  /** The top-level folder: "Portraits", "WIUT". */
  category: string;
  /** The album the photograph belongs to, when one can be found. */
  album?: { slug: string; title: string; year: string; photoCount: number };
}

export interface JournalData {
  issue: number;
  after: number;
  /** The large photograph first, then the smaller ones. */
  plates: JournalPlate[];
}

/** The album whose folder holds `path`, the deepest one if folders nest. */
function albumFor(path: string, albums: AlbumData[]): AlbumData | undefined {
  let best: AlbumData | undefined;
  for (const a of albums) {
    const folder = a.folder?.replace(/\/+$/, "");
    if (!folder || !path.startsWith(folder + "/")) continue;
    if (!best || (best.folder ?? "").length < folder.length) best = a;
  }
  return best;
}

/** Server side: storage paths → what the spread needs, or null to leave it out. */
export function buildJournal(
  byPath: Record<string, AlbumPhoto>,
  albums: AlbumData[],
): JournalData | null {
  const plates: JournalPlate[] = [];
  for (const path of JOURNAL_PATHS) {
    const photo = byPath[path];
    if (!photo) {
      if (path === JOURNAL.hero) return null;
      continue;
    }
    const album = albumFor(path, albums);
    const slash = path.indexOf("/");
    plates.push({
      photo,
      category: slash === -1 ? "" : path.slice(0, slash),
      album: album
        ? { slug: album.slug, title: album.title, year: album.year, photoCount: album.photoCount }
        : undefined,
    });
  }
  return { issue: JOURNAL.issue, after: JOURNAL.after, plates };
}
