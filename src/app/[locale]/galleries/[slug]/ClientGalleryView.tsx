"use client";

// A thin shell around AlbumView that keeps the signed URLs alive, and owns the
// client's marks.
//
// They carry a six-hour deadline, so a client who opens their gallery, gets
// distracted and comes back in the evening would find a page of grey boxes.
// This checks the clock and quietly fetches a new set before that happens.
//
// Marks live here for the same reason the refresh does: both write to the photo
// list, and one component owning that list is the only way they cannot fight.
// AlbumView renders marks and reports presses; it never learns how they are
// stored, which is what keeps the portfolio — the same component — unaffected.

import { useCallback, useEffect, useState } from "react";

import AlbumView from "@/src/app/[locale]/albums/[slug]/AlbumView";
import type { AlbumData, AlbumPhoto } from "@/src/lib/albums";
import type { DownloadTier } from "@/src/lib/ladder";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { parseMark, type PhotoMark } from "@/src/lib/photo-marks";

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
  const { t } = useT();
  const [photos, setPhotos] = useState(album.photos);
  const [cover, setCover] = useState(album.cover);
  const [coverLadder, setCoverLadder] = useState(album.coverLadder);
  const [expiry, setExpiry] = useState(signedUntil);
  const [markBusy, setMarkBusy] = useState<Set<string>>(new Set());

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

      // The server's marks win over whatever is on screen — it has been six
      // hours, and anything this tab changed in that time was written through
      // the endpoint the server just read from. Merging by id rather than
      // replacing outright would only preserve a mark that failed to save.
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

  /** One photograph's mark, in the local list. Keyed on id, never on src — the
   *  refresh above reissues every src on a six-hour clock. */
  const setMark = useCallback((photoId: string, mark: PhotoMark | null) => {
    setPhotos((prev) =>
      prev.map((p: AlbumPhoto) => (p.id === photoId ? { ...p, mark } : p)),
    );
  }, []);

  /**
   * Optimistic, and rolled back on anything short of a 2xx that agrees with us.
   *
   * The button has to answer instantly — a client going through eighty
   * photographs is pressing one every second or two, and a spinner per press
   * makes the whole job feel like filling in a form. What it must not do is
   * leave a mark on screen that is not in the database, so the failure path
   * restores the previous value and returns false, which is what makes
   * AlbumView replace its toast with the failure message.
   *
   * The server's answer is applied rather than assumed, so a mark that was
   * clamped or rejected by the CHECK constraint shows what actually landed.
   */
  const handleMark = useCallback(
    async (photoId: string, next: PhotoMark | null): Promise<boolean> => {
      const previous = photos.find((p: AlbumPhoto) => p.id === photoId)?.mark ?? null;
      if (previous === next) return true;

      setMark(photoId, next);
      setMarkBusy((b) => new Set(b).add(photoId));

      try {
        const res = await fetch(`/api/galleries/${encodeURIComponent(slug)}/mark`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId, mark: next }),
          cache: "no-store",
        });

        if (!res.ok) {
          setMark(photoId, previous);
          return false;
        }

        const data = await res.json();
        setMark(photoId, parseMark(data?.mark));
        return true;
      } catch {
        // Offline or the request was cut off. Either way nothing was written.
        setMark(photoId, previous);
        return false;
      } finally {
        setMarkBusy((b) => {
          const nextBusy = new Set(b);
          nextBusy.delete(photoId);
          return nextBusy;
        });
      }
    },
    [photos, setMark, slug],
  );

  const markHint = t("gallery.markHint");

  // Handed to AlbumView rather than rendered above it: the top bar is fixed,
  // so anything before the hero slides underneath it.
  return (
    <AlbumView
      album={{ ...album, photos, cover, coverLadder }}
      note={clientNote}
      downloadTiers={downloadTiers}
      downloadEnabled={downloadEnabled}
      onMark={handleMark}
      markBusy={markBusy}
      // t() returns the key itself when it is missing, which would print
      // "gallery.markHint" under the filter.
      markHint={markHint === "gallery.markHint" ? null : markHint}
    />
  );
}
