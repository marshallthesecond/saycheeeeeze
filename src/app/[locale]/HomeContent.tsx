"use client";

// The Home page (rebuilt 2026-11-17). Three columns from 1280px:
//
//   left    the platform card
//   middle  empty since 2026-11-22: Best picks, the album to look through and
//           the Portraits pitch moved to the About page, at Marshall's
//           request, and so did the Galleries stack that was on the left
//   right   the private-gallery door and the session types
//
// Below 1280px one column: the private-gallery door, the session types, the
// platform card. The page's h1 is kept for search engines and screen readers
// but not shown.

import { useCallback, useState } from "react";
import StickyHeader from "@/src/components/common/StickyHeader";
import GalleryPickerSheet from "@/src/components/common/GalleryPickerSheet";
import PlatformCard from "@/src/components/home/PlatformCard";
import { PrivateGalleryCard, SessionsList } from "@/src/components/profile/RailCards";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import type { AlbumData } from "@/src/lib/albums";
import type { GalleryListing } from "@/src/lib/client-galleries";
import type { SessionSummary } from "@/src/lib/session-summaries";

const STICKY =
  "xl:sticky xl:top-[calc(3.5rem+env(safe-area-inset-top))] xl:max-h-[calc(100dvh-4.5rem-env(safe-area-inset-top))] xl:self-start xl:overflow-x-hidden xl:overflow-y-auto";

export default function HomeContent({
  albums,
  galleries,
  sessions,
}: {
  albums: AlbumData[];
  galleries: GalleryListing[];
  sessions: SessionSummary[];
}) {
  const { t, locale } = useT();
  const [privateOpen, setPrivateOpen] = useState(false);
  const closeSheet = useCallback(() => setPrivateOpen(false), []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <StickyHeader title="saycheeeeeze" fadeOver={120} variant="wordmark" />

      <h1 className="sr-only">{`${t("profile.name")}, ${t("about.heroTitle")}`}</h1>

      <div
        className="mx-auto grid max-w-[1920px] grid-cols-1 gap-4 px-4 pb-32 xl:grid-cols-[300px_minmax(0,1fr)_300px]"
        style={{ paddingTop: "calc(3rem + env(safe-area-inset-top))" }}
      >
        {/* Left — the platform card (on a phone it closes the page instead). */}
        <aside className={`hidden xl:flex xl:flex-col ${STICKY}`}>
          <PlatformCard />
        </aside>

        {/* Middle — empty for now. */}
        <main className="min-w-0" />

        {/* Right — what else. */}
        <aside aria-label={t("home.sessions")} className={`flex flex-col gap-4 ${STICKY}`}>
          <PrivateGalleryCard onOpen={() => setPrivateOpen(true)} />
          <SessionsList sessions={sessions} />
          <PlatformCard className="xl:hidden" />
        </aside>
      </div>

      <GalleryPickerSheet
        open={privateOpen}
        onClose={closeSheet}
        mode="private"
        galleries={galleries}
        albums={albums}
        locale={locale}
      />
    </div>
  );
}
