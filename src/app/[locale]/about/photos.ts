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

/** Featured strip at the top. Order is the display order. */
export const BEST_PICKS: string[] = [
  "Portraits/Sara/3M0A1432.png",
  "Portraits/Radmir/3M0A0675.png",
  "WIUT-Fashion-Show/3M0A3551.png",
  "WIUT/5I9A3029.png",
  "Portraits/9O6A2264.png",
  "Portraits/dude.jpg",
  "Portraits/3M0A4694.png",
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
  { path: "WIUT/5I9A3020.png", cat: "WIUT" },

  { path: "Portraits/Radmir/3M0A0607.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0549.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0772.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0675.png", cat: "Portrait" },

  { path: "Portraits/Sara/3M0A1047.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1255.png", cat: "Portrait" },

  { path: "WIUT/5I9A3029.png", cat: "WIUT" },

  { path: "Portraits/Sara/3M0A1333.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1432.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1105.png", cat: "Portrait" },

  { path: "Portraits/Radmir/3M0A0759.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0568.png", cat: "Portrait" },
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
    ...BEST_PICKS,
    ...MY_WORKS.map((w) => w.path),
    ...OPEN_TO.map((o) => o.path),
    CTA_BANNER,
  ]),
);
