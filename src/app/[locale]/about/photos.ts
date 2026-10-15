// The photographs the About page picks out by hand, as storage paths rather
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
 * MY BEST PHOTOS — the real work, hand-picked, at the top of the page.
 *
 * Empty on purpose. This shelf renders nothing at all until there is
 * something in it, because an empty "My best photos" heading on a
 * photographer's page says the opposite of what it is there to say.
 *
 * TO FILL IT, run the picker and copy a path per line:
 *
 *   node --env-file=.env.local scripts/contact-sheet.mjs
 *
 * Six to ten is the right number. More than that and it stops being a
 * selection; the filterable MY_WORKS grid further down is where volume goes.
 *
 * These are the frames that carry the page, so it is worth being ruthless:
 * every one of them should be a photograph someone would book you for.
 */
export const BEST_PHOTOS: string[] = [];

/**
 * REFERENCE PHOTOS — direction, not portfolio.
 *
 * This list used to be BEST_PICKS and was presented as Marshall's best work.
 * It is not: some of these frames are AI-generated, kept because they say
 * usefully what a session could look like. Renaming the section is the honest
 * fix and the cheap one — the pictures stay, the claim about them goes.
 *
 * A rail of photographs on a photographer's page is read as the
 * photographer's unless something says otherwise, so the heading is not doing
 * this alone: the shelf carries a subtitle, and its alt text no longer says
 * "by saycheeeeeze".
 *
 * Anything genuinely his that is in here belongs in BEST_PHOTOS above
 * instead — it is being undersold sitting in a reference strip.
 */
export const REFERENCE_PHOTOS: string[] = [
  "Portraits/Sara/3M0A1432.png",
  "Portraits/Radmir/3M0A0675.png",
  "WIUT-Fashion-Show/3M0A3551.png",
  "WIUT/5I9A3029.png",
  "Portraits/9O6A2264.png",
  "Portraits/dude.jpg",
  "Portraits/3M0A4694.png",
  "Portraits/Mekhrangiz/4P5A1850.png",

  // "Clients/Mekhrangiz/4P5A1850.png"
];

export type WorksCategory =
  | "Commercial"
  | "Moments"
  | "Fashion"
  | "Street"
  | "Portrait"
  | "WIUT"
  | "Nature";

/** The filterable works grid. */
export const MY_WORKS: { path: string; cat: WorksCategory }[] = [
  
  { path: "Portraits/Radmir/3M0A0675.png", cat: "Portrait" },
  { path: "WIUT/5I9A3020.png", cat: "WIUT" },
  { path: "Portraits/Sara/3M0A1047.png", cat: "Portrait" },
  { path: "WIUT/5I9A3029.png", cat: "WIUT" },
  { path: "Portraits/Radmir/3M0A0759.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1432.png", cat: "Portrait" },
  { path: "Nature/damnbby.jpg", cat: "Nature" },
  { path: "Portraits/9O6A2264.png", cat: "Portrait" },
  { path: "Nature/youcanseeit.jpg", cat: "Nature" },
  { path: "Portraits/Diora/076A0384.png", cat: "Portrait" },
  { path: "WIUT/400A6607.png", cat: "WIUT" },
  { path: "Random/capp.jpg", cat: "Nature" },
  { path: "WIUT-Fashion-Show/3M0A2669.png", cat: "Fashion" },
  { path: "WIUT-Fashion-Show/3M0A3551.png", cat: "Fashion" },
];

/** The service cards. All storage paths, so nothing here has to distinguish
 *  local files from Bunny ones. */
export const OPEN_TO: {
  title: string;
  sub: string;
  slug: string;
  path: string;
}[] = [
  {
    title: "Portraits",
    sub: "Solo, group, or a photowalk through Tashkent — your call",
    path: "Portraits/Radmir/3M0A0675.png",
    slug: "portraits",
  },
  {
    title: "Graduation",
    sub: "Cap, gown, and one unforgettable frame",
    path: "WIUT/5Y2A4401.png",
    slug: "graduation",
  },
  {
    title: "Model Photography",
    sub: "Portfolio-ready shots that open agency doors",
    path: "WIUT-Fashion-Show/3M0A1946.png",
    slug: "models",
  },
  {
    title: "Brands & Products",
    sub: "Make your product impossible to scroll past",
    path: "Random/espressomachine.jpg",
    slug: "brand-product",
  },
];

/** The full-bleed CTA banner behind the "book a session" copy. */
export const CTA_BANNER = "Random/itsmelol.jpg";

/** Every storage path this page needs, deduplicated — what the server resolves. */
export const ABOUT_PHOTO_PATHS: string[] = Array.from(
  new Set([
    ...BEST_PHOTOS,
    ...REFERENCE_PHOTOS,
    ...MY_WORKS.map((w) => w.path),
    ...OPEN_TO.map((o) => o.path),
    CTA_BANNER,
  ]),
);
