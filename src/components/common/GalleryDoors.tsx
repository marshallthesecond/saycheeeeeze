"use client";

// The three doors at the top of /portfolio (2026-11-14): Galleries, Client
// galleries and Private gallery. Each opens GalleryPickerSheet in its mode.
//
// They used to be two quiet grey tiles under the title, easy to miss. Now each
// is a raised card that shows what is behind it: up to three real covers for
// the albums and the open client galleries, a brand-red lock for the private
// ones (a private gallery's cover is never shown outside its passkey), the
// number of entries, and an arrow that fills red on hover.
//
// Phone: full-width rows, one under the other, one line of words each. From
// 640px: three cards side by side, the picture and the arrow on top, the words
// under them, the hint on up to two lines.

import { ArrowRight, Images, KeyRound, LibraryBig } from "lucide-react";
import PhotoFrame from "./PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { AlbumData } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { LadderSources } from "@/src/lib/ladder";

export type Door = "albums" | "public" | "private";

interface Cover {
  key: string;
  ladder?: LadderSources | null;
  src?: string | null;
  thumbhash?: string;
  accent?: string;
}

export default function GalleryDoors({
  albums,
  galleries,
  onOpen,
  className = "",
}: {
  albums: AlbumData[];
  galleries: GalleryListing[];
  onOpen: (door: Door) => void;
  className?: string;
}) {
  const { t } = useT();
  const open = galleries.filter((g) => g.visibility === "public" && !g.expired);
  const locked = galleries.filter((g) => g.visibility === "private" && !g.expired);

  const doors: {
    id: Door;
    label: string;
    hint: string;
    count: number;
    covers: Cover[];
    Icon: typeof Images;
  }[] = [
    {
      id: "albums",
      label: t("portfolio.galleries"),
      hint: t("portfolio.galleriesHint"),
      count: albums.length,
      covers: albums.slice(0, 3).map((a) => ({
        key: a.slug, ladder: a.coverLadder, src: a.cover, thumbhash: a.coverThumbhash, accent: a.color,
      })),
      Icon: LibraryBig,
    },
    {
      id: "public",
      label: t("portfolio.clientGalleries"),
      hint: t("portfolio.clientGalleriesHint"),
      count: open.length,
      covers: open.filter((g) => g.cover).slice(0, 3).map((g) => ({
        key: g.slug, ladder: g.coverLadder, src: g.cover, thumbhash: g.coverThumbhash, accent: g.accentColor,
      })),
      Icon: Images,
    },
    {
      id: "private",
      label: t("portfolio.privateGallery"),
      hint: t("portfolio.privateGalleryHint"),
      count: locked.length,
      covers: [],
      Icon: KeyRound,
    },
  ];

  return (
    <div className={`grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 ${className}`}>
      {doors.map(({ id, label, hint, count, covers, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(id)}
          className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-card p-3 text-left ring-1 ring-border
            shadow-[0_1px_2px_rgb(0_0_0/0.06),0_10px_24px_-14px_rgb(0_0_0/0.35)] transition duration-200
            hover:-translate-y-0.5 hover:ring-foreground/25 hover:shadow-[0_2px_4px_rgb(0_0_0/0.08),0_16px_32px_-14px_rgb(0_0_0/0.45)]
            active:translate-y-0 active:scale-[0.99]
            sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-3 sm:p-3.5"
        >
          {/* The picture: real covers where there are some, an icon otherwise. */}
          <span className="flex h-10 items-center sm:col-start-1 sm:row-start-1">
            {covers.length > 0 ? (
              <span className="flex -space-x-3">
                {covers.map((c) => (
                  <PhotoFrame
                    key={c.key}
                    ladder={c.ladder}
                    src={c.src}
                    thumbhash={c.thumbhash}
                    accent={c.accent}
                    alt=""
                    sizes="40px"
                    className="size-10 shrink-0 overflow-hidden rounded-lg ring-2 ring-card"
                  />
                ))}
              </span>
            ) : (
              <span
                className={`flex size-10 items-center justify-center rounded-xl ${
                  id === "private" ? "bg-primary text-primary-foreground" : "bg-foreground/8 text-foreground"
                }`}
              >
                <Icon className="size-5" />
              </span>
            )}
          </span>

          {/* The words. */}
          <span className="min-w-0 sm:col-span-2 sm:row-start-2">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-bold leading-tight text-foreground">{label}</span>
              {count > 0 && (
                <span className="shrink-0 rounded-full bg-foreground/8 px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {count}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground sm:mt-1 sm:line-clamp-2 sm:whitespace-normal">{hint}</span>
          </span>

          {/* The arrow fills with the brand red on hover. */}
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/6 text-foreground transition
              group-hover:bg-primary group-hover:text-primary-foreground sm:col-start-2 sm:row-start-1 sm:justify-self-end"
          >
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      ))}
    </div>
  );
}
