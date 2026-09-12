// The portrait photos that cycle in the About hero, in order.
//
// A plain list rather than a readdir of public/pfps: this is imported by a
// client component, so it cannot touch node:fs, and the order matters here in
// a way a directory listing can't express.

export const pfps = [
  "/pfps/7.jpg",
  "/pfps/13.jpg",
  "/pfps/14.jpg",
  "/pfps/15.jpg",
  "/pfps/16.jpg",
];