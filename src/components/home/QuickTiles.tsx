"use client";

// The first thing on Home (2026-11-17): eight ways into the site, two across
// on a phone and four across from 640px.
//
// Each tile is a small photograph (or an icon, for the ones that are an
// action rather than a place), the name, and one line that is worth reading:
// a price, a count, how it works. That line is what makes them ours rather
// than a copy of a music app's shortcuts, and it answers the question a tap
// would otherwise be spent on.
//
// Most important first, read left to right: Book and Portfolio on top.
// Services, the galleries and Studio open in place (a sheet or a note);
// the others are links.

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LayoutDashboard, Lock, Send, type LucideIcon } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import type { AlbumPhoto } from "@/src/lib/albums";
import type { LadderSources } from "@/src/lib/ladder";

export type TileArt =
  | { kind: "photo"; photo?: Pick<AlbumPhoto, "src" | "ladder" | "thumbhash"> & { ladder?: LadderSources | null } }
  | { kind: "local"; src: string }
  | { kind: "icon"; Icon: LucideIcon; tone: "brand" | "quiet" };

export interface QuickTile {
  key: string;
  name: string;
  detail: string;
  art: TileArt;
  /** A page on this site, a link elsewhere (opens in a new tab), or an action. */
  href?: string;
  external?: boolean;
  onClick?: () => void;
}

export const TILE_ICONS = { Lock, Send, Studio: LayoutDashboard };

const TILE =
  "group flex h-14 min-w-0 items-center gap-2.5 overflow-hidden rounded-lg bg-card pr-2.5 text-left " +
  "ring-1 ring-border transition hover:bg-foreground/6 active:scale-[0.985] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-16";

export default function QuickTiles({ tiles, label }: { tiles: QuickTile[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.key} className="min-w-0">
            <TileLink tile={tile}>
              <Art art={tile.art} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold leading-tight text-foreground sm:text-sm">
                  {tile.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground sm:text-xs">
                  {tile.detail}
                </span>
              </span>
            </TileLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TileLink({ tile, children }: { tile: QuickTile; children: ReactNode }) {
  if (tile.href && tile.external) {
    return (
      <a href={tile.href} target="_blank" rel="noopener noreferrer" className={TILE}>
        {children}
      </a>
    );
  }
  if (tile.href) {
    return (
      <Link href={tile.href} className={TILE}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={tile.onClick} className={`${TILE} w-full`}>
      {children}
    </button>
  );
}

/** The square on the left: full tile height, flush with the edge. */
function Art({ art }: { art: TileArt }) {
  const box = "size-14 shrink-0 sm:size-16";
  if (art.kind === "photo") {
    return (
      <PhotoFrame
        ladder={art.photo?.ladder}
        src={art.photo?.src}
        thumbhash={art.photo?.thumbhash}
        alt=""
        sizes="64px"
        className={box}
      />
    );
  }
  if (art.kind === "local") {
    return (
      <span className={`relative overflow-hidden bg-muted ${box}`}>
        {/* Through next/image: a file in public/ may be a full-size original. */}
        <Image src={art.src} alt="" fill sizes="64px" className="object-cover" />
      </span>
    );
  }
  const { Icon } = art;
  return (
    <span
      className={`flex items-center justify-center ${box} ${
        art.tone === "brand" ? "bg-primary text-primary-foreground" : "bg-foreground/10 text-foreground"
      }`}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
    </span>
  );
}
