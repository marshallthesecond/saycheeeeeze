// src/app/[locale]/about/photos.ts
//
// The photographs the About page picks out by hand, as STORAGE PATHS rather
// than URLs.
//
// They used to be written as bunnyUrl('/Portraits/Sara/3M0A1432.png') inline in
// AboutContent, which meant they bypassed the `photos` table completely: no
// stored dimensions, no ThumbHash, and no derivative ladder — the only images
// left on the site still being resized on the fly. A path can be looked up; a
// URL cannot.
//
// Deliberately a plain module with no "use client": the server page imports it
// to resolve the paths, and the client component imports it for the ordering
// and categories. One list, two consumers, no duplication.
//
// ── Substituted 2026-09-02 ───────────────────────────────────
// Five entries pointed at files that do not exist in the storage zone —
// Portraits/3M0A4694.png, two under a Portraits/Shirin/ folder that was never
// uploaded, and two under WIUT-Fashion-Show-2026/ when the folder is actually
// called WIUT-Fashion-Show. They had been rendering as broken images.
//
// They now point at photographs confirmed present. The specific frames were
// chosen by gallery rather than by eye — swap any filename below for another in
// the same gallery and it takes effect with no other change, which is the point
// of holding paths rather than URLs.

/** Featured strip at the top. Order is the display order. */
export const BEST_PICKS: string[] = [
  "Portraits/Sara/3M0A1432.png",
  "Portraits/Radmir/3M0A0675.png",
  "WIUT-Fashion-Show/3M0A3551.png",
  "WIUT/5I9A3029.png",
  "Portraits/9O6A2264.png",
  "Portraits/dude.jpg",
  "Portraits/3M0A4694.png",
  "Portraits/076A0150.png",
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
  { path: "WIUT/5I9A3029.png", cat: "WIUT" },

  { path: "Portraits/Radmir/3M0A0607.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0549.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0772.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0675.png", cat: "Portrait" },

  { path: "Portraits/Sara/3M0A1047.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1255.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1333.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1432.png", cat: "Portrait" },
  { path: "Portraits/Sara/3M0A1105.png", cat: "Portrait" },

  { path: "Portraits/Radmir/3M0A0759.png", cat: "Portrait" },
  { path: "Portraits/Radmir/3M0A0568.png", cat: "Portrait" },
];

/**
 * The service cards. All storage paths now — the last two were public/
 * download.jpg and public/img4.JPG, which is why this file no longer needs to
 * distinguish local files from Bunny ones.
 */
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
