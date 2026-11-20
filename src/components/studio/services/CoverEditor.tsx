"use client";

// The cover of a service page: which photo, and where its subject sits. The
// page crops the photo to its own shape (square-ish on a phone, wide on a
// computer); the point chosen here stays in the crop.

import { useRef, useState } from "react";
import { Check, ImageIcon, X } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { bunnyUrl } from "@/src/lib/bunny-url";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import type { ServiceContent } from "@/src/lib/service-content";
import type { ServicePhoto } from "@/src/lib/studio/services";
import { listCoverChoices } from "@/src/app/studio/service-actions";
import { BUTTON_QUIET } from "../fields";
import { fieldId } from "./parts";

type Cover = ServiceContent["cover"];

function Picture({
  photo,
  path,
  alt,
  className,
  position,
  sizes,
}: {
  photo: ServicePhoto | undefined;
  path: string;
  alt: string;
  className: string;
  position?: string;
  sizes: string;
}) {
  const ladder = photo?.ladder;
  const style = position ? { objectPosition: position } : undefined;
  if (ladder && hasLadder(ladder)) {
    return (
      <picture>
        <source type="image/avif" sizes={sizes} srcSet={srcSet(ladder, "avif")} />
        <img src={fallbackSrc(ladder)} srcSet={srcSet(ladder, "webp")} sizes={sizes} alt={alt} className={className} style={style} />
      </picture>
    );
  }
  // A cover from the code that is in no album: straight from storage.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={bunnyUrl(path)} alt={alt} className={className} style={style} />;
}

export default function CoverEditor({
  cover,
  photo,
  onChange,
}: {
  cover: Cover;
  /** The current cover's photo, as the page was loaded. */
  photo: ServicePhoto | undefined;
  onChange: (cover: Cover) => void;
}) {
  const { t } = useT();
  // Photos seen so far by path: the one loaded with the page and any picked since.
  const [known, setKnown] = useState<Record<string, ServicePhoto>>(() => (photo ? { [photo.path]: photo } : {}));
  const shown = known[cover.path];
  const position = `${cover.x}% ${cover.y}%`;

  const setPoint = (x: number, y: number) =>
    onChange({ ...cover, x: Math.round(Math.min(100, Math.max(0, x))), y: Math.round(Math.min(100, Math.max(0, y))) });

  const onPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPoint(((e.clientX - box.left) / box.width) * 100, ((e.clientY - box.top) / box.height) * 100);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setPoint(cover.x + m[0], cover.y + m[1]);
  };

  return (
    <div id={fieldId("cover")} tabIndex={-1} className="outline-none">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* The whole photo: tap where the subject is. */}
        <div className="relative w-full max-w-xs shrink-0 self-start">
          <div
            role="slider"
            tabIndex={0}
            aria-label={t("services.cover.focus")}
            aria-valuetext={`${cover.x}%, ${cover.y}%`}
            aria-valuenow={cover.x}
            aria-valuemin={0}
            aria-valuemax={100}
            onPointerDown={onPoint}
            onPointerMove={(e) => {
              if (e.buttons === 1) onPoint(e);
            }}
            onKeyDown={onKey}
            className="relative cursor-crosshair touch-none overflow-hidden rounded-lg bg-foreground/6 ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
            // The photo's own shape, so the frame is the photo before it loads
            // and a point is a point on the photo.
            style={{
              aspectRatio: shown?.width && shown?.height ? `${shown.width} / ${shown.height}` : "3 / 2",
              ...blurStyle(shown?.thumbhash),
            }}
          >
            <Picture photo={shown} path={cover.path} alt="" className="absolute inset-0 h-full w-full select-none object-cover" sizes="320px" />
            <span
              aria-hidden
              className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
              style={{ left: `${cover.x}%`, top: `${cover.y}%` }}
            />
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{t("services.cover.hint")}</p>
        </div>

        {/* How the page crops it. */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-end gap-3">
            <figure className="w-24 shrink-0">
              <div className="aspect-square overflow-hidden rounded-md ring-1 ring-border" style={blurStyle(shown?.thumbhash)}>
                <Picture photo={shown} path={cover.path} alt="" className="h-full w-full object-cover" position={position} sizes="96px" />
              </div>
              <figcaption className="mt-1 text-xs text-muted-foreground">{t("services.cover.phone")}</figcaption>
            </figure>
            <figure className="min-w-0 flex-1">
              <div className="aspect-[2.2/1] overflow-hidden rounded-md ring-1 ring-border" style={blurStyle(shown?.thumbhash)}>
                <Picture photo={shown} path={cover.path} alt="" className="h-full w-full object-cover" position={position} sizes="320px" />
              </div>
              <figcaption className="mt-1 text-xs text-muted-foreground">{t("services.cover.computer")}</figcaption>
            </figure>
          </div>
          <CoverPicker
            current={cover.path}
            onPick={(p) => {
              setKnown((k) => ({ ...k, [p.path]: p }));
              onChange({ path: p.path, x: 50, y: 50 });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function CoverPicker({ current, onPick }: { current: string; onPick: (photo: ServicePhoto) => void }) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [choices, setChoices] = useState<ServicePhoto[] | "loading" | "failed">("loading");

  const open = async () => {
    dialog.current?.showModal();
    if (Array.isArray(choices)) return;
    setChoices("loading");
    const res = await listCoverChoices();
    setChoices(Array.isArray(res) ? res : "failed");
  };

  const albums = Array.isArray(choices)
    ? choices.reduce<Map<string, ServicePhoto[]>>((acc, p) => acc.set(p.album, [...(acc.get(p.album) ?? []), p]), new Map())
    : null;

  return (
    <>
      <div>
        <button type="button" className={BUTTON_QUIET} onClick={open}>
          <ImageIcon aria-hidden className="size-4" />
          {t("services.cover.change")}
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="cover-picker-title"
        className="m-auto max-h-[85dvh] w-[min(56rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-black/60"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 id="cover-picker-title" className="text-base font-semibold">
                {t("services.cover.pick")}
              </h2>
              <p className="text-[13px] text-muted-foreground">{t("services.cover.pickHint")}</p>
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label={t("services.cover.close")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-4">
            {choices === "loading" && <p className="text-sm text-muted-foreground">{t("services.cover.loading")}</p>}
            {choices === "failed" && <p className="text-sm text-destructive">{t("services.errors.failed")}</p>}
            {albums && albums.size === 0 && <p className="text-sm text-muted-foreground">{t("services.cover.none")}</p>}
            {albums &&
              [...albums.entries()].map(([album, photos]) => (
                <section key={album} className="mb-5 last:mb-0">
                  <h3 className="mb-2 truncate text-sm font-semibold">{album}</h3>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                    {photos.map((p) => {
                      const chosen = p.path === current;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            aria-pressed={chosen}
                            aria-label={p.fileName}
                            onClick={() => {
                              onPick(p);
                              dialog.current?.close();
                            }}
                            className={`relative block w-full overflow-hidden rounded-md ring-1 transition hover:opacity-90 ${chosen ? "ring-2 ring-accent-warm" : "ring-border"}`}
                          >
                            <PhotoFrame ladder={p.ladder} thumbhash={p.thumbhash} alt="" sizes="(min-width: 1024px) 140px, 30vw" className="aspect-square w-full" />
                            {chosen && (
                              <span className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-accent-warm text-white">
                                <Check aria-hidden className="size-3" strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
