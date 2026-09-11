"use client";

// src/app/[locale]/galleries/[slug]/ClientGalleryView.tsx
//
// A thin shell around AlbumView that does one thing: keeps the signed URLs
// alive.
//
// Signed URLs carry a six-hour deadline. A client who opens their gallery,
// gets distracted, and comes back in the evening would otherwise find a page
// of grey boxes and assume you broke something. So: check the clock, and when
// the deadline is close, quietly fetch a new set.
//
// Everything else — the hero, the grid, the lightbox, selection, zip download,
// the request sheet — is AlbumView. If this file starts growing features,
// that's the signal that AlbumView needed a prop instead.

import { useCallback, useEffect, useState } from "react";

import AlbumView from "@/src/app/[locale]/albums/[slug]/AlbumView";
import type { AlbumData } from "@/src/lib/albums";
import type { DownloadTier } from "@/src/lib/ladder";

/** Re-sign once we're within this many seconds of the deadline. */
const REFRESH_MARGIN_SECONDS = 15 * 60;
const POLL_INTERVAL_MS = 60_000;

interface Props {
  album: AlbumData;
  slug: string;
  /**
   * Unix seconds at which this page's URLs lapse, or null if they never do.
   *
   * This used to be paired with an `isPrivate` flag, and the refresh loop was
   * gated on THAT. It no longer can be: every client gallery is served from
   * the private zone with signed URLs now, whatever its visibility, so a
   * "public" client gallery expires exactly like a private one. Gating on
   * privacy would have left those pages to quietly go blank after six hours
   * with nothing refreshing them.
   *
   * The only thing that matters here is whether there is a deadline, so that is
   * the only thing this component is told.
   */
  signedUntil: number | null;
  /** Your line to the client, rendered under the gallery hero. Optional. */
  clientNote: string | null;
  /** Straight through to AlbumView — this shell owns no download policy, it
   *  only keeps the signed URLs alive. */
  downloadTiers: DownloadTier[];
  downloadEnabled: boolean;
}

export default function ClientGalleryView({
  album,
  slug,
  signedUntil,
  clientNote,
  downloadTiers,
  downloadEnabled,
}: Props) {
  const [photos, setPhotos] = useState(album.photos);
  const [cover, setCover] = useState(album.cover);
  const [coverLadder, setCoverLadder] = useState(album.coverLadder);
  const [expiry, setExpiry] = useState(signedUntil);

  const refresh = useCallback(async () => {
    if (expiry === null) return; // nothing on this page expires
    if (document.visibilityState !== "visible") return;
    if (Date.now() / 1000 < expiry - REFRESH_MARGIN_SECONDS) return;

    try {
      const res = await fetch(`/api/galleries/${encodeURIComponent(slug)}/photos`, {
        cache: "no-store",
      });
      if (!res.ok) return; // cookie lapsed or gallery pulled — leave the page as it is
      const data = await res.json();
      if (!Array.isArray(data.photos)) return;

      setPhotos(data.photos);
      if (data.cover) setCover(data.cover);
      // Always assign: a gallery whose hero lost its ladder should stop
      // rendering stale signed derivative URLs, not keep the old ones.
      setCoverLadder(data.coverLadder ?? undefined);
      setExpiry(data.signedUntil ?? null);
    } catch {
      // Offline, most likely. The existing URLs are still good for a while.
    }
  }, [expiry, slug]);

  useEffect(() => {
    if (expiry === null) return;

    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    // A phone that's been asleep won't have fired the interval, so catch the
    // moment the tab comes back too.
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [expiry, refresh]);

  // The note used to render as a sibling ABOVE <AlbumView>. Now that the top
  // bar is fixed, anything before the hero slides underneath it — so the note
  // is handed to AlbumView, which drops it in below the hero where it reads.
  return (
    <AlbumView
      album={{ ...album, photos, cover, coverLadder }}
      note={clientNote}
      downloadTiers={downloadTiers}
      downloadEnabled={downloadEnabled}
    />
  );
}