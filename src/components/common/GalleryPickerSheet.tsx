"use client";

//
// Opens from "Galleries", "Client galleries" and "Private gallery" on
// /portfolio, and from the private-gallery card on Home. Same bottom-sheet
// shape as GalleryRequestSheet.
//
// "albums" (2026-11-14) lists the portfolio's own albums, the same list as the
// Galleries card on Home; the other two modes list client galleries.
//
// A private tile shows a lock, a label you control via galleries.list_label, a
// date and a count — never a cover, never a client's name unless you published
// it. Anything more and the picker becomes the leak the passkey prevents.
//
// is_listed = false keeps a gallery out of the list entirely, reachable only by
// the link you send.

import { useEffect } from "react";
import PhotoFrame from "./PhotoFrame";
import Link from "next/link";
import { X, Lock, ChevronRight, Send, Images } from "lucide-react";

import { CONTACT } from "@/src/lib/gallery";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { AlbumData } from "@/src/lib/albums";
import { useT } from "@/src/lib/i18n/LanguageProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  /** "albums" lists the portfolio albums; "public" open client galleries;
   *  "private" the locked ones. */
  mode: "albums" | "public" | "private";
  galleries: GalleryListing[];
  /** Needed for the "albums" mode only. */
  albums?: AlbumData[];
  locale: string;
}

export default function GalleryPickerSheet({
  open,
  onClose,
  mode,
  galleries,
  albums = [],
  locale,
}: Props) {
  // Every string in this sheet was hardcoded English and reached /ru and /uz
  // untranslated. `locale` is still a prop because it builds the hrefs.
  const { t } = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const isAlbums = mode === "albums";
  const shown = isAlbums ? [] : galleries.filter((g) => g.visibility === mode && !g.expired);
  const isPrivate = mode === "private";

  const heading = t(isAlbums ? "picker.albumsHeading" : isPrivate ? "picker.privateHeading" : "picker.publicHeading");
  const blurb = t(isAlbums ? "picker.albumsBlurb" : isPrivate ? "picker.privateBlurb" : "picker.publicBlurb");

  return (
    <div
      className="fixed inset-0 z-70 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card ring-1 ring-border sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-6">
          <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="btn-glass flex h-9 w-9 items-center justify-center text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="px-6 text-sm text-muted-foreground">{blurb}</p>

        {isAlbums ? (
          albums.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t("picker.albumsEmpty")}</p>
          ) : (
            <ul className="mt-5 space-y-2 px-6 pb-6">
              {albums.map((album) => (
                <li key={album.slug}>
                  <Link
                    href={`/${locale}/albums/${album.slug}`}
                    onClick={onClose}
                    className="group flex items-center gap-3 rounded-2xl border border-border p-3 transition hover:border-foreground/30 active:bg-foreground/5"
                  >
                    <PhotoFrame
                      ladder={album.coverLadder}
                      src={album.cover}
                      thumbhash={album.coverThumbhash}
                      accent={album.color}
                      alt=""
                      sizes="56px"
                      className="h-14 w-14 shrink-0 rounded-xl"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-foreground">{album.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {[album.year, t("picker.photos", { n: album.photoCount })].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : shown.length === 0 ? (
          // An empty screen is an invitation to act, not a shrug.
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.07]">
              <Images className="h-5 w-5 text-muted-foreground" />
            </span>
            <p className="text-sm text-muted-foreground">
              {t(isPrivate ? "picker.privateEmpty" : "picker.publicEmpty")}
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-2 px-6">
            {shown.map((gallery) => (
              <li key={gallery.slug}>
                <Link
                  href={`/${locale}/galleries/${gallery.slug}`}
                  onClick={onClose}
                  className="group flex items-center gap-3 rounded-2xl border border-border p-3 transition hover:border-foreground/30 active:bg-foreground/5"
                >
                  {gallery.cover ? (
                    // Never through next/image: getGalleryIndex already asked
                    // Bunny for 480px, so optimizing again means a second
                    // resize of an already-resized file, an extra hop, and a
                    // per-transform charge — for a 56px thumbnail.
                    <PhotoFrame
                      ladder={gallery.coverLadder}
                      src={gallery.cover}
                      thumbhash={gallery.coverThumbhash}
                      accent={gallery.accentColor}
                      alt=""
                      sizes="56px"
                      className="h-14 w-14 shrink-0 rounded-xl"
                    />
                  ) : (
                    <span
                      className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                      style={{ background: gallery.accentColor }}
                    >
                      <Lock className="h-5 w-5 text-white/70" />
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {gallery.label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[
                        gallery.dateLabel,
                        gallery.photoCount
                          ? t("picker.photos", { n: gallery.photoCount })
                          : null,
                        isPrivate ? t("picker.codeRequired") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>

                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Present on both tabs. On the private one it's the answer to "I lost
            my code"; on the public one it's "where's mine?". */}
        {!isAlbums && (
        <div className="px-6 py-6">
          <a
            href={`https://t.me/${CONTACT.telegram}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-glass flex min-h-12 w-full items-center justify-center gap-2 text-sm font-semibold text-foreground"
          >
            <Send className="h-4 w-4" />
            {t(isPrivate ? "picker.askCode" : "picker.askGallery")}
          </a>
        </div>
        )}
      </div>
    </div>
  );
}