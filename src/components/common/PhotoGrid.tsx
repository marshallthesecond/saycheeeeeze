// src/components/common/PhotoGrid.tsx
//
// Masonry grid that preserves reading order.
//
// The old version used CSS columns, which fill top-to-bottom per column —
// photo 1 sits above photo 4, not next to photo 2. For a portfolio nobody
// notices. For a client scrolling through their own shoot in the order it
// happened, it reads as scrambled.
//
// So: real columns, filled shortest-first in source order.
//
// ── Where aspect ratios come from ────────────────────────────
// Preferably from the database. Every `photos` row has stored width and height
// (sync-bunny.ts probes them at ingest), and those now travel to the client on
// the photo object. That means the column packing is CORRECT ON FIRST RENDER,
// server-side, before a single image byte has been requested — no reserved-space
// guess, no re-flow as photos arrive, no cumulative layout shift.
//
// The old behaviour is kept as a fallback for photos whose dimensions could not
// be probed: assume 3:2 portrait, then correct it from the image's own
// naturalWidth/naturalHeight once it loads. That path used to run for EVERY
// photo, which is why the grid visibly settled as you scrolled.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { thumbUrl } from "@/src/lib/gallery";
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
}

const LONG_PRESS_MS = 450;
const ASSUMED_RATIO = 1.5; // height / width, only when nothing better is known

/**
 * height / width for one photo, in order of trustworthiness:
 *   1. stored intrinsic dimensions  — known before any request is made
 *   2. measured from the loaded image — the old behaviour, now a fallback
 *   3. the 3:2 assumption
 *
 * Guarded against a zero or missing width because a divide by zero here
 * produces Infinity, and one Infinity poisons the column heights so badly that
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
                // no fade to get wrong. Photos are opaque — JPEG, and AVIF/WebP
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
                  onLoad={(e) => {
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