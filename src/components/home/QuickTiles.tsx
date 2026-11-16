"use client";

// Home's eight ways into the site (2026-11-17, made small the same night):
// one piece of glass, four across and two rows, each an icon over its name,
// in the manner of the BottomNav and the controls on a gallery page.
//
// A name is never cut with an ellipsis: it may take a second line instead.
// On a phone this is the first thing under the header; from 1280px it is the
// left column.
//
// Book is marked in the brand colour, as the nav marks the page you are on.
// Services, the galleries and Studio open in place (a sheet or a note); the
// others are links.

import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface QuickTile {
  key: string;
  name: string;
  Icon: LucideIcon;
  /** Brand-coloured icon: the one tile that should catch the eye. */
  accent?: boolean;
  /** A page on this site, a link elsewhere (opens in a new tab), or an action. */
  href?: string;
  external?: boolean;
  onClick?: () => void;
}

const TILE =
  "flex min-h-14 min-w-0 flex-col items-center justify-start gap-1 rounded-xl px-1 pb-1.5 pt-2 text-center " +
  "text-foreground transition hover:bg-foreground/8 active:scale-95 active:bg-foreground/5 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

export default function QuickTiles({ tiles, label }: { tiles: QuickTile[]; label: string }) {
  return (
    <nav aria-label={label} className="sc-glass isolate rounded-2xl p-1">
      <ul className="grid grid-cols-4 gap-0.5">
        {tiles.map((tile) => (
          <li key={tile.key} className="min-w-0">
            <TileLink tile={tile}>
              <tile.Icon
                aria-hidden
                className={`size-5 shrink-0 ${tile.accent ? "text-accent-warm" : "text-foreground/75"}`}
                strokeWidth={1.75}
              />
              <span className="block w-full text-[11px] font-medium leading-tight [overflow-wrap:break-word]">
                {tile.name}
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
