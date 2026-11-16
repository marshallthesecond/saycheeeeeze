"use client";

// The "Best picks" grid on the Home page — Marshall's sketch of 2026-11-02,
// with smaller photographs under the feature since 2026-11-17.
//
// Feature tile, a staggered pair of columns beside it, then one row of small
// photographs (six across on a computer, three rows of three on a phone), a
// caption under every photograph and a "Full portfolio" pill. The geometry
// lives in best-picks.ts; this file only renders it. No "Load more": the
// portfolio is one tap away and is where the rest of the work lives.
//
// INSTAGRAM-TIGHT, on request: 2px between columns, no side padding, no
// rounded corners. The captions are what separate one row from the next, so
// there is no vertical gap either — the space under each photograph is its
// caption. The small ones are all cropped to 4:5 so they line up as rows.
//
// TWO LAYOUTS IN THE DOM, toggled by breakpoint. Every image is
// loading="lazy", and a lazy image under display:none has no box, never
// intersects the viewport and is never fetched — so the hidden layout costs
// DOM, not bandwidth. Verified in Chromium when this was built.

import { useMemo, type CSSProperties } from "react";
import Link from "next/link";
import type { AlbumPhoto } from "@/src/lib/albums";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import { DESKTOP_ROW, PHONE_COLUMNS, PHONE_ROWS, planDesktop } from "./best-picks";

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
  items: PickItem[];
  fullPortfolioLabel: string;
  portfolioHref: string;
  onOpen: (index: number) => void;
  featureSizes: string;
  /** For the small photographs on a phone and on a computer. */
  phoneTileSizes: string;
  desktopTileSizes: string;
  className?: string;
}

export default function BestPicks({
  items,
  fullPortfolioLabel,
  portfolioHref,
  onOpen,
  featureSizes,
  phoneTileSizes,
  desktopTileSizes,
  className = "",
}: Props) {
  const desktop = useMemo(() => planDesktop(items), [items]);
  if (items.length === 0) return null;

  const [a, b, c, d] = desktop.staggered;
  const stagger = Boolean(a && b && c && d);
  const phoneSmall = items.slice(1, 1 + PHONE_COLUMNS * PHONE_ROWS);
  const desktopSmall = desktop.rest.slice(0, DESKTOP_ROW);

  return (
    <section className={className}>
      {/* Phone — feature full width, then three rows of three. */}
      <div className="sm:hidden">
        <Tile item={items[0]} mode="feature" sizes={featureSizes} onOpen={onOpen} />
        <div className="grid grid-cols-3 gap-x-0.5">
          {phoneSmall.map((item) => (
            <Tile key={item.index} item={item} mode="small" sizes={phoneTileSizes} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {/* 640px and up — the sketch, and a row of six under it. */}
      <div className="hidden sm:block">
        {stagger ? (
          // Three equal rows, and the feature spans all of them. The rows
          // take their height from the feature — the only cell with an
          // intrinsic height, a square photograph plus its caption — so the
          // short and tall cells beside it divide that height into thirds
          // and their bottoms land exactly on the feature's.
          <div className="grid grid-cols-4 grid-rows-3 gap-x-0.5">
            <Tile
              item={items[0]}
              mode="feature"
              sizes={featureSizes}
              onOpen={onOpen}
              className="col-start-1 col-span-2 row-start-1 row-span-3"
            />
            <Tile item={a!} mode="fill" sizes={desktopTileSizes} onOpen={onOpen} className="col-start-3 row-start-1 row-span-1" />
            <Tile item={b!} mode="fill" sizes={desktopTileSizes} onOpen={onOpen} className="col-start-3 row-start-2 row-span-2" />
            <Tile item={c!} mode="fill" sizes={desktopTileSizes} onOpen={onOpen} className="col-start-4 row-start-1 row-span-2" />
            <Tile item={d!} mode="fill" sizes={desktopTileSizes} onOpen={onOpen} className="col-start-4 row-start-3 row-span-1" />
          </div>
        ) : (
          // Under five photographs there is no block to build: the feature
          // takes the left half and the rest go in the row below.
          <div className="grid grid-cols-4 gap-x-0.5">
            <Tile item={items[0]} mode="feature" sizes={featureSizes} onOpen={onOpen} className="col-span-2" />
          </div>
        )}
        {desktopSmall.length > 0 && (
          <div className="grid grid-cols-6 gap-x-0.5">
            {desktopSmall.map((item) => (
              <Tile key={item.index} item={item} mode="small" sizes={desktopTileSizes} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-center px-4 sm:mt-5">
        <Link href={portfolioHref} className={PILL}>
          {fullPortfolioLabel}
        </Link>
      </div>
    </section>
  );
}

const PILL =
  "inline-flex h-10 items-center justify-center rounded-full bg-foreground/10 px-8 " +
  "text-[11px] font-bold uppercase tracking-[0.16em] text-foreground " +
  "transition hover:bg-foreground/16 active:scale-[0.98]";

/**
 * One photograph and its caption.
 *
 *   feature  square photo, larger caption. In flow, so its height is what
 *            the rows beside it are sized from.
 *   fill     the photo takes whatever height its grid cell has left after the
 *            caption, cropped to fit — the stagger's short and tall slots.
 *   small    4:5, cropped, smaller caption: the rows under the feature.
 */
function Tile({
  item,
  mode,
  sizes,
  onOpen,
  className = "",
}: {
  item: PickItem;
  mode: "feature" | "fill" | "small";
  sizes: string;
  onOpen: (i: number) => void;
  className?: string;
}) {
  const { photo } = item;
  const big = mode === "feature";

  const small = mode === "small";
  const frameStyle: CSSProperties | undefined = blurStyle(photo.thumbhash);

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
          "relative block w-full overflow-hidden bg-foreground/5 " +
          (big ? "aspect-square" : mode === "fill" ? "min-h-0 flex-1" : "aspect-[4/5]")
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

      <span
        className={`block shrink-0 ${
          big ? "px-3 pt-2 pb-4 sm:pb-5" : small ? "px-1 pt-1 pb-2.5 sm:px-1.5 sm:pb-3" : "px-1.5 pt-1.5 pb-3 sm:px-2 sm:pb-4"
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate font-semibold text-foreground/90 ${big ? "text-xs sm:text-[13px]" : "text-[10px] sm:text-[11px]"}`}>
            {item.category}
          </span>
          {item.date && (
            <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums text-muted-foreground ${big ? "text-xs sm:text-[13px]" : "text-[10px] sm:text-[11px]"}`}>
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
            `mt-0.5 block truncate italic text-foreground/65 ${big ? "text-sm sm:text-base" : "text-[11px] sm:text-xs"}` +
            (item.title ? "" : " invisible")
          }
        >
          {item.title || " "}
        </span>
      </span>
    </button>
  );
}
