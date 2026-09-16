// Masonry grid that preserves reading order: real columns filled shortest-first
// in source order. CSS columns fill top-to-bottom instead, which puts photo 1
// above photo 4 — scrambled, for a client scrolling their own shoot.
//
// Aspect ratios come from the stored width/height on each `photos` row, so the
// packing is correct on the FIRST render, server-side, before any image byte is
// requested. No re-flow, no layout shift.
//
// Photos whose dimensions could not be probed fall back to assuming 3:2 and
// correcting from naturalWidth/naturalHeight on load.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { thumbUrl } from "@/src/lib/gallery";
import MarkButtons, { MarkDot } from "./MarkButtons";
import type { PhotoMark } from "@/src/lib/photo-marks";
import {
  GRID_SIZES,
  blurStyle,
  fallbackSrc,
  hasLadder,
  srcSet,
  type LadderSources,
} from "@/src/lib/ladder";

export interface Photo {
  src: string;
  /** The photos row id. Required for marking; absent on portfolio albums. */
  id?: string;
  /** The client's request for this photograph — client galleries only. */
  mark?: PhotoMark | null;
  alt?: string;
  thumbSrc?: string;
  /** Intrinsic pixel size from the `photos` row, when it is known. */
  width?: number;
  height?: number;
  /** Pre-generated derivatives. Absent → render from src/thumbSrc as before. */
  ladder?: LadderSources;
  /** ThumbHash, base64. ~25 bytes. */
  thumbhash?: string;
}

interface PhotoGridProps {
  photos: Photo[];
  onPhotoClick?: (index: number) => void;
  gap?: number;
  /** Selection UI is only rendered when this is true. */
  selectable?: boolean;
  selectionMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (src: string) => void;
  /** Fired by long-press on touch, so mobile can enter selection without a toolbar trip. */
  onLongPress?: (src: string) => void;
  /**
   * Keep / Publish / Delete on each tile. Omit it and no tile renders any of
   * them — that is how the portfolio stays exactly as it was, rather than by a
   * flag someone has to remember to set to false.
   *
   * Called with null when the client presses the mark a photograph already
   * has, which un-marks it.
   */
  onMark?: (photoId: string, next: PhotoMark | null) => void;
  /** Ids with a request in flight, so their buttons disable. */
  markBusy?: Set<string>;
  /** tx(key, fallback) from the page — see MarkButtons. */
  tx?: (key: string, fallback: string) => string;
}

const LONG_PRESS_MS = 450;
const ASSUMED_RATIO = 1.5; // height / width, only when nothing better is known

/**
 * height / width, in order of trustworthiness: stored dimensions, then measured
 * from the loaded image, then the 3:2 assumption.
 *
 * Guarded against a zero width — one Infinity poisons the column heights and
 * every subsequent photo lands in the same column.
 */
function ratioOf(photo: Photo, measured: Record<string, number>): number {
  if (photo.width && photo.height && photo.width > 0) {
    return photo.height / photo.width;
  }
  return measured[photo.src] ?? ASSUMED_RATIO;
}

function columnsForWidth(w: number): number {
  if (w < 520) return 2;
  if (w < 900) return 3;
  if (w < 1400) return 4;
  return 5;
}

export default function PhotoGrid({
  photos,
  onPhotoClick,
  gap = 2,
  selectable = false,
  selectionMode = false,
  selected,
  onToggleSelect,
  onLongPress,
  onMark,
  markBusy,
  tx,
}: PhotoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);
  const [ratios, setRatios] = useState<Record<string, number>>({});

  // Column count follows the container, not the viewport — so the grid still
  // behaves if it's ever dropped into a narrower layout.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCols(columnsForWidth(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const noteRatio = useCallback((src: string, ratio: number) => {
    setRatios((prev) => (prev[src] ? prev : { ...prev, [src]: ratio }));
  }, []);

  // Greedy shortest-column packing, walked in source order.
  const columns = useMemo(() => {
    const buckets: { photo: Photo; index: number }[][] = Array.from(
      { length: cols },
      () => [],
    );
    const heights = new Array(cols).fill(0);

    photos.forEach((photo, index) => {
      let shortest = 0;
      for (let i = 1; i < cols; i++) {
        if (heights[i] < heights[shortest]) shortest = i;
      }
      buckets[shortest].push({ photo, index });
      heights[shortest] += ratioOf(photo, ratios);
    });

    return buckets;
  }, [photos, cols, ratios]);

  // A long-press that opens selection must not also count as a tap that opens
  // the lightbox, so the click handler checks this first.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFired = useRef(false);

  const startPress = useCallback(
    (src: string) => {
      if (!selectable || !onLongPress) return;
      pressFired.current = false;
      pressTimer.current = setTimeout(() => {
        pressFired.current = true;
        onLongPress(src);
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);
    },
    [selectable, onLongPress],
  );

  const cancelPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }, []);

  useEffect(() => cancelPress, [cancelPress]);

  if (photos.length === 0) return null;

  const thumbWidth = cols <= 2 ? 700 : cols <= 3 ? 620 : 520;

  return (
    <div ref={containerRef} className="flex w-full" style={{ gap: `${gap}px` }}>
      {columns.map((column, colIndex) => (
        <div
          key={colIndex}
          className="flex min-w-0 flex-1 flex-col"
          style={{ gap: `${gap}px` }}
        >
          {column.map(({ photo, index }) => {
            const isSelected = selected?.has(photo.src) ?? false;

            return (
              <div
                key={photo.src}
                className={`relative overflow-hidden bg-white/5 ${
                  onPhotoClick || selectable ? "cursor-pointer group" : ""
                }`}
                // The ThumbHash sits UNDER the image rather than being swapped
                // out when it loads, so there is no "loaded" state to track and
                // no fade to get wrong. It is also the whole error strategy:
                // onError below hides the img, which reveals the blur that was
                // already there instead of the browser painting alt text. Photos are opaque — JPEG, and AVIF/WebP
                // encoded without alpha — so the moment the real image paints it
                // covers the placeholder completely.
                //
                // Combined with the width/height attributes below, this is what
                // makes the grid feel instant: every tile has believable content
                // and correct geometry before a single photo byte arrives.
                style={blurStyle(photo.thumbhash)}
                onClick={() => {
                  if (pressFired.current) {
                    pressFired.current = false;
                    return;
                  }
                  if (selectionMode) onToggleSelect?.(photo.src);
                  else onPhotoClick?.(index);
                }}
                onTouchStart={() => startPress(photo.src)}
                onTouchEnd={cancelPress}
                onTouchMove={cancelPress}
                onContextMenu={(e) => {
                  // Stop Android's long-press image menu from fighting our own.
                  if (selectable) e.preventDefault();
                }}
              >
                {/* Format negotiation happens HERE, in the HTML, not at the
                    edge. The browser picks AVIF or WebP from these <source>
                    elements, which means every URL maps to exactly one file and
                    the CDN never has to vary on Accept. That single decision is
                    what makes an edge transform layer unnecessary — it is the
                    whole reason the Optimizer can be switched off.

                    No ladder yet (or NEXT_PUBLIC_IMAGE_MODE=legacy) and the
                    <source> elements simply are not emitted, so the <img> falls
                    back to the Optimizer URL exactly as before. That is the
                    dual-read: both paths live side by side until every row has
                    variants. */}
                <picture>
                  {hasLadder(photo.ladder) && (
                    <source
                      type="image/avif"
                      sizes={GRID_SIZES}
                      srcSet={srcSet(photo.ladder, "avif")}
                    />
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                  src={
                    hasLadder(photo.ladder)
                      ? fallbackSrc(photo.ladder)
                      : photo.thumbSrc ?? thumbUrl(photo.src, thumbWidth)
                  }
                  srcSet={
                    hasLadder(photo.ladder)
                      ? srcSet(photo.ladder, "webp")
                      : undefined
                  }
                  sizes={hasLadder(photo.ladder) ? GRID_SIZES : undefined}
                  alt={photo.alt ?? ""}
                  // With `h-auto w-full` in the class list, these two attributes
                  // give the browser an aspect ratio to reserve space from
                  // before the bytes arrive. This is what actually removes the
                  // layout shift — the column packing above only decides which
                  // column a photo lands in, not how tall its box is while it
                  // loads. Omitted entirely when unknown, because a wrong pair
                  // is worse than none.
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                  // Hiding the img uncovers the ThumbHash already painted on
                  // the wrapper. The alt attribute stays for screen readers —
                  // it just stops being drawn. Safe to mutate the node directly:
                  // the wrapper is keyed on photo.src, so a different photograph
                  // is a different element and cannot inherit this.
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                  onLoad={(e) => {
                    e.currentTarget.style.visibility = "";
                    // Only needed for photos with no stored dimensions. Skipping
                    // it otherwise avoids a pointless setState per image on
                    // every gallery render.
                    if (photo.width && photo.height) return;
                    const img = e.currentTarget;
                    if (img.naturalWidth > 0) {
                      noteRatio(photo.src, img.naturalHeight / img.naturalWidth);
                    }
                  }}
                  className={`block h-auto w-full transition-[filter,transform,opacity] duration-200 ${
                    isSelected ? "scale-[0.94] opacity-80" : ""
                  } ${
                    onPhotoClick || selectable
                      ? "group-hover:brightness-75 group-active:brightness-50"
                      : ""
                  }`}
                  />
                </picture>

                {/* Marking. Always visible rather than revealed on hover:
                    this is the job the client came to do, and on a phone there
                    is no hover to reveal anything with. The row sits at the
                    bottom so it never covers a face, and the tile's own click
                    handler is stopped inside MarkButtons. */}
                {onMark && photo.id && tx && (
                  <>
                    <MarkDot mark={photo.mark ?? null} />
                    <div className="absolute inset-x-0 bottom-0 flex justify-center pb-1.5">
                      <MarkButtons
                        variant="tile"
                        tx={tx}
                        mark={photo.mark ?? null}
                        busy={markBusy?.has(photo.id) ?? false}
                        onMark={(next) => onMark(photo.id as string, next)}
                      />
                    </div>
                  </>
                )}

                {selectable && (
                  <>
                    {isSelected && (
                      <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white" />
                    )}
                    <button
                      type="button"
                      aria-label={isSelected ? "Deselect photo" : "Select photo"}
                      aria-pressed={isSelected}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect?.(photo.src);
                      }}
                      className={`absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border transition ${
                        isSelected
                          ? "border-white bg-white text-black"
                          : "border-white/60 bg-black/30 text-transparent backdrop-blur-sm hover:border-white"
                      } ${
                        selectionMode || isSelected
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      }`}
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}