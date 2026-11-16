"use client";

// What opens from Home's "Services" tile (2026-11-17): every session type with
// its starting price, each leading to its own page, and Book at the bottom.
// The same bottom-sheet shape as GalleryPickerSheet.

import Link from "next/link";
import { useEffect } from "react";
import { X } from "lucide-react";
import { SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { SessionSummary } from "@/src/lib/session-summaries";

export default function ServicesSheet({
  open,
  onClose,
  sessions,
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionSummary[];
}) {
  const { t, locale } = useT();

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
        aria-label={t("home.servicesHeading")}
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-6">
          <h2 className="text-lg font-semibold text-foreground">{t("home.servicesHeading")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/10 text-foreground transition hover:bg-foreground/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-6 text-sm text-muted-foreground">{t("home.servicesBlurb")}</p>
        <div className="px-6 pt-3">
          <SessionsList sessions={sessions} bare />
        </div>
        <div className="px-6 pb-6 pt-3">
          <Link
            href={`/${locale}/book`}
            onClick={onClose}
            className="flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover active:scale-[0.99]"
          >
            {t("about.ctaButton")}
          </Link>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("about.alsoOnRequest")}</p>
        </div>
      </div>
    </div>
  );
}
