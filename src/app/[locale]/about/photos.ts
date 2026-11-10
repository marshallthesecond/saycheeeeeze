// The photographs the Home and About pages pick out by hand, as storage paths rather
// than URLs — a path can be looked up in the `photos` table and get its
// dimensions, ThumbHash and derivative ladder; a bunnyUrl(...) cannot.
//
// No "use client" on purpose: the server page imports it to resolve the paths,
// the client component for the ordering and categories. One list, two
// consumers.
//
// Swap any filename for another in the same gallery and it takes effect with
// no other change. Check it exists in the storage zone first — entries here
// have pointed at folders that were never uploaded and rendered as broken.

/**
 * BEST PICKS — the grid near the top of the page.
 *
 * Order is display order, with one exception: the FIRST entry is the big
 * feature tile, and the four beside it are chosen by shape — landscape frames
 * for the two short slots, portrait frames for the two tall ones — so a
 * portrait never gets cropped into a 3:2 box. Everything else follows in the
 * order written here. See best-picks.ts for the layout itself.
 *
 * NINE fills the first screen exactly, as in the sketch: the feature, the four
 * beside it and one row of four. With fewer the second row has a gap; with
 * more, "Load more" appears and reveals eight at a time.
 *
 * THE CAPTION under each photo, left to right:
 *
 *   cat    bold, top left — one of the WorksCategory values below, shown in
 *          the reader's language (Portrait / Портрет / Portret).
 *   date   top right. Write "2026-11-10", "2026-11" or just "2026"; it is
 *          formatted per language ("10 Nov, 2026" / "10 ноя 2026"). Nothing
 *          in the database records when a photograph was taken, so this is
 *          the only place the date can come from. Leave it out and the corner
 *          stays empty.
 *   title  italic, second line. Optional. The defaults below are the
 *          subject's name from the folder; write anything you like instead.
 *
 * History, so nobody is surprised by git blame: on 2026-10-15 this list was
 * split into a "reference photos" rail with an AI-generated note, because some
 * of these frames are; on 2026-11-02 Marshall had it put back to Best picks
 * with no note, and will swap the AI frames for real work himself.
 */
export interface BestPick {
  path: string;
  cat: WorksCategory;
  title?: string;
  date?: string;
}

export const BEST_PICKS: BestPick[] = [
  // The feature tile. Choose this one deliberately.
  { path: "Portraits/Sara/3M0A1432.png", cat: "Portrait", title: "Sara", date: "2026" },
  { path: "Portraits/Radmir/3M0A0675.png", cat: "Portrait", title: "Radmir", date: "2026" },
  { path: "WIUT-Fashion-Show/3M0A3551.png", cat: "Fashion", title: "WIUT Fashion Show", date: "2026" },
  { path: "WIUT/5I9A3029.png", cat: "WIUT" },
  { path: "Portraits/9O6A2264.png", cat: "Portrait" },
  { path: "Portraits/Gulasal at WIUT/2W6A7098.png", cat: "Portrait" },
  { path: "Portraits/3M0A4694.png", cat: "Portrait" },
  { path: "Portraits/Mekhrangiz/4P5A1850.png", cat: "Portrait", title: "Mekhrangiz", date: "2026" },
  { path: "WIUT-Fashion-Show/3M0A2504.png", cat: "Fashion"}
];

export type WorksCategory =
  | "Commercial"
  | "Moments"
  | "Fashion"
  | "Street"
  | "Portrait"
  | "WIUT"
  | "Nature";

/**
 * A photograph for each session type in the "Sessions" lists on Home and
 * About, keyed by service slug. A slug with no entry shows no thumbnail.
 *
 * (Until 2026-11-10 these were the "Open to" cards, with a title and a line
 * each. The lists now take their titles and prices from services.ts, so only
 * the photograph is chosen here. The "My works" grid that used to follow went
 * at the same time: Home's "All work" tab shows the real portfolio instead.)
 */
export const SESSION_PHOTOS: Record<string, string> = {
  portraits: "Portraits/Radmir/3M0A0675.png",
  graduation: "WIUT/5Y2A4401.png",
  models: "WIUT-Fashion-Show/3M0A1946.png",
  "brand-product": "Random/espressomachine.jpg",
};

/** The cover of the About page's profile card: a photograph of you at work.
 *  It was the background of the old "I put you in a frame" banner. */
export const ABOUT_COVER = "Random/itsmelol.jpg";

/** What the Home page resolves: best picks and session thumbnails. */
export const HOME_PHOTO_PATHS: string[] = Array.from(
  new Set([...BEST_PICKS.map((p) => p.path), ...Object.values(SESSION_PHOTOS)]),
);

/** What the About page resolves: the cover and session thumbnails. */
export const ABOUT_PHOTO_PATHS: string[] = Array.from(
  new Set([ABOUT_COVER, ...Object.values(SESSION_PHOTOS)]),
);
