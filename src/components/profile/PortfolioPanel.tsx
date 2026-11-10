"use client";

// The portfolio, condensed into a side column — About's left column.
//
// Title, the counts, category chips on ONE line, a two-column grid of the first
// photographs and a link to the full page. The chips scroll sideways rather
// than wrap, however many categories the portfolio grows.

import { useMemo, useState } from "react";
import Link from "next/link";
import PhotoGrid from "@/src/components/common/PhotoGrid";
import ChipRow from "@/src/components/common/ChipRow";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { ABOUT_PER_VIEW, workView, type WorkPhoto, type WorkPreview } from "@/src/lib/work-preview";

export default function PortfolioPanel({
  work,
  albumsCount,
  onOpen,
}: {
  work: WorkPreview;
  albumsCount: number;
  onOpen: (photos: WorkPhoto[], index: number) => void;
}) {
  const { t, locale } = useT();
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
    <section aria-labelledby="panel-portfolio" className="flex flex-col gap-3 rounded-2xl bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 id="panel-portfolio" className="text-xl font-bold tracking-tight">{t("portfolio.title")}</h2>
        <p className="text-[13px] leading-snug text-muted-foreground">{t("portfolio.subtitle")}</p>
      </div>

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

      <Link
        href={`/${locale}/portfolio`}
        className="text-[13px] font-semibold text-accent-warm underline-offset-2 hover:underline"
      >
        {t("aboutPage.openPortfolio")} →
      </Link>
    </section>
  );
}
