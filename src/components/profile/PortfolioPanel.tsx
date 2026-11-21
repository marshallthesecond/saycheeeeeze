"use client";

// The portfolio, condensed into a side column — About's left column.
//
// Title, the three gallery doors (2026-11-22, from the Portfolio page, which
// was removed), the counts, category chips on ONE line and a two-column grid
// of the first photographs. The chips scroll sideways rather than wrap,
// however many categories the portfolio grows. id="portfolio" is where the
// site's "portfolio" links land now.

import { useMemo, useState } from "react";
import PhotoGrid from "@/src/components/common/PhotoGrid";
import ChipRow from "@/src/components/common/ChipRow";
import GalleryDoors, { type Door } from "@/src/components/common/GalleryDoors";
import { CARD_SHAPE } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { AlbumData } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import { ABOUT_PER_VIEW, workView, type WorkPhoto, type WorkPreview } from "@/src/lib/work-preview";

export default function PortfolioPanel({
  work,
  albums,
  galleries,
  onDoor,
  onOpen,
}: {
  work: WorkPreview;
  albums: AlbumData[];
  galleries: GalleryListing[];
  onDoor: (door: Door) => void;
  onOpen: (photos: WorkPhoto[], index: number) => void;
}) {
  const { t } = useT();
  const albumsCount = albums.length;
  const [filter, setFilter] = useState("All");

  const chips = useMemo(
    () => [
      { value: "All", label: t("portfolio.all") },
      ...work.categories.map((c) => ({ value: c.name, label: c.name })),
    ],
    [work.categories, t],
  );
  const shown = useMemo(
    () => workView(work, filter, ABOUT_PER_VIEW).map((p) => ({ ...p, alt: p.alt || p.category })),
    [work, filter],
  );

  return (
    <section
      id="portfolio"
      aria-labelledby="panel-portfolio"
      className={`flex scroll-mt-[calc(4rem+env(safe-area-inset-top))] flex-col gap-3 ${CARD_SHAPE} bg-card p-4`}
    >
      <h2 id="panel-portfolio" className="text-xl font-bold tracking-tight">{t("portfolio.title")}</h2>

      <GalleryDoors albums={albums} galleries={galleries} onOpen={onDoor} />

      <div className="grid grid-cols-2 gap-2">
        <p className="flex flex-col rounded-xl bg-background px-3 py-2">
          <span className="text-lg font-bold leading-tight">{albumsCount}</span>
          <span className="text-[11px] text-muted-foreground">{t("aboutPage.albumsStat")}</span>
        </p>
        <p className="flex flex-col rounded-xl bg-background px-3 py-2">
          <span className="text-lg font-bold leading-tight">{work.total}</span>
          <span className="text-[11px] text-muted-foreground">{t("aboutPage.photosStat")}</span>
        </p>
      </div>

      <ChipRow chips={chips} value={filter} onChange={setFilter} label={t("home.filterWork")} size="sm" className="shrink-0" />

      {shown.length > 0 ? (
        <div className="overflow-hidden rounded-lg">
          <PhotoGrid photos={shown} onPhotoClick={(i) => onOpen(shown, i)} gap={4} />
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-muted-foreground">{t("portfolio.emptyFilter")}</p>
      )}
    </section>
  );
}
