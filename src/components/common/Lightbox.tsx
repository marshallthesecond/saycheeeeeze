"use client";

import {
  useEffect,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import {
  X, ChevronLeft, ChevronRight, Download, Share2, Check, Link2, ChevronDown,
} from "lucide-react";
import {
  downloadName,
  downloadPhoto,
  photoDeepLink,
  prefetchPhotoFile,
  sharePhotoFiles,
  sharePhotoUrl,
  shareLink,
} from "@/src/lib/gallery";
import {
  FULL_SIZES,
  fallbackSrc,
  hasLadder,
  srcSet,
  type LadderSources,
} from "@/src/lib/ladder";

export interface LightboxPhoto {
  src: string;
  alt?: string;
  /** Real filename from the database, for Download and Share. */
  fileName?: string;
  /** Pre-generated derivatives. Absent → the original via the Optimizer. */
  ladder?: LadderSources;
}

interface LightboxProps {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Selection is optional — omit these and the lightbox has no select button. */
  isSelected?: boolean;
  onToggleSelect?: (src: string) => void;
  unoptimized?: boolean;
  /**
   * Hands the download decision back to the gallery, which owns the tier
   * policy and the remembered choice. Omit it and the button falls back to
   * downloading at the default tier, which is what the portfolio does.
   */
  onDownload?: (photo: LightboxPhoto) => void;
  /** Opens the quality sheet for this one photo. Renders the chevron. */
  onDownloadOptions?: (photo: LightboxPhoto) => void;
  /** What the button will save — "Full quality", "Original file". Shown instead
   *  of the word "Download", so a remembered choice is never a surprise. */
  downloadLabel?: string;
  /** false hides the download button entirely — galleries.download_enabled. */
  canDownload?: boolean;
}

// Subscribes to the OS reduced-motion setting. Defined outside the component
// so the reference is stable — useSyncExternalStore re-subscribes whenever it
// changes identity.
function subscribeToReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const SWIPE_THRESHOLD = 50;
const DISMISS_THRESHOLD = 110;
const TOAST_MS = 2200;

export default function Lightbox({
  photos,
  index,
  onClose,
  onPrev,
  onNext,
  isSelected,
  onToggleSelect,
  onDownload,
  onDownloadOptions,
  downloadLabel,
  canDownload = true,
}: LightboxProps) {
  const photo = photos[index];

  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");

  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  const say = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // ── Keyboard navigation ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  // ── Lock body scroll ─────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Reset any leftover drag when moving between photos. Comparing against the
  // previous index during render is React's documented way to derive state
  // from a changed prop — an effect here would paint the new photo at the old
  // drag offset for one frame first.
  const [lastIndex, setLastIndex] = useState(index);
  if (index !== lastIndex) {
    setLastIndex(index);
    setDrag({ x: 0, y: 0 });
  }

  // Preload the neighbours so a swipe lands on a decoded image instead of a
  // blank frame, and warm the full bytes of the CURRENT photo so that Share
  // can hand navigator.share a File without an await in between — on iOS the
  // await is what kills the share sheet.
  useEffect(() => {
    const neighbours = [
      photos[(index + 1) % photos.length],
      photos[(index - 1 + photos.length) % photos.length],
    ];
    neighbours.forEach((p) => {
      if (!p) return;
      const img = new window.Image();
      if (hasLadder(p.ladder)) {
        // Warm the SAME file the <picture> above will pick, or this preloads
        // one URL and the swipe then requests a different one — all cost, no
        // benefit. Giving the bare <img> a srcset and sizes makes the browser
        // run the same selection it will run for real.
        //
        // AVIF specifically, because that is what any browser reaching this
        // code will choose from the <source>. A browser without AVIF support
        // fails this preload silently and still renders correctly from the
        // WebP source — a warm-up that misses costs nothing.
        img.sizes = FULL_SIZES;
        img.srcset = srcSet(p.ladder, "avif");
      } else {
        img.src = p.src;
      }
    });
    if (photos[index]) prefetchPhotoFile(sharePhotoUrl(photos[index]));
  }, [index, photos]);

  // ── Touch gestures: swipe L/R to navigate, swipe down to close ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    axis.current = "none";
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;

    if (axis.current === "none" && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }

    if (axis.current === "x") setDrag({ x: dx, y: 0 });
    else if (axis.current === "y" && dy > 0) setDrag({ x: 0, y: dy });
  }, []);

  const handleTouchEnd = useCallback(() => {
    const { x, y } = drag;
    setIsDragging(false);

    if (axis.current === "y" && y > DISMISS_THRESHOLD) {
      onClose();
    } else if (axis.current === "x" && Math.abs(x) > SWIPE_THRESHOLD) {
      if (x > 0) onPrev();
      else onNext();
    }

    setDrag({ x: 0, y: 0 });
    touchStart.current = null;
    axis.current = "none";
  }, [drag, onClose, onPrev, onNext]);

  // ── Download ─────────────────────────────────────────────
  // Keeps the original extension. The old version renamed everything to .png,
  // so every .JPG in the WIUT folder arrived mislabelled.
  const handleDownload = useCallback(async () => {
    if (!photo || busy) return;
    // The gallery owns the tier policy and the remembered choice, so when it
    // has given us a handler it decides — including whether to ask first.
    if (onDownload) {
      onDownload(photo);
      return;
    }
    setBusy("download");
    await downloadPhoto(photo);
    setBusy(null);
  }, [photo, busy, onDownload]);

  // ── Share ────────────────────────────────────────────────
  // Prefers sharing the image itself, which is what lets someone drop it
  // straight into an Instagram story. Falls back to a link that reopens the
  // gallery on this exact photo.
  const handleShare = useCallback(async () => {
    if (!photo || busy) return;
    setBusy("share");

    const asFile = await sharePhotoFiles([sharePhotoUrl(photo)], photo.alt ?? downloadName(photo));
    if (asFile === "shared" || asFile === "cancelled") {
      setBusy(null);
      return;
    }

    const result = await shareLink(photoDeepLink(index), photo.alt ?? "Photo");
    if (result === "copied") say("Link copied");
    if (result === "unavailable") say("Sharing isn't available in this browser");
    setBusy(null);
  }, [photo, index, busy, say]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(photoDeepLink(index));
      say("Link copied");
    } catch {
      say("Couldn't copy the link");
    }
  }, [index, say]);

  if (!photo) return null;

  const dismissProgress = Math.min(drag.y / (DISMISS_THRESHOLD * 2), 0.6);
  const chipClass =
    "flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xs font-medium min-w-11 min-h-11 px-3 rounded-full transition disabled:opacity-40";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        backgroundColor: `rgba(0,0,0,${0.97 - dismissProgress})`,
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      {/* ── Top bar: counter + actions ── */}
      <div
        className="relative z-10 flex shrink-0 items-center justify-between px-4 py-3 transition-opacity"
        style={{ opacity: isDragging ? 0 : 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/60">
            {index + 1} / {photos.length}
          </span>
          {photo.alt && (
            <span className="hidden rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/60 sm:inline">
              {photo.alt}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onToggleSelect && (
            <button
              onClick={() => onToggleSelect(photo.src)}
              aria-pressed={isSelected}
              className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${
                isSelected
                  ? "bg-white text-black"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              title={isSelected ? "Selected" : "Select"}
            >
              <Check className="h-4 w-4" strokeWidth={3} />
              <span className="hidden sm:inline">
                {isSelected ? "Selected" : "Select"}
              </span>
            </button>
          )}
          <button
            onClick={handleCopyLink}
            className={`${chipClass} hidden sm:flex`}
            title="Copy link to this photo"
          >
            <Link2 className="h-4 w-4" />
          </button>
          <button
            onClick={handleShare}
            disabled={busy === "share"}
            className={chipClass}
            title="Share"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">
              {busy === "share" ? "Preparing…" : "Share"}
            </span>
          </button>
          {canDownload && (
            <button
              onClick={handleDownload}
              disabled={busy === "download"}
              className={chipClass}
              title="Download"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">
                {busy === "download" ? "Saving…" : (downloadLabel ?? "Download")}
              </span>
            </button>
          )}
          {/* A remembered choice you cannot see or change is a trap, so the
              button says what it will save and this opens the sheet to
              change it. */}
          {canDownload && onDownloadOptions && photo && (
            <button
              onClick={() => onDownloadOptions(photo)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:bg-white/30"
              title="Download options"
              aria-label="Download options"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:bg-white/30"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Image area ── */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <button
          className="absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 transition hover:bg-white/25 sm:flex"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          title="Previous"
        >
          <ChevronLeft className="h-5 w-5 text-white" />
        </button>
        <button
          className="absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 transition hover:bg-white/25 sm:flex"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          title="Next"
        >
          <ChevronRight className="h-5 w-5 text-white" />
        </button>

        <div
          className="relative h-full w-full touch-pan-y sm:mx-20"
          style={{
            transform: `translate(${drag.x}px, ${drag.y}px)`,
            transition:
              isDragging || reduceMotion
                ? "none"
                : "transform 0.25s cubic-bezier(0.22,1,0.36,1)",
          }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {hasLadder(photo.ladder) ? (
            // The top rung is both smaller AND sharper than what the Optimizer
            // was returning here: this used to pull the original capped at
            // 1600px and re-encoded on the fly, where 2048.avif is a larger
            // image in fewer bytes.
            //
            // Hand-rolled rather than next/image because <picture> is the whole
            // point — the browser picks AVIF or WebP itself. The classes
            // reproduce what `fill` does: absolutely positioned, filling the
            // parent, letterboxed by object-contain.
            <picture>
              <source
                type="image/avif"
                sizes={FULL_SIZES}
                srcSet={srcSet(photo.ladder, "avif")}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fallbackSrc(photo.ladder)}
                srcSet={srcSet(photo.ladder, "webp")}
                sizes={FULL_SIZES}
                alt={photo.alt ?? ""}
                // Never lazy — this element only exists once the viewer has
                // deliberately opened the photo.
                fetchPriority="high"
                decoding="async"
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
              />
            </picture>
          ) : (
            <Image
              src={photo.src}
              alt={photo.alt ?? ""}
              fill
              sizes="100vw"
              className="pointer-events-none select-none object-contain"
              priority
              unoptimized
            />
          )}
        </div>
      </div>

      {/* ── Footer hint + toast ── */}
      <div
        className="flex shrink-0 flex-col items-center gap-2 py-4 transition-opacity"
        style={{ opacity: isDragging ? 0 : 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        {toast ? (
          <p className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/80">
            {toast}
          </p>
        ) : (
          <p className="text-[10px] tracking-wide text-white/25 sm:hidden">
            Swipe to browse · swipe down to close
          </p>
        )}
      </div>
    </div>
  );
}