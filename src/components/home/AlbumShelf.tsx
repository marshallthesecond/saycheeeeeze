"use client";

// One whole album on Home, in a row that scrolls sideways (2026-11-17).
//
// A different album each visit: the server hands over a few albums, picked at
// random every time the page is rebuilt (every five minutes), and the browser
// shows one of them, never the one it showed last time (remembered in
// localStorage). The first render always shows the first of them, so the
// server and the browser agree; the switch happens straight after, well
// below the fold on a phone.
//
// Under each photograph: its place in the album ("07 of 24") and the album's
// name and date, like tracks under a playlist. A tap opens it full screen; an
// album longer than the row ends with a card to the album itself.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { AlbumPhoto } from "@/src/lib/albums";

export interface ShelfAlbum {
  slug: string;
  title: string;
  /** As the album page shows it; empty when the album has none. */
  date: string;
  /** Photographs in the whole album, not only in this row. */
  total: number;
  photos: AlbumPhoto[];
}

const LAST_KEY = "home.shelf.last";

/** Small pieces of glass, like the controls on a gallery page. */
const GLASS_ICON =
  "btn-glass size-8 items-center justify-center text-foreground";
const GLASS_BUTTON =
  "btn-glass inline-flex h-8 items-center gap-1.5 whitespace-nowrap px-3 " +
  "text-[12px] font-medium text-foreground transition active:scale-95";

/**
 * The album chosen for this page load. Kept outside React so the choice is
 * made once: React runs effects twice in development, and a second draw would
 * read the first one back as "last time" and could land on the album the
 * visitor saw on their previous visit.
 */
let chosenThisLoad: string | null = null;

/** Pick one, not the one shown last time when there is a choice. */
function chooseIndex(albums: ShelfAlbum[]): number {
  const already = albums.findIndex((a) => a.slug === chosenThisLoad);
  if (already !== -1) return already;
  if (albums.length < 2) return 0;
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(LAST_KEY);
  } catch {
    // Storage blocked: any album will do.
  }
  const options = albums.map((_, i) => i).filter((i) => albums[i].slug !== last);
  return options[Math.floor(Math.random() * options.length)] ?? 0;
}

export default function AlbumShelf({
  albums,
  onOpen,
}: {
  albums: ShelfAlbum[];
  onOpen: (photos: AlbumPhoto[], index: number) => void;
}) {
  const { t, locale } = useT();
  const [index, setIndex] = useState(0);
  const row = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const i = chooseIndex(albums);
    chosenThisLoad = albums[i]?.slug ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chosen after hydration on purpose, see above
    setIndex(i);
    try {
      if (albums[i]) window.localStorage.setItem(LAST_KEY, albums[i].slug);
    } catch {
      // Not remembered: next visit may show the same album.
    }
  }, [albums]);

  const album = albums[index];
  if (!album) return null;

  const digits = String(album.total).length < 2 ? 2 : String(album.total).length;
  const number = (n: number) => String(n).padStart(digits, "0");
  const href = `/${locale}/albums/${album.slug}`;
  const scroll = (dir: number) => {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  const sub = [album.date, t("home.shelfPhotos", { n: album.total })].filter(Boolean).join(", ");

  return (
    <section aria-labelledby="shelf-h" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="shelf-h" className="truncate text-xl font-bold tracking-tight sm:text-2xl">
            {album.title}
          </h2>
          <p className="truncate text-[13px] text-muted-foreground">{sub}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label={t("home.shelfBack")}
            className={`${GLASS_ICON} hidden sm:flex`}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label={t("home.shelfForward")}
            className={`${GLASS_ICON} hidden sm:flex`}
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
          <Link href={href} className={GLASS_BUTTON}>
            {t("home.openAlbum")}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>

      <ul
        ref={row}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {album.photos.map((photo, i) => (
          <li key={`${album.slug}-${i}`} className="w-36 shrink-0 snap-start sm:w-44 lg:w-48">
            <button
              type="button"
              onClick={() => onOpen(album.photos, i)}
              className="group flex w-full flex-col gap-1.5 text-left"
            >
              <PhotoFrame
                ladder={photo.ladder}
                src={photo.src}
                thumbhash={photo.thumbhash}
                alt={t("home.shelfAlt", { n: i + 1, album: album.title })}
                sizes="(min-width: 1024px) 192px, (min-width: 640px) 176px, 144px"
                className="aspect-[4/5] w-full rounded-md"
                imgClassName="absolute inset-0 h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-90"
              />
              <span className="block min-w-0">
                <span className="block truncate text-[13px] font-semibold tabular-nums text-foreground">
                  {t("home.shelfNumber", { n: number(i + 1), total: album.total })}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[album.title, album.date].filter(Boolean).join(", ")}
                </span>
              </span>
            </button>
          </li>
        ))}
        {album.total > album.photos.length && (
          <li className="w-36 shrink-0 snap-start sm:w-44 lg:w-48">
            <Link
              href={href}
              className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-md bg-card px-3 text-center ring-1 ring-border transition hover:bg-foreground/6"
            >
              <ArrowRight aria-hidden className="size-5 text-foreground" />
              <span className="text-[13px] font-semibold text-foreground">
                {t("home.shelfAll", { n: album.total })}
              </span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
