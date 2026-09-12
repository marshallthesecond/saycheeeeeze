"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
} from "lucide-react";
import PhotoGrid from "@/src/components/common/PhotoGrid";
import Lightbox from "@/src/components/common/Lightbox";
import GalleryRequestSheet from "@/src/components/common/GalleryRequestSheet";
import DownloadSheet, { type DownloadChoice } from "@/src/components/common/DownloadSheet";
import StickyHeader from "@/src/components/common/StickyHeader";
import type { AlbumData } from "@/src/lib/albums";
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

/** Lives here rather than in ladder.ts because it has to match the hero's own
 *  container widths (65% at sm, 42% at lg), which nothing else uses. Get it
 *  wrong and the browser pulls the 2048 rung into a 400px box. */
const HERO_SIZES = "(min-width: 1024px) 42vw, (min-width: 640px) 65vw, 100vw";

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
  const slideshowTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const visiblePhotos = album.photos.slice(0, visibleCount);
  const hasMore = visibleCount < album.photos.length;

  const selectedPhotos = useMemo(
    () => album.photos.filter((p) => selected.has(p.src)),
    [album.photos, selected],
  );

  const say = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // Deep link: /albums/sara?p=7 opens on the seventh photo
  useEffect(() => {
    const index = readDeepLinkIndex(album.photos.length);
    if (index === null) return;
    setVisibleCount((c) => Math.max(c, index + 1));
    setLightboxIndex(index);
  }, [album.photos.length]);

  useEffect(() => {
    syncDeepLink(lightboxIndex);
  }, [lightboxIndex]);

  // Lightbox navigation
  const openLightbox = useCallback((i: number) => setLightboxIndex(i), []);
  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    setIsSlideshow(false);
  }, []);
  const prevPhoto = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null ? (i - 1 + album.photos.length) % album.photos.length : null,
    );
  }, [album.photos.length]);
  const nextPhoto = useCallback(() => {
    setLightboxIndex((i) => (i !== null ? (i + 1) % album.photos.length : null));
  }, [album.photos.length]);

  const startSlideshow = useCallback(() => {
    setLightboxIndex(0);
    setIsSlideshow(true);
  }, []);

  useEffect(() => {
    if (isSlideshow && lightboxIndex !== null) {
      slideshowTimer.current = setInterval(() => {
        setLightboxIndex((i) =>
          i !== null ? (i + 1) % album.photos.length : null,
        );
      }, SLIDESHOW_INTERVAL_MS);
    }
    return () => {
      if (slideshowTimer.current) clearInterval(slideshowTimer.current);
    };
  }, [isSlideshow, lightboxIndex, album.photos.length]);

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
          const name =
            photos.length === album.photos.length
              ? `${slugify(album.title)}.zip`
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
    [album.photos.length, album.title, downloadTiers, say, tx],
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

  const downloadAll = useCallback(
    () => requestDownload(album.photos),
    [requestDownload, album.photos],
  );

  const downloadSelected = useCallback(
    () => requestDownload(selectedPhotos),
    [requestDownload, selectedPhotos],
  );

  const zipLabel = zip
    ? zip.phase === "packing"
      ? tx("gallery.packing", "Packing…")
      : `${zip.done} / ${zip.total}`
    : batch
      ? `${batch.done} / ${batch.total}`
      : null;

  return (
    <div className="min-h-screen bg-background text-white">
      {/* Top bar
          The same StickyHeader every other page uses. What was here before was
          a static <header> with two icon components that accepted `className`
          and then never applied it — they rendered at a fixed 20px and neither
          one did anything on tap. This one has the real language switcher, a
          real back link, and tints toward the album's own accent as you scroll. */}
      <StickyHeader
        title="saycheeeeeze"
        accent={album.color}
        fadeOver={220}
        variant="wordmark"
        backHref={`/${locale}/portfolio`}
      />

      {/* Section A — flat accent, fixed height matching the photo */}
      <section
        className="relative h-44 w-full overflow-hidden sm:h-60 lg:h-76"
        style={{ background: album.color }}
      >
        <div
          className="absolute left-0 top-0 h-full w-full sm:w-[65%] lg:w-[42%]"
          style={blurStyle(album.coverThumbhash)}
        >
          {hasLadder(album.coverLadder) ? (
            // The hero is this page's Largest Contentful Paint, so it's the
            // one image where the ladder is worth the most. fetchPriority
            // high and no lazy attribute — it's above the fold by definition,
            // so the browser should start it immediately rather than after
            // layout.
            <picture>
              <source
                type="image/avif"
                sizes={HERO_SIZES}
                srcSet={srcSet(album.coverLadder, "avif")}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fallbackSrc(album.coverLadder)}
                srcSet={srcSet(album.coverLadder, "webp")}
                sizes={HERO_SIZES}
                alt={album.title}
                fetchPriority="high"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </picture>
          ) : (
            <Image
              src={album.cover}
              alt={album.title}
              fill
              priority
              sizes={HERO_SIZES}
              className="object-cover"
              unoptimized
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to right, transparent 0%, transparent 35%, ${album.color} 88%)`,
            }}
          />

          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 via-black/10 to-transparent px-4 pb-4 pt-16 lg:hidden">
            <p className="mb-1 text-xs text-white/80">
              {tx("gallery.eyebrow", "Gallery")}
            </p>
            <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">
              {album.title}
            </h1>
            <p className="mt-1 text-sm text-white/90">
              {album.location}, {album.year} · {album.photos.length}{" "}
              {tx("gallery.photos", "photos")}
            </p>
          </div>
        </div>

        {/* Clears the fixed bar rather than sitting under the language
            switcher. Keep in step with StickyHeader's height. */}
        <div
          className="absolute right-4 z-10 h-16 w-16 shadow-xl sm:h-20 sm:w-20 lg:hidden"
          style={{ top: "calc(3.25rem + env(safe-area-inset-top))" }}
        >
          <Image src={album.cover} alt="" fill sizes="80px" className="object-cover" unoptimized/>
        </div>

        <div className="absolute right-16 top-1/2 hidden -translate-y-1/2 items-center gap-8 lg:flex">
          <div className="text-right">
            <p className="mb-2 text-sm text-white/80">
              {tx("gallery.eyebrow", "Gallery")}
            </p>
            <h1 className="whitespace-nowrap text-6xl font-extrabold leading-none">
              {album.title}
            </h1>
            <p className="mt-3 text-lg text-white/90">
              {album.location}, {album.year} · {album.photos.length}{" "}
              {tx("gallery.photos", "photos")}
            </p>
            <p className="max-w-[50vw] text-right text-sm text-white/80">
              {album.description}
            </p>
          </div>
          <div className="relative h-55 w-55 shrink-0 shadow-xl">
            <Image
              src={album.cover}
              alt=""
              fill
              sizes="220px"
              className="rounded-2xl object-cover"
              unoptimized
            />
          </div>
        </div>
      </section>

      {/* Photographer's note — client galleries only */}
      {note && (
        <p className="bg-white/5 px-6 py-3 text-center text-sm leading-relaxed text-white/70 sm:px-10">
          {note}
        </p>
      )}

      {/* Section B — actions, fading to black */}
      <section
        className="relative w-full py-8 sm:py-10"
        style={{
          background: `linear-gradient(to bottom, ${album.color} 0%, rgba(0,0,0,1) 100%)`,
        }}
      >
        <div className="mt-2 flex items-center justify-end gap-5 px-6 sm:px-10">
          <ActionIcon
            icon={<Share2 className="h-4 w-4" />}
            label={tx("gallery.share", "Share")}
            onClick={shareGallery}
          />
          {downloadEnabled && (
            <ActionIcon
              icon={<Download className="h-4 w-4" />}
              label={zipLabel ?? tx("gallery.downloadAll", "Download all")}
              onClick={downloadAll}
              disabled={!!zip || !!batch}
            />
          )}
          <ActionIcon
            icon={<CheckSquare className="h-4 w-4" />}
            label={tx("gallery.select", "Select")}
            onClick={() => setSelectionMode((v) => !v)}
            active={selectionMode}
          />
          <ActionIcon
            icon={<Play className="h-4 w-4" />}
            label={tx("gallery.slideshow", "Slideshow")}
            onClick={startSlideshow}
          />
        </div>
      </section>

      {/* Selection hint */}
      {selectionMode && selected.size === 0 && (
        <p className="px-6 pb-2 pt-4 text-center text-xs text-white/40">
          {tx("gallery.selectHint", "Tap photos to select them. Long-press works too.")}
        </p>
      )}

      {/* Photo grid */}
      <div className="pb-4 pt-4">
        <PhotoGrid
          photos={visiblePhotos}
          onPhotoClick={openLightbox}
          gap={2}
          selectable
          selectionMode={selectionMode}
          selected={selected}
          onToggleSelect={toggleSelect}
          onLongPress={enterSelection}
        />
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center py-10">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="rounded-full border border-white/20 px-8 py-3 text-xs font-semibold uppercase tracking-widest text-white transition hover:border-white/50"
          >
            {tx("gallery.loadMore", "Load more")}
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-10 pb-28 text-center">
        <button
          onClick={() => setRequestOpen(true)}
          className="mx-auto mb-8 flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-xs font-medium text-white/70 transition hover:border-white/40 hover:text-white"
        >
          <MessageCircleQuestion className="h-4 w-4" />
          {tx("gallery.requestCta", "Ask me to change or remove something")}
        </button>

        <p className="text-sm text-white/50">
          {tx("gallery.tagPrompt", "Don't forget to tag me on Insta:")}{" "}
          <a
            href="https://www.instagram.com/saycheeeeeze"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-white hover:underline"
          >
            @saycheeeeeze
          </a>
        </p>
        <Link
          href={`/${locale}`}
          className="mt-4 inline-block text-xs text-white/30 transition hover:text-white/60"
        >
          ← {tx("gallery.back", "Back to saycheeeeze")}
        </Link>
      </footer>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div
          className={`fixed left-1/2 z-60 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900/95 px-2 py-2 shadow-2xl ring-1 ring-white/15 backdrop-blur-md ${BAR_OFFSET}`}
        >
          <span className="px-3 text-xs font-medium tabular-nums text-white/70">
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
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-white/60 transition hover:text-white sm:block"
          >
            {selected.size === visiblePhotos.length
              ? tx("gallery.none", "None")
              : tx("gallery.all", "All")}
          </button>
          <button
            onClick={clearSelection}
            aria-label={tx("gallery.clear", "Clear selection")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed left-1/2 z-70 -translate-x-1/2 rounded-full bg-white px-4 py-2.5 text-xs font-medium text-black shadow-xl ${
            selected.size > 0
              ? "bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] sm:bottom-24"
              : BAR_OFFSET
          }`}
        >
          {toast}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <>
          <Lightbox
            photos={album.photos}
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
            isSelected={selected.has(album.photos[lightboxIndex].src)}
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
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="group flex flex-col items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition ${
          active
            ? "bg-black text-white ring-2 ring-white"
            : "bg-white text-black group-hover:bg-white/80"
        }`}
      >
        {icon}
      </span>
      <span className="whitespace-nowrap text-[10px] text-white/70 transition group-hover:text-white">
        {label}
      </span>
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
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-40"
    >
      {icon}
      <span className="hidden xs:inline sm:inline">{children}</span>
    </button>
  );
}