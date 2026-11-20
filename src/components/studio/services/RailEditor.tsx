"use client";

// The photos at the bottom of a service page (and in graduation's hero), in
// their order. Not part of the draft: a move or a removal is live at once,
// like "Add to…" on a photo, which is where photos are added from.

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { ServicePhoto } from "@/src/lib/studio/services";
import { orderServicePhotos, removeServicePhoto } from "@/src/app/studio/service-actions";
import { move } from "./parts";

const ICON =
  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

export default function RailEditor({
  slug,
  initial,
  shows,
}: {
  slug: string;
  initial: ServicePhoto[];
  /** How many the page shows; the rest wait in line. */
  shows: number;
}) {
  const { t } = useT();
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (next: ServicePhoto[], call: () => Promise<{ ok: true } | { error: string }>) => {
    const before = photos;
    setPhotos(next);
    setBusy(true);
    setError(null);
    const res = await call();
    setBusy(false);
    if ("error" in res) {
      setPhotos(before);
      setError(t(`services.errors.${res.error}`));
    }
  };

  const reorder = (from: number, to: number) => {
    const next = move(photos, from, to);
    if (next === photos) return;
    void run(next, () => orderServicePhotos(slug, next.map((p) => p.id)));
  };

  const remove = (i: number) => {
    const photo = photos[i];
    void run(
      photos.filter((_, k) => k !== i),
      () => removeServicePhoto(slug, photo.id),
    );
  };

  return (
    <div>
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("services.rail.empty")}</p>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-muted-foreground">{t("services.rail.first", { n: shows })}</p>
          <ol className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5 lg:grid-cols-6" aria-busy={busy}>
            {photos.map((p, i) => (
              <li key={p.id} className={i >= shows ? "opacity-45" : undefined}>
                <PhotoFrame
                  ladder={p.ladder}
                  thumbhash={p.thumbhash}
                  alt={p.fileName}
                  sizes="(min-width: 1024px) 140px, 30vw"
                  className="aspect-[4/5] w-full rounded-md ring-1 ring-border"
                />
                <div className="mt-1 flex items-center justify-between">
                  <span className="pl-1 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="flex">
                    <button type="button" className={ICON} disabled={busy || i === 0} onClick={() => reorder(i, i - 1)} aria-label={`${t("services.rail.left")}: ${p.fileName}`} title={t("services.rail.left")}>
                      <ChevronLeft aria-hidden className="size-4" />
                    </button>
                    <button type="button" className={ICON} disabled={busy || i === photos.length - 1} onClick={() => reorder(i, i + 1)} aria-label={`${t("services.rail.right")}: ${p.fileName}`} title={t("services.rail.right")}>
                      <ChevronRight aria-hidden className="size-4" />
                    </button>
                    <button type="button" className={ICON} disabled={busy} onClick={() => remove(i)} aria-label={`${t("services.rail.remove")}: ${p.fileName}`} title={t("services.rail.remove")}>
                      <X aria-hidden className="size-4" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
