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
//
// That is the default layout, "masonry", and the only one the portfolio uses.
// A gallery page can ask for two more: "grid", equal squares with space around
// them and the file name underneath, and "list", one row per file the way a
// file manager shows a folder. All three share the same tap, long-press,
// selection and marking behaviour, which is why they live in one component.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { thumbUrl } from "@/src/lib/gallery";
import { formatBytes } from "@/src/lib/ladder";
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
  /** The name the file was uploaded under ("3M0A1432.png"). */
  fileName?: string;
  /** Bytes per download size, when the worker recorded them. */
  sizes?: { share?: number; full?: number; original?: number };
}

export type GridLayout = "masonry" | "grid" | "list";

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
  /** How the photographs are laid out. Default "masonry". */
  layout?: GridLayout;
  /**
   * Masonry only: a line under each photograph, its marks on the left and its
   * file name on the right. The marks then leave the photograph itself. Grid
   * and list always show the name, so this does nothing there.
   */
  captions?: boolean;
}

/** Height of the line under a photograph, in px. Also used by the packing. */
const CAPTION_PX = 32;

/** The name to show for a file: the stored one, else the last piece of its address. */
function photoName(photo: Photo): string {
  if (photo.fileName) return photo.fileName;
  const last = photo.src.split("?")[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** "6000 × 4000", or "" when the size was never read. */
function photoDimensions(photo: Photo): string {
  return photo.width && photo.height ? `${photo.width} × ${photo.height}` : "";
}

/** The size of the file as uploaded when known, else of the largest copy offered. */
function photoBytes(photo: Photo): string {
  const bytes = photo.sizes?.original ?? photo.sizes?.full ?? photo.sizes?.share;
  return typeof bytes === "number" ? formatBytes(bytes) : "";
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
  layout = "masonry",
  captions = false,
}: PhotoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);
  // Only used to weigh the caption line against the photographs when packing.
  const [containerWidth, setContainerWidth] = useState(390);
  const [ratios, setRatios] = useState<Record<string, number>>({});

  // Column count follows the container, not the viewport — so the grid still
  // behaves if it's ever dropped into a narrower layout.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCols(columnsForWidth(entry.contentRect.width));
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Each layout renders its own root element, so observe again when it changes.
  }, [layout]);

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
    // A caption adds the same height to every tile, in the same unit as the
    // ratios (multiples of the column width). Without it a column of many
    // short photographs would be packed as if it were shorter than it is.
    const captionRatio = captions ? CAPTION_PX / Math.max(containerWidth / cols, 1) : 0;

    photos.forEach((photo, index) => {
      let shortest = 0;
      for (let i = 1; i < cols; i++) {
        if (heights[i] < heights[shortest]) shortest = i;
      }
      buckets[shortest].push({ photo, index });
      heights[shortest] += ratioOf(photo, ratios) + captionRatio;
    });

    return buckets;
  }, [photos, cols, ratios, captions, containerWidth]);

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
  const interactive = Boolean(onPhotoClick) || selectable;
  const label = (key: string, fallback: string) => (tx ? tx(key, fallback) : fallback);

  /** Tap, long-press and the Android image menu: the same for a tile and a row. */
  const pressHandlers = (photo: Photo, index: number) => ({
    onClick: () => {
      // A long-press that opened selection must not also count as a tap.
      if (pressFired.current) {
        pressFired.current = false;
        return;
      }
      if (selectionMode) onToggleSelect?.(photo.src);
      else onPhotoClick?.(index);
    },
    onTouchStart: () => startPress(photo.src),
    onTouchEnd: cancelPress,
    onTouchMove: cancelPress,
    onContextMenu: (e: React.MouseEvent) => {
      // Stop Android's long-press image menu from fighting our own.
      if (selectable) e.preventDefault();
    },
  });

  /**
   * The photograph itself.
   *
   * Format negotiation happens HERE, in the HTML, not at the edge. The browser
   * picks AVIF or WebP from the <source>, which means every URL maps to exactly
   * one file and the CDN never has to vary on Accept. No ladder yet and the
   * <source> is simply not emitted, so the <img> falls back to the Optimizer
   * URL as before.
   *
   * `natural` is the masonry case: the image keeps its own shape, so it carries
   * width/height (which is what reserves its space before the bytes arrive and
   * removes the layout shift) and reports its real ratio when none was stored.
   * Grid and list crop it into a fixed box instead.
   */
  const picture = (photo: Photo, sizes: string, className: string, natural: boolean) => (
    <picture>
      {hasLadder(photo.ladder) && (
        <source type="image/avif" sizes={sizes} srcSet={srcSet(photo.ladder, "avif")} />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={
          hasLadder(photo.ladder)
            ? fallbackSrc(photo.ladder)
            : photo.thumbSrc ?? thumbUrl(photo.src, thumbWidth)
        }
        srcSet={hasLadder(photo.ladder) ? srcSet(photo.ladder, "webp") : undefined}
        sizes={hasLadder(photo.ladder) ? sizes : undefined}
        alt={photo.alt ?? ""}
        width={natural ? photo.width : undefined}
        height={natural ? photo.height : undefined}
        loading="lazy"
        decoding="async"
        // Hiding the img uncovers the ThumbHash already painted on the wrapper.
        // Safe to mutate the node directly: the wrapper is keyed on photo.src.
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
        onLoad={(e) => {
          e.currentTarget.style.visibility = "";
          // Only needed for photos with no stored dimensions.
          if (!natural || (photo.width && photo.height)) return;
          const img = e.currentTarget;
          if (img.naturalWidth > 0) noteRatio(photo.src, img.naturalHeight / img.naturalWidth);
        }}
        className={className}
      />
    </picture>
  );

  /** The line under a photograph: its marks on the left, its file name on the right. */
  const caption = (photo: Photo) => {
    const name = photoName(photo);
    const marks = Boolean(onMark && photo.id && tx);
    return (
      <div className="flex min-w-0 items-center gap-1.5 px-0.5" style={{ height: CAPTION_PX }}>
        {onMark && photo.id && tx && (
          <MarkButtons
            variant="inline"
            tx={tx}
            mark={photo.mark ?? null}
            busy={markBusy?.has(photo.id) ?? false}
            onMark={(next) => onMark(photo.id as string, next)}
          />
        )}
        <span
          title={name}
          className={`min-w-0 flex-1 truncate text-[11px] text-muted-foreground ${marks ? "text-right" : ""}`}
        >
          {name}
        </span>
      </div>
    );
  };

  /** The round tick on a tile. `size` positions and sizes it for the layout. */
  const tick = (photo: Photo, isSelected: boolean, size: string) => (
    <button
      type="button"
      aria-label={isSelected ? "Deselect photo" : "Select photo"}
      aria-pressed={isSelected}
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect?.(photo.src);
      }}
      className={`absolute flex items-center justify-center rounded-full border transition ${size} ${
        isSelected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-white/60 bg-black/30 text-transparent backdrop-blur-sm hover:border-white"
      } ${
        selectionMode || isSelected
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }`}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </button>
  );

  // ---------------------------------------------------------------- list
  if (layout === "list") {
    return (
      <div ref={containerRef} className="px-3 sm:px-6">
        {/* Column names, where there is room for columns. */}
        <div className="hidden h-8 items-center gap-3 border-b border-border px-1 text-[11px] text-muted-foreground sm:flex">
          <span className="w-10 shrink-0" />
          <span className="min-w-0 flex-1">{label("gallery.colName", "Name")}</span>
          <span className="w-28 shrink-0 text-right">{label("gallery.colDimensions", "Dimensions")}</span>
          <span className="w-20 shrink-0 text-right">{label("gallery.colSize", "Size")}</span>
          {onMark && tx && <span className="w-[84px] shrink-0" />}
        </div>
        <ul className="divide-y divide-border">
          {photos.map((photo, index) => {
            const isSelected = selected?.has(photo.src) ?? false;
            const name = photoName(photo);
            const dimensions = photoDimensions(photo);
            const bytes = photoBytes(photo);
            const meta = [dimensions, bytes].filter(Boolean).join(", ");

            return (
              <li
                key={photo.src}
                className={`flex h-13 items-center gap-3 px-1 transition ${
                  interactive ? "cursor-pointer hover:bg-foreground/5" : ""
                } ${isSelected ? "bg-foreground/8" : ""}`}
                {...pressHandlers(photo, index)}
              >
                {selectable && (selectionMode || isSelected) && (
                  <button
                    type="button"
                    aria-label={isSelected ? "Deselect photo" : "Select photo"}
                    aria-pressed={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect?.(photo.src);
                    }}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-foreground/35 text-transparent"
                    }`}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </button>
                )}
                <div
                  className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-foreground/5"
                  style={blurStyle(photo.thumbhash)}
                >
                  {picture(photo, "40px", "absolute inset-0 h-full w-full object-cover", false)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-tight" title={name}>
                    {name}
                  </p>
                  {meta && (
                    <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground sm:hidden">
                      {meta}
                    </p>
                  )}
                </div>
                <span className="hidden w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {dimensions}
                </span>
                <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {bytes}
                </span>
                {onMark && photo.id && tx && (
                  <MarkButtons
                    variant="inline"
                    tx={tx}
                    mark={photo.mark ?? null}
                    busy={markBusy?.has(photo.id) ?? false}
                    onMark={(next) => onMark(photo.id as string, next)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // ---------------------------------------------------------------- grid
  if (layout === "grid") {
    return (
      <div
        ref={containerRef}
        className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 sm:grid-cols-3 sm:gap-x-4 sm:px-6 lg:grid-cols-4 xl:grid-cols-5"
      >
        {photos.map((photo, index) => {
          const isSelected = selected?.has(photo.src) ?? false;
          return (
            <div key={photo.src} className="min-w-0">
              <div
                className={`relative aspect-square overflow-hidden rounded-lg bg-foreground/5 ring-1 ${
                  isSelected ? "ring-2 ring-primary" : "ring-border"
                } ${interactive ? "cursor-pointer group" : ""}`}
                style={blurStyle(photo.thumbhash)}
                {...pressHandlers(photo, index)}
              >
                {picture(
                  photo,
                  GRID_SIZES,
                  `absolute inset-0 h-full w-full object-cover transition-[filter,transform,opacity] duration-200 ${
                    isSelected ? "scale-[0.94] opacity-80" : ""
                  } ${interactive ? "group-hover:brightness-90 group-active:brightness-75" : ""}`,
                  false,
                )}
                {selectable && tick(photo, isSelected, "left-1.5 top-1.5 h-6 w-6")}
              </div>
              {caption(photo)}
            </div>
          );
        })}
      </div>
    );
  }

  // ---------------------------------------------------------------- masonry
  return (
    <div
      ref={containerRef}
      className="flex w-full"
      style={{ gap: `${gap}px`, paddingInline: captions ? `${gap}px` : undefined }}
    >
      {columns.map((column, colIndex) => (
        <div
          key={colIndex}
          className="flex min-w-0 flex-1 flex-col"
          style={{ gap: captions ? 0 : `${gap}px` }}
        >
          {column.map(({ photo, index }) => {
            const isSelected = selected?.has(photo.src) ?? false;

            const tile = (
              <div
                key={captions ? undefined : photo.src}
                className={`relative overflow-hidden bg-foreground/5 ${
                  interactive ? "cursor-pointer group" : ""
                }`}
                // The ThumbHash sits UNDER the image rather than being swapped
                // out when it loads, so there is no "loaded" state to track and
                // no fade to get wrong. It is also the whole error strategy:
                // onError hides the img, which reveals the blur that was
                // already there instead of the browser painting alt text.
                style={blurStyle(photo.thumbhash)}
                {...pressHandlers(photo, index)}
              >
                {picture(
                  photo,
                  GRID_SIZES,
                  `block h-auto w-full transition-[filter,transform,opacity] duration-200 ${
                    isSelected ? "scale-[0.94] opacity-80" : ""
                  } ${interactive ? "group-hover:brightness-75 group-active:brightness-50" : ""}`,
                  true,
                )}

                {/* Marking laid over the photograph: only when there is no
                    caption line to carry it. Always visible rather than
                    revealed on hover, because on a phone there is no hover. */}
                {!captions && onMark && photo.id && tx && (
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
                    {tick(photo, isSelected, "left-2 top-2 h-7 w-7")}
                  </>
                )}
              </div>
            );

            if (!captions) return tile;
            return (
              <div key={photo.src} className="min-w-0">
                {tile}
                {caption(photo)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}