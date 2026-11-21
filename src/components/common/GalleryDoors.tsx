"use client";

// The three doors in the About page's Portfolio section: Galleries, Client
// galleries and Private gallery. Each opens GalleryPickerSheet in its mode.
//
// 2026-11-22: moved from the Portfolio page (removed) and made small, side by
// side in one row, square-ish corners, a little taller than a line of text.
// A long name ("Клиентские галереи") takes two short lines rather than being
// cut. The count follows the name; the private door has the brand-red lock
// (a private gallery's cover is never shown outside its passkey).

import { KeyRound } from "lucide-react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { AlbumData } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";

export type Door = "albums" | "public" | "private";

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

  const doors: { id: Door; label: string; hint: string; count: number }[] = [
    { id: "albums", label: t("portfolio.galleries"), hint: t("portfolio.galleriesHint"), count: albums.length },
    { id: "public", label: t("portfolio.clientGalleries"), hint: t("portfolio.clientGalleriesHint"), count: open.length },
    { id: "private", label: t("portfolio.privateGallery"), hint: t("portfolio.privateGalleryHint"), count: locked.length },
  ];

  return (
    <div className={`grid grid-cols-3 gap-1.5 ${className}`}>
      {doors.map(({ id, label, hint, count }) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(id)}
          title={hint}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-foreground/6 px-2 py-1.5 text-center ring-1 ring-border transition
            hover:bg-foreground/10 hover:ring-foreground/25 active:scale-[0.98]"
        >
          {id === "private" && <KeyRound aria-hidden className="size-3.5 shrink-0 text-primary" />}
          <span className="text-[12px] font-semibold leading-tight text-foreground">
            {label}
            {count > 0 && <span className="ml-1 font-medium tabular-nums text-muted-foreground">{count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
