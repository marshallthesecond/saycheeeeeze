"use client";

// A thin shell around AlbumView that keeps the signed URLs alive.
//
// They carry a six-hour deadline, so a client who opens their gallery, gets
// distracted and comes back in the evening would find a page of grey boxes.
// This checks the clock and quietly fetches a new set before that happens.
//
// Everything else is AlbumView. If this file starts growing features, that is
// the signal AlbumView needed a prop instead.

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
   * Deliberately not paired with an `isPrivate` flag. Every client gallery is
   * served from the private zone now, whatever its visibility, so a "public"
   * one expires exactly like a private one — gating the refresh on privacy
   * would leave those pages to go blank after six hours.
   */
  signedUntil: number | null;
  /** Your line to the client, rendered under the gallery hero. Optional. */
  clientNote: string | null;
  /** Straight through to AlbumView; this shell owns no download policy. */
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
      // Always assign: a hero that lost its ladder should stop rendering
      // stale signed derivative URLs, not keep the old ones.
      setCoverLadder(data.coverLadder ?? undefined);
      setExpiry(data.signedUntil ?? null);
    } catch {
      // Offline, most likely. The existing URLs are still good for a while.
    }
  }, [expiry, slug]);

  useEffect(() => {
    if (expiry === null) return;

    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    // A sleeping phone won't have fired the interval, so catch the tab
    // coming back too.
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [expiry, refresh]);

  // Handed to AlbumView rather than rendered above it: the top bar is fixed,
  // so anything before the hero slides underneath it.
  return (
    <AlbumView
      album={{ ...album, photos, cover, coverLadder }}
      note={clientNote}
      downloadTiers={downloadTiers}
      downloadEnabled={downloadEnabled}
    />
  );
}