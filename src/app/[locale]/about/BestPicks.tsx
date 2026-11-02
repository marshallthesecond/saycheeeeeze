"use client";

// The "Best picks" grid on the About page — Marshall's sketch of 2026-11-02.
//
// Feature tile, a staggered pair of columns beside it, masonry below, a
// caption under every photograph and a "Load more" pill. The geometry lives in
// best-picks.ts; this file only renders it.
//
// INSTAGRAM-TIGHT, on request: 2px between columns, no side padding, no
// rounded corners. The captions are what separate one row from the next, so
// there is no vertical gap either — the space under each photograph is its
// caption.
//
// TWO LAYOUTS IN THE DOM, toggled by breakpoint, rather than one layout that
// re-flows. The masonry has to know how many columns it has in order to decide
// which column each photograph goes in, and CSS cannot tell it; measuring
// after mount would make the server render one layout and the browser another.
// Every image is loading="lazy", and a lazy image under display:none has no
// box, never intersects the viewport and is never fetched — so the hidden
// layout costs DOM, not bandwidth. Verified in Chromium when this was built.

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { AlbumPhoto } from "@/src/lib/albums";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import {
  FALLBACK_RATIO,
  INITIAL_VISIBLE,
  LOAD_STEP,
  masonry,
  planDesktop,
} from "./best-picks";

export interface PickItem {
  /** Position in BEST_PICKS — what the lightbox is opened at. */
  index: number;
  photo: AlbumPhoto;
  /** width / height, or FALLBACK_RATIO when the database has no dimensions. */
  ratio: number;
  category: string;
  /** Already formatted for the reader's language; empty for none. */
  date: string;
  title?: string;
  alt: string;
}

interface Props {
  heading: string;
  items: PickItem[];
  loadMoreLabel: string;
  fullPortfolioLabel: string;
  portfolioHref: string;
  onOpen: (index: number) => void;
}

/** Above 1600px the grid stops growing; the sizes below follow that cap. */
const FEATURE_SIZES = "(min-width: 1600px) 800px, (min-width: 640px) 50vw, 100vw";
const TILE_SIZES = "(min-width: 1600px) 400px, (min-width: 640px) 25vw, 50vw";

export default function BestPicks({
  heading,
  items,
  loadMoreLabel,
  fullPortfolioLabel,
  portfolioHref,
  onOpen,
}: Props) {
  const [visible, setVisible] = useState(INITIAL_VISIBLE);

  // Planned from the WHOLE list, then trimmed — not planned from the visible
  // slice. The four beside the feature are picked by shape, so planning only
  // what is visible would let a newly loaded landscape frame claim a short
  // slot and shuffle the block above the button the moment it was pressed.
  // This way "Load more" only ever appends below.
  const desktop = useMemo(() => planDesktop(items), [items]);

  const blockCount = 1 + desktop.staggered.filter(Boolean).length;
  const desktopCols = useMemo(
    () => masonry(desktop.rest.slice(0, Math.max(0, visible - blockCount)), 4),
    [desktop, visible, blockCount],
  );
  const phoneCols = useMemo(() => masonry(items.slice(1, visible), 2), [items, visible]);

  if (items.length === 0) return null;

  const hasMore = visible < items.length;
  const [a, b, c, d] = desktop.staggered;
  const stagger = Boolean(a && b && c && d);

  return (
    <section className="relative z-10 mt-8 sm:mt-10">
      <h2 className="px-4 sm:px-8 mb-3 text-2xl sm:text-3xl font-extrabold tracking-tight">
        {heading}
      </h2>

      <div className="mx-auto max-w-[1600px]">
        {/* Phone — feature full width, then two columns of masonry. */}
        <div className="sm:hidden">
          <Tile item={items[0]} mode="feature" sizes={FEATURE_SIZES} onOpen={onOpen} />
          <Columns cols={phoneCols} onOpen={onOpen} />
        </div>

        {/* 640px and up — the sketch. */}
        <div className="hidden sm:block">
          {stagger ? (
            // Three equal rows, and the feature spans all of them. The rows
            // take their height from the feature — the only cell with an
            // intrinsic height, a square photograph plus its caption — so the
            // short and tall cells beside it divide that height into thirds
            // and their bottoms land exactly on the feature's.
            <div className="grid grid-cols-4 grid-rows-3 gap-x-[2px]">
              <Tile
                item={items[0]}
                mode="feature"
                sizes={FEATURE_SIZES}
                onOpen={onOpen}
                className="col-start-1 col-span-2 row-start-1 row-span-3"
              />
              <Tile item={a!} mode="fill" sizes={TILE_SIZES} onOpen={onOpen} className="col-start-3 row-start-1 row-span-1" />
              <Tile item={b!} mode="fill" sizes={TILE_SIZES} onOpen={onOpen} className="col-start-3 row-start-2 row-span-2" />
              <Tile item={c!} mode="fill" sizes={TILE_SIZES} onOpen={onOpen} className="col-start-4 row-start-1 row-span-2" />
              <Tile item={d!} mode="fill" sizes={TILE_SIZES} onOpen={onOpen} className="col-start-4 row-start-3 row-span-1" />
            </div>
          ) : (
            // Under five photographs there is no block to build: the feature
            // takes the left half and the rest fall into the masonry below.
            <div className="grid grid-cols-4 gap-x-[2px]">
              <Tile item={items[0]} mode="feature" sizes={FEATURE_SIZES} onOpen={onOpen} className="col-span-2" />
            </div>
          )}
          <Columns cols={desktopCols} onOpen={onOpen} />
        </div>
      </div>

      <div className="mt-4 sm:mt-6 flex justify-center px-4">
        {hasMore ? (
          <button
            type="button"
            onClick={() => setVisible((v) => v + LOAD_STEP)}
            className={PILL}
          >
            {loadMoreLabel}
          </button>
        ) : (
          // Nothing left to load, so the pill goes where more of the work is
          // rather than disappearing — a button that vanishes reads as broken.
          <Link href={portfolioHref} className={PILL}>
            {fullPortfolioLabel}
          </Link>
        )}
      </div>
    </section>
  );
}

const PILL =
  "inline-flex h-10 items-center justify-center rounded-full bg-white/10 px-8 " +
  "text-[11px] font-bold uppercase tracking-[0.16em] text-white " +
  "transition hover:bg-white/16 active:scale-[0.98]";

function Columns({ cols, onOpen }: { cols: PickItem[][]; onOpen: (i: number) => void }) {
  if (cols.every((c) => c.length === 0)) return null;
  return (
    <div className="flex items-start gap-x-[2px]">
      {cols.map((col, n) => (
        <div key={n} className="flex min-w-0 flex-1 flex-col">
          {col.map((item) => (
            <Tile key={item.index} item={item} mode="natural" sizes={TILE_SIZES} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One photograph and its caption.
 *
 *   feature  square photo, larger caption. In flow, so its height is what
 *            the rows beside it are sized from.
 *   fill     the photo takes whatever height its grid cell has left after the
 *            caption, cropped to fit — the stagger's short and tall slots.
 *   natural  the photo at its own aspect ratio, uncropped — the masonry.
 */
function Tile({
  item,
  mode,
  sizes,
  onOpen,
  className = "",
}: {
  item: PickItem;
  mode: "feature" | "fill" | "natural";
  sizes: string;
  onOpen: (i: number) => void;
  className?: string;
}) {
  const { photo } = item;
  const big = mode === "feature";

  const frameStyle: CSSProperties = {
    ...blurStyle(photo.thumbhash),
    ...(mode === "natural" ? { aspectRatio: String(item.ratio || FALLBACK_RATIO) } : null),
  };

  return (
    <button
      type="button"
      onClick={() => onOpen(item.index)}
      // w-full is not optional. A <button> shrink-wraps its content even when
      // it is display:flex, so outside a grid or a stretching flex parent the
      // phone's feature tile came out 109px wide — the width of its caption.
      className={`group flex w-full min-w-0 flex-col text-left ${mode === "fill" ? "min-h-0" : ""} ${className}`}
    >
      <span
        className={
          "relative block w-full overflow-hidden bg-white/5 " +
          (big ? "aspect-square" : mode === "fill" ? "min-h-0 flex-1" : "")
        }
        style={frameStyle}
      >
        {hasLadder(photo.ladder) ? (
          <picture>
            <source type="image/avif" sizes={sizes} srcSet={srcSet(photo.ladder, "avif")} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fallbackSrc(photo.ladder)}
              srcSet={srcSet(photo.ladder, "webp")}
              sizes={sizes}
              alt={item.alt}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-90"
            />
          </picture>
        ) : (
          // No ladder row for this path: the plain CDN URL, as everywhere else
          // on the site, so a missing build stays visible instead of blank.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.src}
            alt={item.alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </span>

      <span className={`block shrink-0 ${big ? "px-3 sm:px-3 pt-2 pb-4 sm:pb-5" : "px-1.5 sm:px-2 pt-1.5 pb-3 sm:pb-4"}`}>
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate font-semibold text-white/90 ${big ? "text-xs sm:text-[13px]" : "text-[10px] sm:text-[11px]"}`}>
            {item.category}
          </span>
          {item.date && (
            <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums text-white/50 ${big ? "text-xs sm:text-[13px]" : "text-[10px] sm:text-[11px]"}`}>
              {item.date}
            </span>
          )}
        </span>
        {/* The title line is ALWAYS there, empty or not. In the staggered
            block every cell ends on the same line and the photo takes what the
            caption leaves, so a caption one line shorter made its photograph
            18px taller than its neighbour's and the bottoms stopped lining up
            — visible at once beside a feature whose caption has a title. */}
        <span
          aria-hidden={item.title ? undefined : true}
          className={
            `mt-0.5 block truncate italic text-white/65 ${big ? "text-sm sm:text-base" : "text-[11px] sm:text-xs"}` +
            (item.title ? "" : " invisible")
          }
        >
          {item.title || " "}
        </span>
      </span>
    </button>
  );
}
