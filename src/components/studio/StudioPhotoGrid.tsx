"use client";

// The Photos tab's grid: the photographs, which one is the cover, and
// choosing some to delete.
//
// Select switches the tiles into choosing: a click picks a photo, Shift-click
// picks everything between it and the last one picked. The bar above the
// grid stays in view while choosing, with the count, Select all, Delete
// (which asks once more) and Done. Esc leaves.

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { deletePhotos, setCover, type DeletePhotosState } from "@/src/app/studio/gallery-actions";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { StudioPhoto } from "@/src/lib/studio/gallery";
import { PendingButton } from "./FormFeedback";

const SMALL =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const SMALL_QUIET = `${SMALL} bg-foreground/6 text-foreground hover:bg-foreground/12`;
const SMALL_DANGER = `${SMALL} border border-destructive text-destructive hover:ring-1 hover:ring-destructive`;
const LINK = "whitespace-nowrap text-[13px] font-medium text-foreground underline-offset-4 hover:underline";

export default function StudioPhotoGrid({ galleryId, photos }: { galleryId: string; photos: StudioPhoto[] }) {
  const { t } = useT();
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [armed, setArmed] = useState(false);
  const lastPicked = useRef<number | null>(null);

  const stop = () => {
    setSelecting(false);
    setChosen(new Set());
    setArmed(false);
    lastPicked.current = null;
  };

  const [state, action, pending] = useActionState<DeletePhotosState, FormData>(async (prev, form) => {
    const result = await deletePhotos(prev, form);
    if (result.ok) {
      setSelecting(false);
      setChosen(new Set());
      lastPicked.current = null;
    }
    setArmed(false);
    return result;
  }, {});

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelecting(false);
      setChosen(new Set());
      setArmed(false);
      lastPicked.current = null;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  // Photos that went away (deleted, or the page refreshed) are not counted.
  const picked = photos.filter((p) => chosen.has(p.id));
  const n = picked.length;

  function pick(index: number, range: boolean) {
    const id = photos[index].id;
    setArmed(false);
    setChosen((prev) => {
      const next = new Set(prev);
      if (range && lastPicked.current !== null && lastPicked.current !== index) {
        const [a, b] = [lastPicked.current, index].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(photos[i].id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastPicked.current = index;
  }

  const done = !pending && state.ok && state.deleted ? state.deleted : 0;

  return (
    <>
      <form
        action={action}
        className={
          selecting
            ? "sticky top-12 z-20 -mx-4 flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0 lg:-mx-10 lg:px-10"
            : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        }
      >
        <input type="hidden" name="galleryId" value={galleryId} />
        {picked.map((p) => (
          <input key={p.id} type="hidden" name="photo" value={p.id} />
        ))}

        {selecting ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm font-semibold tabular-nums" aria-live="polite">
                {t("gallery.photos.selected", { n })}
              </span>
              {n < photos.length ? (
                <button type="button" className={LINK} onClick={() => setChosen(new Set(photos.map((p) => p.id)))}>
                  {t("gallery.photos.selectAll")}
                </button>
              ) : (
                <button type="button" className={LINK} onClick={() => setChosen(new Set())}>
                  {t("gallery.photos.selectNone")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Keyed: without it React would turn the Delete button into the
                  submit button during its own click, and the click would send
                  the form before the question was asked. */}
              {armed && n > 0 ? (
                <>
                  <button key="yes" type="submit" disabled={pending} className={SMALL_DANGER}>
                    {t(n === 1 ? "gallery.photos.deleteConfirmOne" : "gallery.photos.deleteConfirmMany", { n })}
                  </button>
                  <button key="no" type="button" disabled={pending} className={SMALL_QUIET} onClick={() => setArmed(false)}>
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button key="delete" type="button" disabled={n === 0} className={SMALL_DANGER} onClick={() => setArmed(true)}>
                    {t("gallery.photos.delete")}
                  </button>
                  <button key="done" type="button" className={SMALL_QUIET} onClick={stop}>
                    {t("gallery.photos.done")}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="min-w-0 text-sm text-muted-foreground">{t("gallery.photos.coverHint")}</p>
            <button type="button" className={SMALL_QUIET} onClick={() => setSelecting(true)}>
              {t("gallery.photos.select")}
            </button>
          </>
        )}
      </form>

      <p role={state.error ? "alert" : "status"} className="mt-2 min-h-5 text-sm">
        {!pending && state.error && (
          <span className="flex items-start gap-2 text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t(`errors.${state.error}`)}</span>
          </span>
        )}
        {done > 0 && !selecting && (
          <span className="flex items-start gap-1.5 text-muted-foreground">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{t(done === 1 ? "gallery.photos.deletedOne" : "gallery.photos.deletedMany", { n: done })}</span>
          </span>
        )}
        {selecting && n === 0 && !state.error && (
          <span className="text-muted-foreground">{t("gallery.photos.selectHint")}</span>
        )}
      </p>

      <ul className="mt-2 grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 sm:gap-x-3 lg:grid-cols-5 2xl:grid-cols-6">
        {photos.map((photo, index) => {
          const on = chosen.has(photo.id);
          const frame = (
            <div
              className={`relative overflow-hidden rounded-lg ring-1 ${on ? "ring-2 ring-accent-warm" : "ring-border"}`}
            >
              <PhotoFrame
                ladder={photo.ladder}
                thumbhash={photo.thumbhash}
                alt={photo.fileName}
                sizes="(min-width: 1536px) 14vw, (min-width: 1024px) 17vw, (min-width: 640px) 23vw, 31vw"
                className={`aspect-square w-full transition ${on ? "scale-[0.94] rounded-md" : ""}`}
              />
              {photo.isCover && (
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-1 text-[11px] font-medium leading-none text-white">
                  {t("gallery.photos.cover")}
                </span>
              )}
              {selecting && (
                <span
                  aria-hidden
                  className={`absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border-2 ${
                    on ? "border-accent-warm bg-accent-warm text-white" : "border-white bg-black/30"
                  }`}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
              )}
            </div>
          );
          return (
            <li key={photo.id} className="min-w-0">
              {selecting ? (
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={photo.fileName}
                  onClick={(e) => pick(index, e.shiftKey)}
                  className="block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {frame}
                </button>
              ) : (
                frame
              )}
              <p className="mt-1.5 truncate text-xs text-muted-foreground" title={photo.fileName}>
                {photo.fileName}
              </p>
              {!selecting && !photo.isCover && (
                <form action={setCover}>
                  <input type="hidden" name="galleryId" value={galleryId} />
                  <input type="hidden" name="photo" value={photo.id} />
                  <PendingButton className="text-left text-[13px] text-accent-warm underline-offset-4 hover:underline disabled:opacity-60">
                    {t("gallery.photos.setCover")}
                  </PendingButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
