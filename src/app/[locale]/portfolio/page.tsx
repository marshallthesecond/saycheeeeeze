// Reads every published album photo from Supabase and hands it to the client
// UI. No hardcoded photo links: uploads arrive through the sync job with their
// derivative ladder, dimensions and ThumbHash already attached.

import type { Metadata } from "next";
import PortfolioContent from "./PortfolioContent";
import { getAllAlbums, getPortfolioPhotos } from "@/src/lib/albums";
import { getGalleryIndex } from "@/src/lib/client-galleries";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Portraits, street scenes, editorial shoots and everything in between — photography from Tashkent by saycheeeeeze.",
  openGraph: {
    title: "Portfolio · saycheeeeeze",
    description:
      "Portraits, street scenes, editorial shoots and everything in between.",
  },
};

export default async function PortfolioPage() {
  const [photos, albums, galleries] = await Promise.all([
    getPortfolioPhotos(),
    getAllAlbums(),
    getGalleryIndex(),
  ]);
  return (
    <PortfolioContent photos={photos} albums={albums} galleries={galleries} />
  );
}