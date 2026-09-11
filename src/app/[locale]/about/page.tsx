// src/app/about/page.tsx
//
// Server shell so this route can export metadata — the interactive content
// lives in AboutContent.tsx, which is a client component.

import type { Metadata } from "next";
import AboutContent from "./AboutContent";
import { getAllAlbums, getPhotosByPaths } from "@/src/lib/albums";
import { ABOUT_PHOTO_PATHS } from "./photos";

export const metadata: Metadata = {
  title: "About",
  description:
    "Marshall with a Camera — photographer based in Tashkent. Portraits, fashion, events and commercial work.",
  openGraph: {
    title: "saycheeeeeze · Photography in Tashkent",
    description:
      "Portraits, fashion, events and commercial photography in Tashkent.",
  },
};

export default async function AboutPage() {
  // Resolved on the server so the client receives real dimensions, ThumbHashes
  // and derivative URLs in the first render payload — before a single image is
  // requested.
  const [albums, photoIndex] = await Promise.all([
    getAllAlbums(),
    getPhotosByPaths(ABOUT_PHOTO_PATHS),
  ]);

  return <AboutContent albums={albums} photoIndex={photoIndex} />;
}