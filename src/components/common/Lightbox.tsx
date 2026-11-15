"use client";

import {
  useEffect,
  useLayoutEffect,
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
  blurStyle,
  fallbackSrc,
  hasLadder,
  srcSet,
  type LadderSources,
} from "@/src/lib/ladder";
import MarkButtons from "./MarkButtons";
import type { PhotoMark } from "@/src/lib/photo-marks";

export interface LightboxPhoto {
  src: string;
  /** The photos row id — the handle a mark is keyed on. See AlbumPhoto.id. */
  id?: string;
  /** The client's request for this photograph — client galleries only. */
  mark?: PhotoMark | null;
  alt?: string;
  /** Real filename from the database, for Download and Share. */
  fileName?: string;
  /** Pre-generated derivatives. Absent → the original via the Optimizer. */
  ladder?: LadderSources;
  /** Shown behind the photo while it decodes, and left showing if it fails. */
  thumbhash?: string;
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
  /**
   * Keep / Publish / Delete for the photograph on screen. Omit it and the
   * lightbox has no marking row, which is how the portfolio is unaffected.
   *
   * On its own line above the toolbar rather than squeezed into it: the
   * toolbar is already five controls wide on a phone, and these three are the
   * reason a client opened the photograph full-screen in the first place.
   */
  onMark?: (photoId: string, next: PhotoMark | null) => void;
  markBusy?: boolean;
  tx?: (key: string, fallback: string) => string;
}

// Subscribes to the OS reduced-motion setting. Defined outside the component
// so the reference is stable — useSyncExternalStore re-subscribes whenever it
// changes identity.
function subscribeToReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const TOAST_MS = 2200;

// THE STRIP. The photograph on screen and its two neighbours sit side by side
// on one strip, and a swipe moves the strip, so the next photograph is already
// under the finger as the current one leaves — the way a phone's own gallery
// behaves. Letting go either finishes the move or lets the strip settle back.

/** Space between two photographs while they slide past, in px. */
const GAP = 24;
const SLIDE_MS = 320;
/** Fast at first, long gentle landing: reads as momentum rather than a tween. */
const MOTION = `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.8, 0.26, 1)`;
/** How far a finger moves before it counts as a swipe rather than a tap. */
const SLOP = 8;
/** Swipe up this far and the photograph closes. */
const DISMISS_PX = 90;
const BACKDROP = "rgba(0,0,0,0.97)";

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Where the strip sits when photograph number `pos` is the one on screen. */
function stripTransform(pos: number, dx = 0, dy = 0): string {
  return `translate3d(calc(${-pos} * (100% + ${GAP}px) + ${dx}px), ${dy}px, 0)`;
}

/** Where one photograph sits on the strip. */
function slideTransform(pos: number): string {
  return `translate3d(calc(${pos} * (100% + ${GAP}px)), 0, 0)`;
}

interface Gesture {
  active: boolean;
  id: number;
  x0: number;
  y0: number;
  /** Where the strip already was when the finger landed (mid-slide), in px. */
  offset: number;
  axis: "none" | "x" | "y";
  dx: number;
  dy: number;
  lastX: number;
  lastY: number;
  lastT: number;
  /** px per ms, smoothed. */
  vx: number;
  vy: number;
}

const IDLE: Gesture = {
  active: false, id: -1, x0: 0, y0: 0, offset: 0, axis: "none",
  dx: 0, dy: 0, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0,
};

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
  onMark,
  markBusy = false,
  tx,
}: LightboxProps) {
  const photo = photos[index];

  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<"share" | "download" | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(IDLE);
  const closing = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The position the strip was last set to, so the next one knows whether to slide. */
  const synced = useRef<{ pos: number; epoch: number } | null>(null);

  /**
   * `pos` numbers the photographs WITHOUT wrapping round: stepping from the
   * last one to the first is one more step to the right, not a trip back across
   * the whole strip. `index` is the last value of the prop it was matched to.
   * `epoch` changes when the gallery jumps more than one photograph, which
   * remounts the strip so it does not slide across everything in between.
   */
  const [view, setView] = useState({ pos: index, index, epoch: 0 });
  if (index !== view.index) {
    // Changed from outside: the slideshow's timer, or a deep link. Comparing
    // against the previous value during render is React's documented way to
    // derive state from a changed prop.
    const n = Math.max(photos.length, 1);
    let d = index - view.index;
    if (d > n / 2) d -= n;
    else if (d < -n / 2) d += n;
    setView({
      pos: view.pos + d,
      index,
      epoch: Math.abs(d) > 1 ? view.epoch + 1 : view.epoch,
    });
  }

  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  const say = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  /**
   * One photograph forward or back, sliding.
   *
   * The strip's own state moves first and the gallery is told in the same
   * breath, so React commits both together and the strip is never one render
   * ahead of the photograph list.
   */
  const step = useCallback(
    (dir: 1 | -1) => {
      if (closing.current) return;
      const strip = stripRef.current;
      if (strip) strip.style.transition = reduceMotion ? "none" : MOTION;
      setView((v) => ({
        ...v,
        pos: v.pos + dir,
        index: mod(v.index + dir, Math.max(photos.length, 1)),
      }));
      if (dir > 0) onNext();
      else onPrev();
    },
    [onNext, onPrev, photos.length, reduceMotion],
  );

  // Puts the strip where the state says, after every render and before paint.
  // This is the ONLY place outside a live drag that writes its position, so a
  // gallery that refuses a step (or changes the photograph by itself) can never
  // leave the strip showing an empty slot.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip || gesture.current.active || closing.current) return;
    const last = synced.current;
    if (!last || last.epoch !== view.epoch) {
      // First paint, or a jump: appear in place.
      strip.style.transition = "none";
    } else if (last.pos !== view.pos) {
      strip.style.transition = reduceMotion ? "none" : MOTION;
    }
    strip.style.transform = stripTransform(view.pos);
    synced.current = { pos: view.pos, epoch: view.epoch };
  });

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  // Lock the page behind, and switch off the browser's pull-to-refresh while a
  // photograph is open: a swipe here must never reload the gallery.
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = "";
      html.style.overscrollBehavior = before;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // The neighbours are on the strip already, so the browser is loading them.
  // What still needs warming is the full file of the CURRENT photo, so that
  // Share can hand navigator.share a File without an await in between — on iOS
  // the await is what kills the share sheet.
  useEffect(() => {
    if (photos[index]) prefetchPhotoFile(sharePhotoUrl(photos[index]));
  }, [index, photos]);

  // Gestures: sideways to move between photographs, up to close.
  //
  // Up, not down: pulling down is the browser's own "reload this page", and a
  // firm downward swipe was doing exactly that instead of closing.
  //
  // The strip is moved by writing its style directly rather than through
  // state. A finger reports sixty to a hundred and twenty positions a second,
  // and re-rendering this component for each one is what made the old swipe
  // stutter.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current.active || closing.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const strip = stripRef.current;
    if (!strip) return;

    // Caught mid-slide: start from where the strip actually is, not from where
    // it was heading, or it would jump under the finger.
    const width = strip.offsetWidth;
    const now = new DOMMatrixReadOnly(getComputedStyle(strip).transform).m41;
    const offset = now - -view.pos * (width + GAP);

    gesture.current = {
      ...IDLE,
      active: true,
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      offset: Math.abs(offset) < 1 ? 0 : offset,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: e.timeStamp,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const strip = stripRef.current;
    const root = rootRef.current;
    if (!g.active || e.pointerId !== g.id || !strip || !root) return;

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;

    if (g.axis === "none") {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      g.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      strip.style.transition = "none";
      root.style.transition = "none";
    }

    const dt = e.timeStamp - g.lastT;
    if (dt > 0) {
      g.vx = 0.6 * ((e.clientX - g.lastX) / dt) + 0.4 * g.vx;
      g.vy = 0.6 * ((e.clientY - g.lastY) / dt) + 0.4 * g.vy;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      g.lastT = e.timeStamp;
    }

    if (g.axis === "x") {
      // One photograph has nowhere to go: it gives a little and comes back.
      g.dx = photos.length > 1 ? g.offset + dx : dx * 0.3;
      strip.style.transform = stripTransform(view.pos, g.dx, 0);
    } else {
      // Up follows the finger. Down is held back hard, so it reads as "not
      // this way" instead of as nothing happening.
      g.dy = dy < 0 ? dy : dy * 0.15;
      strip.style.transform = stripTransform(view.pos, 0, g.dy);
      const lift = Math.min(Math.max(-g.dy, 0) / 320, 1);
      root.style.backgroundColor = `rgba(0,0,0,${0.97 - lift * 0.6})`;
      if (lift > 0.04) root.dataset.lifting = "";
      else delete root.dataset.lifting;
    }
  };

  /** Slides the photograph off the top and closes. */
  const dismiss = () => {
    const strip = stripRef.current;
    const root = rootRef.current;
    closing.current = true;
    if (!strip || !root || reduceMotion) {
      onClose();
      return;
    }
    strip.style.transition = "transform 240ms cubic-bezier(0.4, 0, 1, 1)";
    strip.style.transform = stripTransform(view.pos, 0, -window.innerHeight);
    root.style.transition = "background-color 240ms ease";
    root.style.backgroundColor = "rgba(0,0,0,0)";
    root.dataset.lifting = "";
    closeTimer.current = setTimeout(onClose, 230);
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g.active || e.pointerId !== g.id) return;
    gesture.current = { ...g, active: false };

    const strip = stripRef.current;
    const root = rootRef.current;
    if (!strip || !root || g.axis === "none") return; // a tap

    strip.style.transition = reduceMotion ? "none" : MOTION;
    root.style.transition = reduceMotion ? "none" : `background-color ${SLIDE_MS}ms ease`;

    if (g.axis === "x") {
      const width = strip.offsetWidth || 1;
      // Far enough, or a quick flick in the same direction.
      const far = Math.abs(g.dx) > width * 0.2;
      const flick =
        Math.abs(g.vx) > 0.35 && Math.abs(g.dx) > 12 && Math.sign(g.vx) === Math.sign(g.dx);
      if (!cancelled && photos.length > 1 && (far || flick)) {
        step(g.dx < 0 ? 1 : -1);
        return;
      }
      strip.style.transform = stripTransform(view.pos);
      return;
    }

    const up = -g.dy;
    if (!cancelled && (up > DISMISS_PX || (g.vy < -0.5 && up > 24))) {
      dismiss();
      return;
    }
    strip.style.transform = stripTransform(view.pos);
    root.style.backgroundColor = BACKDROP;
    delete root.dataset.lifting;
  };

  // Download
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

  // Share
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

  const count = photos.length;
  // The photograph on screen and one either side; a gallery of one has none.
  const slots = count > 1 ? [-1, 0, 1] : [0];
  const hint = tx
    ? tx("gallery.swipeHint", "Swipe to browse, swipe up to close")
    : "Swipe to browse, swipe up to close";
  // Icons only, no button shape: a 36px target around a 16px icon.
  const chipClass =
    "flex h-9 w-9 items-center justify-center text-white/75 transition hover:text-white active:scale-90 disabled:opacity-40";

  return (
    <div
      ref={rootRef}
      // `group`: the bars fade while the photograph is being lifted away, which
      // is switched by a data attribute so it costs no render.
      className="group fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        backgroundColor: BACKDROP,
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        // Every gesture in here is ours: no page scroll, no pull-to-refresh.
        touchAction: "none",
      }}
      onClick={onClose}
    >
      {/* Top bar: counter + actions */}
      <div
        // flex-wrap so the marking row above can claim a full line of its own;
        // without it the row becomes a third item squeezed between the
        // counter and the toolbar.
        className="relative z-10 flex shrink-0 flex-wrap items-center justify-between px-4 py-3 transition-opacity duration-150 group-data-[lifting]:opacity-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Its own full-width row above the toolbar, centred. Five toolbar
            controls plus three marks does not fit a 390px phone, and the marks
            are the ones that must not be the ones that get cut. */}
        {onMark && photo?.id && tx && (
          <div className="mb-1 flex w-full justify-center">
            <MarkButtons
              variant="bar"
              tx={tx}
              mark={photo.mark ?? null}
              busy={markBusy}
              onMark={(next) => onMark(photo.id as string, next)}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-white/60">
            {index + 1} / {photos.length}
          </span>
          {photo.alt && (
            <span className="hidden max-w-[40vw] truncate text-xs text-white/45 sm:inline">
              {photo.alt}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {onToggleSelect && (
            <button
              onClick={() => onToggleSelect(photo.src)}
              aria-pressed={isSelected}
              className={`${chipClass} ${isSelected ? "text-white" : ""}`}
              title={isSelected ? "Selected" : "Select"}
              aria-label={isSelected ? "Selected" : "Select"}
            >
              {/* An empty ring until it is selected, then a white disc with
                  the tick in it, as in a phone's own gallery. */}
              <span
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${
                  isSelected ? "bg-white text-black" : "ring-[1.5px] ring-current"
                }`}
              >
                <Check className={`h-3 w-3 ${isSelected ? "" : "opacity-0"}`} strokeWidth={3} />
              </span>
            </button>
          )}
          <button
            onClick={handleCopyLink}
            className={`${chipClass} hidden sm:flex`}
            title="Copy link to this photo"
          >
            <Link2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={handleShare}
            disabled={busy === "share"}
            className={chipClass}
            title={busy === "share" ? "Preparing…" : "Share"}
            aria-label="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>
          {canDownload && (
            <button
              onClick={handleDownload}
              disabled={busy === "download"}
              className={chipClass}
              title={busy === "download" ? "Saving…" : (downloadLabel ?? "Download")}
              aria-label={downloadLabel ?? "Download"}
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          {/* A remembered choice you cannot see or change is a trap, so the
              button says what it will save and this opens the sheet to
              change it. */}
          {canDownload && onDownloadOptions && photo && (
            <button
              onClick={() => onDownloadOptions(photo)}
              className={`${chipClass} -ml-1.5 w-6`}
              title="Download options"
              aria-label="Download options"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className={chipClass}
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Image area: the stage the strip slides across. */}
      <div
        className="relative min-h-0 flex-1 select-none"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
      >
        <button
          className="absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 p-2 text-white/60 transition hover:text-white sm:flex"
          // Kept away from the stage's own handler, which would otherwise
          // capture the pointer and swallow the click.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
          title="Previous"
          aria-label="Previous"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={1.5} />
        </button>
        <button
          className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 p-2 text-white/60 transition hover:text-white sm:flex"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
          title="Next"
          aria-label="Next"
        >
          <ChevronRight className="h-6 w-6" strokeWidth={1.5} />
        </button>

        <div
          // A jump of more than one photograph gets a new strip rather than a
          // slide across everything in between.
          key={view.epoch}
          ref={stripRef}
          className="absolute inset-0 will-change-transform"
        >
          {slots.map((slot) => {
            const shown = photos[mod(index + slot, count)];
            const current = slot === 0;
            return (
              <div
                // Keyed on the unwrapped position, so a photograph keeps its
                // element (and its decoded image) as it moves from "next" to
                // "current" to "previous".
                key={view.pos + slot}
                className="absolute inset-0 sm:px-16"
                style={{ transform: slideTransform(view.pos + slot) }}
                aria-hidden={!current}
              >
                <div
                  className="relative h-full w-full"
                  style={{
                    // contain, not the cover that blurStyle defaults to: the
                    // photo is object-contain here, so a cover-sized blur
                    // would spill past its edges instead of sitting exactly
                    // behind it.
                    ...blurStyle(shown.thumbhash),
                    backgroundSize: "contain",
                    backgroundRepeat: "no-repeat",
                  }}
                >
                  {hasLadder(shown.ladder) ? (
                    // Hand-rolled rather than next/image because <picture> is
                    // the whole point — the browser picks AVIF or WebP itself.
                    // The classes reproduce what `fill` does: absolutely
                    // positioned, filling the parent, letterboxed by
                    // object-contain.
                    <picture>
                      <source
                        type="image/avif"
                        sizes={FULL_SIZES}
                        srcSet={srcSet(shown.ladder, "avif")}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fallbackSrc(shown.ladder)}
                        srcSet={srcSet(shown.ladder, "webp")}
                        sizes={FULL_SIZES}
                        alt={current ? (shown.alt ?? "") : ""}
                        // Never lazy: the one on screen was opened on purpose,
                        // and its neighbours have to be decoded before a swipe
                        // brings them in.
                        fetchPriority={current ? "high" : "low"}
                        decoding="async"
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                        onLoad={(e) => { e.currentTarget.style.visibility = ""; }}
                        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                      />
                    </picture>
                  ) : (
                    <Image
                      src={shown.src}
                      alt={current ? (shown.alt ?? "") : ""}
                      fill
                      sizes="100vw"
                      className="pointer-events-none select-none object-contain"
                      priority={current}
                      draggable={false}
                      unoptimized
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                      onLoad={(e) => { e.currentTarget.style.visibility = ""; }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer hint + toast */}
      <div
        className="flex shrink-0 flex-col items-center gap-2 py-4 transition-opacity duration-150 group-data-[lifting]:opacity-0"
        onClick={(e) => e.stopPropagation()}
      >
        {toast ? (
          <p className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/80">
            {toast}
          </p>
        ) : (
          <p className="text-[10px] text-white/30 sm:hidden">{hint}</p>
        )}
      </div>
    </div>
  );
}