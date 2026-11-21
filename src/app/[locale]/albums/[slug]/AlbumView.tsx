"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Share2,
  Download,
  Play,
  Pause,
  CheckSquare,
  X,
  MessageCircleQuestion,
  Images,
  CircleDashed,
  LayoutDashboard,
  LayoutGrid,
  List,
  ChevronDown,
  Check,
} from "lucide-react";
import PhotoGrid, { type GridLayout } from "@/src/components/common/PhotoGrid";
import { MARK_ICONS } from "@/src/components/common/MarkButtons";
import Lightbox from "@/src/components/common/Lightbox";
import GalleryRequestSheet from "@/src/components/common/GalleryRequestSheet";
import DownloadSheet, { type DownloadChoice } from "@/src/components/common/DownloadSheet";
import StickyHeader from "@/src/components/common/StickyHeader";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import type { AlbumData } from "@/src/lib/albums";
import { groupBySet, setIndexFromParam, setParam, type GallerySet } from "@/src/lib/gallery-sets";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import {
  downloadPhoto,
  downloadPhotosAsZip,
  downloadPhotosIndividually,
  prefetchPhotoFile,
  readDeepLinkIndex,
  shareLink,
  sharePhotoFiles,
  sharePhotoUrl,
  slugify,
  syncDeepLink,
  type BatchProgress,
  type ZipProgress,
} from "@/src/lib/gallery";
import {
  DEFAULT_DOWNLOAD_TIERS,
  type DownloadablePhoto,
  type DownloadTier,
} from "@/src/lib/ladder";
import {
  readDownloadPreference,
  writeDownloadPreference,
  type DownloadPreference,
} from "@/src/lib/downloadPrefs";
import { blurStyle, fallbackSrc, hasLadder, srcSet } from "@/src/lib/ladder";
import {
  FILTER_FALLBACK,
  FILTER_KEYS,
  MARK_FALLBACK,
  MARK_FILTERS,
  MARK_KEYS,
  matchesFilter,
  type MarkFilter,
  type PhotoMark,
} from "@/src/lib/photo-marks";

/** Lives here rather than in ladder.ts because it has to match the hero's own
 *  container widths (65% at sm, 42% at lg), which nothing else uses. Get it
 *  wrong and the browser pulls the 2048 rung into a 400px box. */
const HERO_SIZES = "100vw";

// THE LAYOUT. Mosaic (photographs at their own shapes), grid (equal squares
// with their names) or list (one row per file). The choice is this browser's,
// kept in localStorage, and read through useSyncExternalStore so the server
// render and the first client render agree on "masonry" and the saved choice
// arrives straight after, without an effect that sets state.
const LAYOUTS: GridLayout[] = ["masonry", "grid", "list"];
const LAYOUT_KEY = "sc:gallery-layout";
const layoutListeners = new Set<() => void>();
/** Holds the choice when localStorage refuses (private windows). */
let layoutInMemory: GridLayout | null = null;

function readLayout(): GridLayout {
  if (layoutInMemory) return layoutInMemory;
  try {
    const saved = window.localStorage.getItem(LAYOUT_KEY) as GridLayout | null;
    return saved && LAYOUTS.includes(saved) ? saved : "masonry";
  } catch {
    return "masonry";
  }
}

function writeLayout(next: GridLayout): void {
  layoutInMemory = next;
  try {
    window.localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // Kept in memory for this visit instead.
  }
  layoutListeners.forEach((notify) => notify());
}

function subscribeLayout(notify: () => void): () => void {
  layoutListeners.add(notify);
  return () => layoutListeners.delete(notify);
}

// THE SET. On a gallery divided into sets, which one is open: ?set= in the
// address (see gallery-sets.ts), so a reload or a shared link opens the same
// set. Read through useSyncExternalStore for the same reason as the layout:
// the server renders the first set and the address is read straight after.
const setListeners = new Set<() => void>();

function readSetParam(): string | null {
  return new URLSearchParams(window.location.search).get("set");
}

/** Opens another set: ?set= changes and the photo (?p=) goes. */
function writeSetParam(value: string): void {
  const u = new URL(window.location.href);
  u.searchParams.set("set", value);
  u.searchParams.delete("p");
  window.history.replaceState(null, "", u.toString());
  setListeners.forEach((notify) => notify());
}

function subscribeSet(notify: () => void): () => void {
  setListeners.add(notify);
  window.addEventListener("popstate", notify);
  return () => {
    setListeners.delete(notify);
    window.removeEventListener("popstate", notify);
  };
}

/** For a value that never changes after hydration. */
function subscribeNothing(): () => void {
  return () => {};
}

/** A name for the set in a file name: its own letters, or its number. */
function setFilePart(set: GallerySet, index: number): string {
  return /[a-z0-9]/i.test(set.label) ? slugify(set.label) : `set-${index + 1}`;
}

const LAYOUT_ICONS: Record<GridLayout, React.ComponentType<{ className?: string }>> = {
  masonry: LayoutDashboard,
  grid: LayoutGrid,
  list: List,
};

const LAYOUT_NAMES: Record<GridLayout, [key: string, fallback: string]> = {
  masonry: ["gallery.layoutMasonry", "Mosaic"],
  grid: ["gallery.layoutGrid", "Grid"],
  list: ["gallery.layoutList", "List"],
};

/** The filter shows the same picture for a mark as the buttons under a photo. */
const FILTER_ICONS: Record<MarkFilter, React.ComponentType<{ className?: string }>> = {
  all: Images,
  ...MARK_ICONS,
  unmarked: CircleDashed,
};

const PAGE_SIZE = 24;
const SLIDESHOW_INTERVAL_MS = 3000;
const TOAST_MS = 2400;

// The selection bar has to clear the fixed bottom nav on mobile. 5.5rem is the
// nav's height — if you change the nav, change this.
const BAR_OFFSET =
  "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:bottom-6";

/** English fallbacks for the tier names — the dictionary overrides these. */
const TIER_FALLBACK: Record<DownloadTier, string> = {
  share: "For sharing",
  full: "Full quality",
  original: "Original file",
};

export default function AlbumView({
  album,
  note = null,
  downloadTiers = DEFAULT_DOWNLOAD_TIERS,
  downloadEnabled = true,
  onMark,
  markBusy,
  markHint = null,
}: {
  album: AlbumData;
  /**
   * galleries.download_enabled. false hides every download affordance.
   *
   * A courtesy, not a control: the photos are on the page and anyone
   * determined can save them from the browser. What this does is stop the app
   * offering what you said you were not offering.
   */
  downloadEnabled?: boolean;
  /** Which tiers this gallery hands over. Portfolio albums take the default;
   *  client galleries pass galleries.download_tiers. */
  downloadTiers?: DownloadTier[];
  /** Optional line from the photographer, shown under the hero. Client
   *  galleries pass this; portfolio albums don't. It's a prop rather than a
   *  sibling above <AlbumView> because the fixed top bar covers anything
   *  rendered before the hero. */
  note?: string | null;
  /**
   * Turns on the whole marking feature: three buttons per photograph and the
   * filter above the grid.
   *
   * Omitted by the portfolio, which is why nothing about a public album
   * changes. The handler lives in ClientGalleryView because it owns the
   * network call, the optimistic update and the rollback — this component
   * renders marks and reports presses, and knows nothing about how they are
   * stored.
   */
  onMark?: (photoId: string, next: PhotoMark | null) => Promise<boolean>;
  /** Ids with a request in flight. */
  markBusy?: Set<string>;
  /** One line under the filter explaining that a mark is a request, not an
   *  action. Worth the space: "Delete" is a frightening word to press. */
  markHint?: string | null;
}) {
  // Links have to carry the active locale, or the middleware bounces the
  // visitor through a redirect and can land them in the wrong language.
  const { locale, t } = useT();

  // Falls back to English until the matching key exists in the dictionary, so
  // adding translations later never means shipping "gallery.share" to a user.
  const tx = useCallback(
    (key: string, fallback: string) => {
      const value = t(key);
      return value === key ? fallback : value;
    },
    [t],
  );

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zip, setZip] = useState<ZipProgress | null>(null);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  /** The photos the download sheet is currently asking about, or null. */
  const [pendingDownload, setPendingDownload] = useState<DownloadablePhoto[] | null>(null);
  /** The standing answer, read AFTER mount — localStorage does not exist on the
   *  server, and reading it during render would desync hydration. */
  const [pref, setPref] = useState<DownloadPreference | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [markFilter, setMarkFilter] = useState<MarkFilter>("all");
  const layout = useSyncExternalStore(subscribeLayout, readLayout, (): GridLayout => "masonry");
  const slideshowTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sets: the tabs, and the photos of the one that is open. No sets: one list.
  const setRaw = useSyncExternalStore(subscribeSet, readSetParam, () => null);
  const grouped = useMemo(() => groupBySet(album.sets, album.photos), [album.sets, album.photos]);
  const setIndex = setIndexFromParam(setRaw, grouped.sets.length);
  const activeSet: GallerySet | null = grouped.sets[setIndex] ?? null;
  const setPhotos = useMemo(
    () => (activeSet ? grouped.photosOf(activeSet.id) : album.photos),
    [activeSet, grouped, album.photos],
  );

  /**
   * The photographs the page is currently working with.
   *
   * EVERYTHING downstream reads this rather than album.photos: the grid, the
   * "load more" count, the lightbox's list and its wrap-around, the slideshow
   * and "download all". Leave any one of them on album.photos and filtering to
   * "Delete" then opens the lightbox on a photograph that is not on screen,
   * because the index the grid handed over counts a different list.
   *
   * album.photos survives for the two things that are genuinely about the
   * whole set: the photo count beside the title, and the selection.
   */
  const filteredPhotos = useMemo(
    () =>
      markFilter === "all"
        ? setPhotos
        : setPhotos.filter((p) => matchesFilter(p.mark, markFilter)),
    [setPhotos, markFilter],
  );

  /** How many photographs each filter would show. Counted once per render over
   *  the whole set, rather than filtering five times to find five lengths. */
  const markCounts = useMemo(() => {
    const counts: Record<MarkFilter, number> = {
      all: setPhotos.length,
      keep: 0,
      publish: 0,
      delete: 0,
      unmarked: 0,
    };
    for (const p of setPhotos) {
      if (p.mark) counts[p.mark]++;
      else counts.unmarked++;
    }
    return counts;
  }, [setPhotos]);

  const visiblePhotos = filteredPhotos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPhotos.length;

  const selectedPhotos = useMemo(
    () => album.photos.filter((p) => selected.has(p.src)),
    [album.photos, selected],
  );

  /**
   * Changing the filter re-seats the page rather than just re-rendering it.
   *
   * Both of these count POSITIONS in a list that has just changed length: a
   * lightbox open on index 40 of "all" would index past the end of a
   * three-photograph "Delete", and "load more" would carry a count from a list
   * the visitor is no longer looking at.
   */
  const chooseFilter = useCallback((next: MarkFilter) => {
    setMarkFilter(next);
    setVisibleCount(PAGE_SIZE);
    setLightboxIndex(null);
    setIsSlideshow(false);
  }, []);

  /** Another set: the same as a filter, the page starts again on it. */
  const chooseSet = useCallback((index: number) => {
    writeSetParam(setParam(index));
    setVisibleCount(PAGE_SIZE);
    setLightboxIndex(null);
    setIsSlideshow(false);
  }, []);

  const say = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  /**
   * Press -> say what it was marked as -> save it.
   *
   * The message goes up FIRST and is corrected if the save fails, rather than
   * waiting for the round trip. On a phone on Tashkent mobile data the honest
   * order costs about a second of a button that looks broken, and the failure
   * path is rare enough to be the one that waits.
   *
   * The toast is deliberately in the past tense about a RECORD, not an action:
   * "Marked for deletion", never "Deleted". Nothing has been deleted, the
   * photograph is still on screen, and a client who reads otherwise will ask
   * why.
   */
  const handleMark = useCallback(
    async (photoId: string, next: PhotoMark | null) => {
      if (!onMark) return;
      say(
        next
          ? tx(MARK_KEYS[next].toast, MARK_FALLBACK[next].toast)
          : tx("gallery.markCleared", "Mark removed"),
      );
      const ok = await onMark(photoId, next);
      if (!ok) say(tx("gallery.markFailed", "Couldn't save that — try again"));
    },
    // say and tx are defined above; onMark comes from the client shell.
    [onMark, say, tx],
  );


  // Deep link: /albums/sara?p=7 opens on the seventh photo (of the set named
  // by ?set=, on a gallery divided into sets). Not before the address has
  // been read: the first render after hydration is the server's, with the
  // first set, and ?p= must neither open a photo of the wrong set nor be
  // dropped from the address before the right set is there.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  useEffect(() => {
    if (!hydrated) return;
    const index = readDeepLinkIndex(filteredPhotos.length);
    if (index === null) return;
    setVisibleCount((c) => Math.max(c, index + 1));
    setLightboxIndex(index);
  }, [hydrated, filteredPhotos.length]);

  useEffect(() => {
    if (hydrated) syncDeepLink(lightboxIndex);
  }, [hydrated, lightboxIndex]);

  // Lightbox navigation
  const openLightbox = useCallback((i: number) => setLightboxIndex(i), []);
  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    setIsSlideshow(false);
  }, []);
  const prevPhoto = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null ? (i - 1 + filteredPhotos.length) % filteredPhotos.length : null,
    );
  }, [filteredPhotos.length]);
  const nextPhoto = useCallback(() => {
    setLightboxIndex((i) => (i !== null ? (i + 1) % filteredPhotos.length : null));
  }, [filteredPhotos.length]);

  const startSlideshow = useCallback(() => {
    setLightboxIndex(0);
    setIsSlideshow(true);
  }, []);

  useEffect(() => {
    if (isSlideshow && lightboxIndex !== null) {
      slideshowTimer.current = setInterval(() => {
        setLightboxIndex((i) =>
          i !== null ? (i + 1) % filteredPhotos.length : null,
        );
      }, SLIDESHOW_INTERVAL_MS);
    }
    return () => {
      if (slideshowTimer.current) clearInterval(slideshowTimer.current);
    };
  }, [isSlideshow, lightboxIndex, filteredPhotos.length]);

  // Selection
  const toggleSelect = useCallback((src: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(src)) {
        next.delete(src);
      } else {
        next.add(src);
        // Warm the bytes now so Share can hand navigator.share a File with no
        // await — iOS refuses the share sheet once the tap has gone stale.
        // The delivery file, not the original: warming 37 MB would be worse
        // than not warming at all.
        const photo = album.photos.find((p) => p.src === src);
        if (photo) prefetchPhotoFile(sharePhotoUrl(photo));
      }
      return next;
    });
  }, [album.photos]);

  const enterSelection = useCallback(
    (src: string) => {
      setSelectionMode(true);
      toggleSelect(src);
    },
    [toggleSelect],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectionMode(false);
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(visiblePhotos.map((p) => p.src)));
  }, [visiblePhotos]);

  // Share
  const shareGallery = useCallback(async () => {
    const url = window.location.href.split("?")[0];
    const result = await shareLink(url, album.title);
    if (result === "copied") say(tx("gallery.linkCopied", "Gallery link copied"));
    if (result === "unavailable")
      say(tx("gallery.shareUnavailable", "Sharing isn't available in this browser"));
  }, [album.title, say, tx]);

  const shareSelected = useCallback(async () => {
    if (selectedPhotos.length === 0) return;
    const result = await sharePhotoFiles(
      selectedPhotos.map((p) => sharePhotoUrl(p)),
      album.title,
    );
    if (result === "shared" || result === "cancelled") return;

    // No file sharing here — hand over the gallery link instead, which at
    // least gets the recipient to the right place.
    const fallback = await shareLink(window.location.href.split("?")[0], album.title);
    say(
      fallback === "copied"
        ? tx("gallery.filesUnsupported", "Photos can't be shared here — gallery link copied instead")
        : tx("gallery.shareUnavailable", "Sharing isn't available in this browser"),
    );
  }, [selectedPhotos, album.title, say, tx]);

  // Download
  useEffect(() => setPref(readDownloadPreference()), []);

  /**
   * Carries out a choice once it's been made. One photo never gets an archive
   * around it whatever the packaging answer said — that answer is about a
   * batch, and zipping a single file is work for the client with nothing back.
   */
  const runDownload = useCallback(
    async (photos: DownloadablePhoto[], choice: DownloadChoice) => {
      if (photos.length === 0) return;

      if (choice.remember) {
        const next = { tier: choice.tier, asZip: choice.asZip };
        writeDownloadPreference(next);
        setPref(next);
      }

      try {
        if (photos.length === 1) {
          await downloadPhoto(photos[0], choice.tier, downloadTiers);
          return;
        }

        if (choice.asZip) {
          // The whole set on screen is named after it; anything less is a selection.
          const name =
            photos.length === setPhotos.length
              ? `${slugify(album.title)}${activeSet ? `-${setFilePart(activeSet, setIndex)}` : ""}.zip`
              : `${slugify(album.title)}-selection.zip`;
          await downloadPhotosAsZip(photos, name, choice.tier, downloadTiers, setZip);
          return;
        }

        const result = await downloadPhotosIndividually(
          photos,
          choice.tier,
          downloadTiers,
          setBatch,
        );
        // Never silent: a batch that half-worked because the browser's
        // multiple-downloads prompt was dismissed looks like success until the
        // client counts their files a week later.
        if (result.failed > 0) {
          say(
            tx(
              "gallery.downloadPartial",
              "{saved} saved, {failed} could not be — your browser may have blocked the rest",
            )
              .replace("{saved}", String(result.saved))
              .replace("{failed}", String(result.failed)),
          );
        }
      } catch {
        say(tx("gallery.downloadFailed", "Download failed — try again"));
      } finally {
        setZip(null);
        setBatch(null);
      }
    },
    [setPhotos.length, activeSet, setIndex, album.title, downloadTiers, say, tx],
  );

  /**
   * The entry point for every download button on the page.
   *
   * A single photo with a standing answer asks nothing — that's the point of
   * remembering it. More than one always opens the sheet: archive or separate
   * files is a second decision, and it depends on how many were selected,
   * which the remembered answer can't know.
   */
  const requestDownload = useCallback(
    (photos: DownloadablePhoto[]) => {
      if (zip || batch || photos.length === 0) return;
      if (photos.length === 1 && pref) {
        void runDownload(photos, { tier: pref.tier, asZip: false, remember: false });
        return;
      }
      setPendingDownload(photos);
    },
    [zip, batch, pref, runDownload],
  );

  // What is on screen, not what is in the gallery. With a filter active,
  // "Download all" quietly including the photographs it is hiding is the kind
  // of surprise that costs someone a 900 MB transfer.
  const downloadAll = useCallback(
    () => requestDownload(filteredPhotos),
    [requestDownload, filteredPhotos],
  );

  const downloadSelected = useCallback(
    () => requestDownload(selectedPhotos),
    [requestDownload, selectedPhotos],
  );

  const LayoutIcon = LAYOUT_ICONS[layout];
  const layoutName = tx(...LAYOUT_NAMES[layout]);

  const zipLabel = zip
    ? zip.phase === "packing"
      ? tx("gallery.packing", "Packing…")
      : `${zip.done} / ${zip.total}`
    : batch
      ? `${batch.done} / ${batch.total}`
      : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar. The page title fades in once the header has scrolled away,
          as on the service pages; there is no wordmark here. */}
      <StickyHeader
        title={album.title}
        fadeOver={260}
        backHref={`/${locale}/about`}
      />

      {/* Header, after the service pages' photo hero: the cover as a faded
          ground that sinks into the page, and the cover itself beside the
          title. */}
      <header className="relative h-[38vh] min-h-[280px] max-h-[360px] w-full overflow-hidden sm:h-[46vh] sm:max-h-[460px]">
        {/* ThumbHash under the photograph so the first frame is not a flat
            rectangle. This is the page's Largest Contentful Paint. */}
        <span aria-hidden className="absolute inset-0" style={blurStyle(album.coverThumbhash)}>
          {hasLadder(album.coverLadder) ? (
            <picture>
              <source type="image/avif" sizes={HERO_SIZES} srcSet={srcSet(album.coverLadder, "avif")} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fallbackSrc(album.coverLadder)}
                srcSet={srcSet(album.coverLadder, "webp")}
                sizes={HERO_SIZES}
                alt=""
                fetchPriority="high"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </picture>
          ) : (
            <Image
              src={album.cover}
              alt=""
              fill
              priority
              sizes={HERO_SIZES}
              className="object-cover"
              unoptimized
            />
          )}
        </span>

        {/* The photograph is left as it is over the top three fifths, then
            sinks into the page: nothing is laid over it up there, so it is as
            bright as the photograph itself. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, transparent 58%, color-mix(in oklab, var(--background) 82%, transparent) 80%, var(--background) 98%)",
          }}
        />

        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-4 pb-4 sm:gap-5 sm:px-8 sm:pb-6">
          <PhotoFrame
            ladder={album.coverLadder}
            src={album.cover}
            thumbhash={album.coverThumbhash}
            alt=""
            sizes="(min-width: 640px) 112px, 72px"
            className="h-[72px] w-[72px] shrink-0 rounded-xl shadow-xl ring-1 ring-black/10 sm:h-28 sm:w-28"
          />
          {/* A soft halo in the page's own colour, so the words hold on any
              photograph where the fade is still thin. */}
          <div className="min-w-0 [text-shadow:0_0_12px_var(--background),0_0_3px_var(--background)]">
            <p className="text-[10px] font-semibold text-foreground/80 sm:text-[11px]">
              {tx("gallery.eyebrow", "Gallery")}
            </p>
            <h1 className="mt-1 break-words text-[26px] font-extrabold leading-[0.95] tracking-tighter text-foreground sm:text-5xl">
              {album.title}
            </h1>
            <p className="mt-1.5 text-[13px] text-foreground/85 sm:text-sm">
              {[album.location, album.year, `${album.photos.length} ${tx("gallery.photos", "photos")}`]
                .filter(Boolean)
                .join(", ")}
            </p>
            {album.description && (
              <p className="mt-1 line-clamp-2 hidden max-w-xl text-[13px] text-foreground/70 sm:block">
                {album.description}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Photographer's note — client galleries only */}
      {note && (
        <p className="bg-foreground/5 px-6 py-3 text-center text-sm leading-relaxed text-foreground/70 sm:px-10">
          {note}
        </p>
      )}

      {/* Actions: one small glass bar, in the manner of the BottomNav. Icons
          only on a phone; the words come back from 640px. */}
      <div className="flex items-center justify-end gap-3 px-4 pb-4 pt-1 sm:px-8">
        {/* The sets, on a gallery divided into sets: tabs on the left of the
            same row, plain words rather than buttons. When they do not fit
            they become one button with the open set's name. */}
        {grouped.sets.length > 0 && (
          <SetTabs
            sets={grouped.sets}
            active={setIndex}
            onChoose={chooseSet}
            label={tx("gallery.sets", "Sets")}
          />
        )}
        <div className="sc-glass isolate flex shrink-0 items-center gap-0.5 rounded-2xl p-1">
          <ActionIcon
            icon={<Share2 className="h-3.5 w-3.5" />}
            label={tx("gallery.share", "Share")}
            onClick={shareGallery}
          />
          {downloadEnabled && (
            <ActionIcon
              icon={<Download className="h-3.5 w-3.5" />}
              label={zipLabel ?? tx("gallery.downloadAll", "Download all")}
              onClick={downloadAll}
              disabled={!!zip || !!batch}
              progress={!!zipLabel}
            />
          )}
          <ActionIcon
            icon={<CheckSquare className="h-3.5 w-3.5" />}
            label={tx("gallery.select", "Select")}
            onClick={() => setSelectionMode((v) => !v)}
            active={selectionMode}
          />
          <ActionIcon
            icon={<Play className="h-3.5 w-3.5" />}
            label={tx("gallery.slideshow", "Slideshow")}
            onClick={startSlideshow}
          />
          <span aria-hidden className="mx-0.5 h-4 w-px bg-foreground/15" />
          {/* One button that steps through the three layouts and shows the
              one in use. */}
          <ActionIcon
            icon={<LayoutIcon className="h-3.5 w-3.5" />}
            label={layoutName}
            title={`${tx("gallery.layout", "Layout")}: ${layoutName}`}
            onClick={() => writeLayout(LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length])}
          />
        </div>
      </div>

      {/* Selection hint */}
      {selectionMode && selected.size === 0 && (
        <p className="px-6 pb-2 pt-4 text-center text-xs text-muted-foreground">
          {tx("gallery.selectHint", "Tap photos to select them. Long-press works too.")}
        </p>
      )}

      {/* Filter — client galleries only, and only once something can be
          filtered. Rendering five chips that all say 0 over an unreviewed
          gallery would be a control with nothing to control. */}
      {onMark && (
        <div className="px-3 pt-3 sm:px-6">
          {/* One row at every width and never a sideways scroll. On a phone
              the five share the width equally and show the mark's icon and its
              count; the words join them from 640px. */}
          <div className="grid grid-cols-5 gap-1 sm:flex sm:flex-wrap sm:gap-1.5">
            {MARK_FILTERS.map((value) => {
              const active = markFilter === value;
              const count = markCounts[value];
              const Icon = FILTER_ICONS[value];
              const name = tx(FILTER_KEYS[value], FILTER_FALLBACK[value]);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${name}, ${count}`}
                  title={name}
                  onClick={() => chooseFilter(value)}
                  className={`flex h-8 min-w-0 items-center justify-center gap-1 rounded-full px-1.5 text-[12px] font-semibold transition sm:gap-1.5 sm:px-3 ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground/8 text-foreground/75 hover:bg-foreground/12 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">{name}</span>
                  <span className={`tabular-nums ${active ? "" : "text-muted-foreground"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          {markHint && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{markHint}</p>
          )}
        </div>
      )}

      {/* Photo grid */}
      <div
        className="pb-4 pt-3"
        id="gallery-photos"
        {...(activeSet ? { role: "tabpanel", "aria-label": activeSet.label } : {})}
      >
        <PhotoGrid
          photos={visiblePhotos}
          onPhotoClick={openLightbox}
          // A line under each photograph: the file name, and in a client
          // gallery the marks to its left. A little more air between columns
          // so two names never run into each other. (Public albums show the
          // names too since 2026-11-16, Marshall's call.)
          gap={6}
          captions
          layout={layout}
          selectable
          selectionMode={selectionMode}
          selected={selected}
          onToggleSelect={toggleSelect}
          onLongPress={enterSelection}
          onMark={onMark ? handleMark : undefined}
          markBusy={markBusy}
          tx={tx}
        />
      </div>

      {/* A filter that matches nothing has to say so, or it reads as a gallery
          that lost its photographs. */}
      {onMark && filteredPhotos.length === 0 && (
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">
          {tx("gallery.filterEmpty", "Nothing marked this way yet.")}
        </p>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center py-10">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="rounded-full border border-foreground/20 px-8 py-3 text-xs font-semibold uppercase tracking-widest text-foreground transition hover:border-foreground/50"
          >
            {tx("gallery.loadMore", "Load more")}
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-border px-6 py-10 pb-28 text-center">
        <button
          onClick={() => setRequestOpen(true)}
          className="mx-auto mb-8 flex items-center gap-2 rounded-full border border-foreground/15 px-5 py-2.5 text-xs font-medium text-foreground/70 transition hover:border-foreground/40 hover:text-foreground"
        >
          <MessageCircleQuestion className="h-4 w-4" />
          {tx("gallery.requestCta", "Ask me to change or remove something")}
        </button>

        <p className="text-sm text-muted-foreground">
          {tx("gallery.tagPrompt", "Don't forget to tag me on Insta:")}{" "}
          <a
            href="https://www.instagram.com/saycheeeeeze"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:underline"
          >
            @saycheeeeeze
          </a>
        </p>
        <Link
          href={`/${locale}`}
          className="mt-4 inline-block text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← {tx("gallery.back", "Back to saycheeeeze")}
        </Link>
      </footer>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div
          className={`fixed left-1/2 z-60 flex -translate-x-1/2 items-center gap-1 rounded-full bg-card/95 px-2 py-2 shadow-2xl shadow-black/20 ring-1 ring-border backdrop-blur-md ${BAR_OFFSET}`}
        >
          <span className="px-3 text-xs font-medium tabular-nums text-foreground/70">
            {selected.size}
          </span>
          <BarButton onClick={shareSelected} icon={<Share2 className="h-4 w-4" />}>
            {tx("gallery.share", "Share")}
          </BarButton>
          {downloadEnabled && (
            <BarButton
              onClick={downloadSelected}
              disabled={!!zip || !!batch}
              icon={<Download className="h-4 w-4" />}
            >
              {zipLabel ?? tx("gallery.download", "Download")}
            </BarButton>
          )}
          <BarButton
            onClick={() => setRequestOpen(true)}
            icon={<MessageCircleQuestion className="h-4 w-4" />}
          >
            {tx("gallery.ask", "Ask")}
          </BarButton>
          <button
            onClick={selected.size === visiblePhotos.length ? clearSelection : selectAllVisible}
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground sm:block"
          >
            {selected.size === visiblePhotos.length
              ? tx("gallery.none", "None")
              : tx("gallery.all", "All")}
          </button>
          <button
            onClick={clearSelection}
            aria-label={tx("gallery.clear", "Clear selection")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed left-1/2 z-70 -translate-x-1/2 rounded-full bg-foreground px-4 py-2.5 text-xs font-medium text-background shadow-xl ${
            selected.size > 0
              ? "bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] sm:bottom-24"
              : BAR_OFFSET
          }`}
        >
          {toast}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
        <>
          <Lightbox
            photos={filteredPhotos}
            index={lightboxIndex}
            onClose={closeLightbox}
            onPrev={() => {
              setIsSlideshow(false);
              prevPhoto();
            }}
            onNext={() => {
              setIsSlideshow(false);
              nextPhoto();
            }}
            canDownload={downloadEnabled}
            onDownload={(photo) => requestDownload([photo])}
            onDownloadOptions={
              downloadEnabled ? (photo) => setPendingDownload([photo]) : undefined
            }
            downloadLabel={
              pref ? tx(`download.tier.${pref.tier}`, TIER_FALLBACK[pref.tier]) : undefined
            }
            onMark={onMark ? handleMark : undefined}
            markBusy={
              onMark ? (markBusy?.has(filteredPhotos[lightboxIndex].id ?? "") ?? false) : false
            }
            tx={tx}
            isSelected={selected.has(filteredPhotos[lightboxIndex].src)}
            onToggleSelect={(src) => {
              setSelectionMode(true);
              toggleSelect(src);
            }}
            unoptimized
          />
          {isSlideshow && (
            <button
              onClick={() => setIsSlideshow(false)}
              className="fixed bottom-6 left-1/2 z-60 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <Pause className="h-3.5 w-3.5" />
              {tx("gallery.stopSlideshow", "Stop slideshow")}
            </button>
          )}
        </>
      )}

      <DownloadSheet
        open={pendingDownload !== null}
        onClose={() => setPendingDownload(null)}
        photos={pendingDownload ?? []}
        allowedTiers={downloadTiers}
        initialTier={pref?.tier ?? null}
        initialAsZip={pref?.asZip ?? null}
        tx={tx}
        onConfirm={(choice) => {
          const photos = pendingDownload ?? [];
          setPendingDownload(null);
          void runDownload(photos, choice);
        }}
      />

      <GalleryRequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        galleryTitle={album.title}
        selectedSources={[...selected]}
        initialKind={selected.size > 0 ? "hide" : "private"}
      />
    </div>
  );
}

/** Icon button with a label underneath — the row under the hero. */
function ActionIcon({
  icon,
  label,
  onClick,
  disabled,
  active,
  progress,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Tooltip, when it should say more than the label. */
  title?: string;
  /** The label is a running count ("12 / 40"): show it at every width. */
  progress?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={title ?? label}
      title={title ?? label}
      className={`flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-xl px-2 text-[12px] font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-2.5 ${
        active
          ? "bg-foreground text-background"
          : "text-foreground/80 hover:bg-foreground/8 hover:text-foreground"
      }`}
    >
      {icon}
      <span className={progress ? "tabular-nums" : "hidden sm:inline"}>{label}</span>
    </button>
  );
}

/** Compact pill button inside the floating selection bar. */
function BarButton({
  onClick,
  icon,
  disabled,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-foreground transition hover:bg-foreground/10 disabled:opacity-40"
    >
      {icon}
      <span className="hidden xs:inline sm:inline">{children}</span>
    </button>
  );
}
/**
 * The sets as tabs: words with a line under the open one, on the left of the
 * action bar. When they do not all fit beside it (a phone, many sets, long
 * names) they become one button with the open set's name, which lists them.
 * Never a sideways scroll.
 */
function SetTabs({
  sets,
  active,
  onChoose,
  label,
}: {
  sets: GallerySet[];
  active: number;
  onChoose: (index: number) => void;
  /** "Sets": the name of the list for screen readers. */
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const natural = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Whether the tabs fit: an invisible copy at its natural width against the
  // room there is. Measured before the first paint and on every resize.
  useLayoutEffect(() => {
    const el = box.current;
    const copy = natural.current;
    if (!el || !copy) return;
    const fit = () => setCompact(copy.offsetWidth > el.clientWidth + 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(copy);
    return () => ro.disconnect();
  }, []);

  // The list closes on Esc and on a press anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (index: number) => {
    setOpen(false);
    if (index !== active) onChoose(index);
  };

  // Arrow keys move between the tabs, and between the items of the list.
  const onTabKey = (e: React.KeyboardEvent) => {
    const last = sets.length - 1;
    const next =
      e.key === "ArrowRight" ? (active === last ? 0 : active + 1)
      : e.key === "ArrowLeft" ? (active === 0 ? last : active - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChoose(next);
    tabs.current[next]?.focus();
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const word = "whitespace-nowrap px-2.5 text-[13px] font-semibold";

  return (
    <div ref={box} className="relative -ml-2.5 min-w-0 flex-1">
      {/* The tabs at their natural width, never seen: what is measured. */}
      <div ref={natural} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex w-max">
        {sets.map((s) => (
          <span key={s.id} className={`${word} h-10`}>
            {s.label}
          </span>
        ))}
      </div>

      {compact ? (
        <>
          <button
            ref={trigger}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${label}: ${sets[active]?.label ?? ""}`}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-10 max-w-full items-center gap-1 px-2.5 text-left text-[13px] font-semibold leading-tight text-foreground transition active:scale-[0.98]"
          >
            <span className="min-w-0 break-words">{sets[active]?.label}</span>
            <ChevronDown aria-hidden className={`h-3.5 w-3.5 shrink-0 opacity-70 transition ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKey}
              className="absolute left-0 top-full z-30 mt-1 min-w-44 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-1 shadow-xl"
            >
              {sets.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={i === active}
                  onClick={() => choose(i)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground transition hover:bg-foreground/8 focus-visible:bg-foreground/8 focus-visible:outline-none"
                >
                  <Check aria-hidden className={`h-3.5 w-3.5 shrink-0 ${i === active ? "" : "invisible"}`} />
                  <span className="min-w-0 break-words">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div role="tablist" aria-label={label} className="flex overflow-hidden" onKeyDown={onTabKey}>
          {sets.map((s, i) => {
            const on = i === active;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="gallery-photos"
                tabIndex={on ? 0 : -1}
                onClick={() => choose(i)}
                className={`${word} relative h-10 transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                  on ? "text-foreground" : "text-foreground/55 hover:text-foreground/85"
                }`}
              >
                {s.label}
                <span
                  aria-hidden
                  className={`absolute inset-x-2.5 bottom-1 h-0.5 rounded-full transition ${on ? "bg-primary" : "bg-transparent"}`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}