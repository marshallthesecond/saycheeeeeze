// Reads every published album photo from Supabase and hands it to the client
// UI. No hardcoded photo links: uploads arrive through the sync job with their
// derivative ladder, dimensions and ThumbHash already attached.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { pageMetadata } from "@/src/lib/seo";
import PortfolioContent from "./PortfolioContent";
import { getAllAlbums, getPortfolioPhotos } from "@/src/lib/albums";
import { getGalleryIndex } from "@/src/lib/client-galleries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMetadata("portfolio", locale as Locale, "/portfolio");
}

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