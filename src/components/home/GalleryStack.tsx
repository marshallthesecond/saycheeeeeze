"use client";

// The albums on Home as a stack you flick through (2026-11-17): one album
// faces you in the middle, and the ones before and after it stand on either
// side like books on a shelf, turned edge-on. Scrolling turns the middle one
// away into the shelf while the next one steps forward, grows and turns to
// face you. The cards are the Albums cards of the Portfolio page, in glass.
//
// HOW IT MOVES. The row is a real sideways scroller with one snap point per
// album, so a finger, a trackpad and the keyboard all get the browser's own
// momentum and snapping. Nothing visible scrolls with it: the stage is stuck
// in place (position: sticky) and only the scroll position is read, as a
// number like 3.42 ("42% of the way from the fourth album to the fifth").
// Every card's place, turn and size is a pure function of its distance from
// that number (pose(), below), written straight to the element on each
// scroll event. No React render per frame, and nothing to animate towards:
// the picture is always exactly where the scroll is, which is what makes it
// smooth. The server renders the same function for the starting album, so
// there is no jump when the page wakes up.
//
// Sizes are all relative to the card (translateX in % of its own width, the
// perspective a multiple of it), and the card is sized from the column
// (container units), so the same stack fits a phone, the 300px column on a
// computer and a tablet without measuring anything.
//
// A tap on a side card brings it to the middle; a tap on the middle one
// opens the album. With a mouse it can also be dragged. Only the card facing
// you shows its name and count: on a shelved card they would be a smudge.

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import PhotoFrame from "@/src/components/common/PhotoFrame";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { blurStyle } from "@/src/lib/ladder";
import type { AlbumData } from "@/src/lib/albums";

// ------------------------------------------------------------ the geometry

/** How far the first card of a shelf stands from the middle, in card widths. */
const GAP = 0.68;
/** Between two cards on a shelf, in card widths. */
const SPACING = 0.125;
/** How far a shelved card is turned away, in degrees. */
const TURN = 66;
/** A shelved card's size against the middle one. */
const SMALL = 0.84;
/** Cards shown on each side; the last one fades out. */
const SIDE = 6;
/** Scroll distance from one album to the next, in card widths. */
const STEP = GAP;

const CARD = "clamp(8.25rem, 44cqw, 13.5rem)";
const STEP_WIDTH = `calc(var(--stack-card) * ${STEP})`;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * From the middle (0) to the shelf (1), sideways: leaves the middle briskly
 * and arrives at exactly the speed the shelf moves at, so a card joining the
 * shelf does not jolt. (A cubic through 0 and GAP with those two slopes.)
 */
function slide(u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (u3 - 2 * u2 + u) * 1 + (3 * u2 - 2 * u3) * GAP + (u3 - u2) * SPACING;
}

interface Pose {
  transform: string;
  zIndex: number;
  /** 0 to 1: fades the outermost cards. */
  opacity: number;
  /** 0 to 1: how much a shelved card is dimmed. */
  shade: number;
  /** 1 to 0: the name and count, which only the card facing you shows. */
  words: number;
  /** 0 to 1: this album's colour behind the stack. */
  glow: number;
  hidden: boolean;
}

/** Where a card is, `d` albums away from the middle (negative = before it). */
function pose(d: number): Pose {
  const a = Math.abs(d);
  const side = d < 0 ? -1 : 1;
  const u = Math.min(a, 1);
  const far = Math.max(a - 1, 0);
  // Eased, so a small movement barely turns the middle card.
  const t = u * u * (3 - 2 * u);

  const x = side * (slide(u) + far * SPACING) * 100;
  const turn = -side * TURN * t;
  const scale = 1 - (1 - SMALL) * t - Math.min(far, SIDE) * 0.012;
  const opacity = clamp(SIDE + 0.6 - a, 0, 1);

  return {
    transform:
      `translateX(${x.toFixed(2)}%) perspective(calc(var(--stack-card) * 4.5)) ` +
      `rotateY(${turn.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    zIndex: 200 - Math.round(a * 10),
    opacity,
    shade: clamp(t * 0.62 + Math.min(far, SIDE) * 0.07, 0, 1),
    words: clamp(1 - u * 1.6, 0, 1),
    glow: clamp(1 - a, 0, 1),
    hidden: opacity === 0,
  };
}

function cardStyle(p: Pose): CSSProperties {
  return {
    transform: p.transform,
    zIndex: p.zIndex,
    opacity: p.opacity,
    visibility: p.hidden ? "hidden" : "visible",
  };
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Glass, without a backdrop blur: twenty blurred layers turning in 3D would not stay smooth. */
const GLASS_CARD: CSSProperties = {
  background:
    "linear-gradient(to bottom, var(--glass-sheen), transparent 42%), color-mix(in oklab, var(--card) 86%, transparent)",
  border: "1px solid var(--glass-ring)",
  boxShadow: "inset 0 1px 0 0 var(--glass-edge), inset 0 -1px 0 0 oklch(0 0 0 / 0.05), var(--glass-shadow)",
};

/**
 * Side by side when both fit (a phone, most tablets), each on its own full-
 * width line when they do not (the 300px column, longer languages). Never
 * cut, never wider than the column.
 */
const GLASS_BUTTON =
  "btn-glass inline-flex h-10 flex-[1_1_auto] items-center justify-center gap-1.5 whitespace-nowrap px-3.5 text-[13px] font-semibold xl:h-9 xl:basis-full";
const GLASS_ICON = "btn-glass hidden size-8 items-center justify-center sm:flex";

export default function GalleryStack({
  albums,
  onPrivate,
  className = "",
}: {
  albums: AlbumData[];
  /** Opens the list of private galleries. */
  onPrivate: () => void;
  className?: string;
}) {
  const { t, locale } = useT();
  const n = albums.length;
  // A few behind it on the left from the start, so both shelves are there.
  const start = Math.min(3, Math.floor((n - 1) / 2));

  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLAnchorElement | null)[]>([]);
  const shades = useRef<(HTMLSpanElement | null)[]>([]);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const glows = useRef<(HTMLSpanElement | null)[]>([]);
  /** Pixels of scroll from one album to the next. */
  const stepPx = useRef(1);
  /** Where the stack is, as a fractional album index. */
  const at = useRef(start);
  const tween = useRef<number | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean; lastX: number; lastT: number; v: number } | null>(null);
  const justDragged = useRef(false);
  const [index, setIndex] = useState(start);

  /** Puts every card where `p` says. Straight to the elements: this runs on every scroll event. */
  const apply = useCallback(
    (p: number) => {
      at.current = p;
      for (let i = 0; i < n; i++) {
        const card = cards.current[i];
        if (!card) continue;
        const d = i - p;
        // Far outside the shelves: hidden once, then left alone.
        if (Math.abs(d) > SIDE + 1.5) {
          if (card.style.visibility !== "hidden") {
            card.style.visibility = "hidden";
            card.style.opacity = "0";
          }
          continue;
        }
        const q = pose(d);
        card.style.transform = q.transform;
        card.style.zIndex = String(q.zIndex);
        card.style.opacity = String(q.opacity);
        card.style.visibility = q.hidden ? "hidden" : "visible";
        const shade = shades.current[i];
        if (shade) shade.style.opacity = String(q.shade);
        const text = words.current[i];
        if (text) text.style.opacity = String(q.words);
        const glow = glows.current[i];
        if (glow) glow.style.opacity = String(q.glow);
      }
      const nearest = clamp(Math.round(p), 0, n - 1);
      setIndex((was) => (was === nearest ? was : nearest));
    },
    [n],
  );

  const stopTween = useCallback(() => {
    if (tween.current === null) return;
    cancelAnimationFrame(tween.current);
    tween.current = null;
    if (scroller.current) scroller.current.style.scrollSnapType = "";
  }, []);

  /** Glides to an album: our own curve, so a tap moves as softly as a swipe. */
  const glideTo = useCallback(
    (target: number) => {
      const el = scroller.current;
      if (!el) return;
      stopTween();
      const to = clamp(Math.round(target), 0, n - 1) * stepPx.current;
      const from = el.scrollLeft;
      const distance = Math.abs(to - from);
      if (distance < 1) {
        el.style.scrollSnapType = "";
        return;
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.scrollLeft = to;
        el.style.scrollSnapType = "";
        return;
      }
      // Snapping would fight a scroll we are driving ourselves.
      el.style.scrollSnapType = "none";
      const albumsAway = distance / stepPx.current;
      const duration = 560 + Math.min(Math.max(albumsAway - 1, 0), 5) * 110;
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / duration);
        el.scrollLeft = from + (to - from) * ease(k);
        if (k < 1) {
          tween.current = requestAnimationFrame(tick);
        } else {
          tween.current = null;
          el.style.scrollSnapType = "";
        }
      };
      tween.current = requestAnimationFrame(tick);
    },
    [n, stopTween],
  );

  // Measure the step, start on the starting album, and follow the scroll.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const first = el.querySelector<HTMLElement>("[data-step]");
      const width = first?.getBoundingClientRect().width ?? 0;
      if (width <= 0) return;
      stepPx.current = width;
      // The same album stays in the middle through a resize.
      el.scrollLeft = at.current * width;
    };
    measure();

    const onScroll = () => {
      const p = el.scrollLeft / stepPx.current;
      // Settled on an album: exactly on it, not a hundredth of a pixel off.
      apply(Math.abs(p - Math.round(p)) < 0.012 ? Math.round(p) : p);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      resize.disconnect();
    };
  }, [apply]);

  useEffect(() => stopTween, [stopTween]);

  if (n === 0) return null;

  return (
    <section aria-labelledby="stack-h" className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 xl:px-1">
        <h2 id="stack-h" className="text-xl font-bold tracking-tight sm:text-2xl xl:text-xl">
          {t("about.galleries")}
        </h2>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] tabular-nums text-muted-foreground sm:hidden" aria-live="polite">
            {index + 1} / {n}
          </span>
          <button
            type="button"
            onClick={() => glideTo(Math.round(at.current) - 1)}
            disabled={index === 0}
            aria-label={t("home.shelfBack")}
            className={GLASS_ICON}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => glideTo(Math.round(at.current) + 1)}
            disabled={index === n - 1}
            aria-label={t("home.shelfForward")}
            className={GLASS_ICON}
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <div className="@container">
        <div
          ref={scroller}
          role="group"
          aria-label={t("about.galleries")}
          className="relative cursor-grab select-none overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={
            {
              "--stack-card": CARD,
              // The shelves fade out at the edges instead of being cut.
              maskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
              WebkitMaskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
            } as CSSProperties
          }
          onKeyDown={(e) => {
            const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (by) {
              e.preventDefault();
              glideTo(Math.round(at.current) + by);
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              glideTo(e.key === "Home" ? 0 : n - 1);
            }
          }}
          onWheel={stopTween}
          onTouchStart={stopTween}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            justDragged.current = false;
            if (e.pointerType !== "mouse" || e.button !== 0) return;
            stopTween();
            drag.current = {
              x: e.clientX,
              left: e.currentTarget.scrollLeft,
              moved: false,
              lastX: e.clientX,
              lastT: e.timeStamp,
              v: 0,
            };
          }}
          onPointerMove={(e) => {
            const g = drag.current;
            if (!g) return;
            const dx = e.clientX - g.x;
            if (!g.moved) {
              if (Math.abs(dx) < 5) return;
              g.moved = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.style.scrollSnapType = "none";
              e.currentTarget.style.cursor = "grabbing";
            }
            const dt = e.timeStamp - g.lastT;
            if (dt > 0) {
              g.v = 0.7 * ((e.clientX - g.lastX) / dt) + 0.3 * g.v;
              g.lastX = e.clientX;
              g.lastT = e.timeStamp;
            }
            e.currentTarget.scrollLeft = g.left - dx;
          }}
          onPointerUp={(e) => {
            const g = drag.current;
            drag.current = null;
            if (!g?.moved) return;
            justDragged.current = true;
            e.currentTarget.style.cursor = "";
            // Carries on a little in the direction it was thrown, then settles on an album.
            const stale = e.timeStamp - g.lastT > 80;
            const thrown = stale ? 0 : (-g.v * 220) / stepPx.current;
            glideTo(at.current + clamp(thrown, -4, 4));
          }}
          onPointerCancel={(e) => {
            if (drag.current?.moved) {
              e.currentTarget.style.cursor = "";
              glideTo(at.current);
            }
            drag.current = null;
          }}
          onClickCapture={(e) => {
            // The click that ends a drag is not a click on a card.
            if (justDragged.current) {
              justDragged.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <div className="flex w-max">
            {/* The stage: stuck in place while the row scrolls under it. */}
            <div className="sticky left-0 grid w-[100cqw] shrink-0 place-items-center pb-7 pt-4 [margin-right:-100cqw]">
              {/* The middle album's colours, soft, behind the stack. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-55"
                style={{
                  // Gone well before the edges, so it reads as light, not as a box.
                  maskImage: "radial-gradient(52% 48% at 50% 46%, black 15%, transparent 100%)",
                  WebkitMaskImage: "radial-gradient(52% 48% at 50% 46%, black 15%, transparent 100%)",
                }}
              >
                {albums.map((a, i) =>
                  a.coverThumbhash ? (
                    <span
                      key={a.slug}
                      ref={(el) => {
                        glows.current[i] = el;
                      }}
                      className="absolute inset-0 will-change-[opacity]"
                      style={{ ...blurStyle(a.coverThumbhash), opacity: pose(i - start).glow }}
                    />
                  ) : null,
                )}
              </span>

              {albums.map((a, i) => {
                const q = pose(i - start);
                return (
                  <Link
                    key={a.slug}
                    ref={(el) => {
                      cards.current[i] = el;
                    }}
                    href={`/${locale}/albums/${a.slug}`}
                    draggable={false}
                    aria-current={i === index ? "true" : undefined}
                    className="relative block w-[var(--stack-card)] rounded-2xl p-2 text-foreground [grid-area:1/1] will-change-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    style={{ ...GLASS_CARD, ...cardStyle(q) }}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      // A card on a shelf comes to the middle; the middle one opens.
                      if (i !== Math.round(at.current)) {
                        e.preventDefault();
                        glideTo(i);
                      }
                    }}
                    onFocus={(e) => {
                      if (e.currentTarget.matches(":focus-visible")) glideTo(i);
                    }}
                  >
                    <span className="relative block">
                      <PhotoFrame
                        ladder={a.coverLadder}
                        src={a.cover}
                        thumbhash={a.coverThumbhash}
                        alt=""
                        sizes="(min-width: 640px) 216px, 46vw"
                        priority={Math.abs(i - start) <= 1}
                        className="aspect-square w-full rounded-xl"
                      />
                      {/* Light catching the glass over the photograph. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-xl"
                        style={{
                          background: "linear-gradient(118deg, oklch(1 0 0 / 0.2), transparent 36%)",
                          boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.1)",
                        }}
                      />
                    </span>
                    <span
                      ref={(el) => {
                        words.current[i] = el;
                      }}
                      className="flex h-[3.25rem] flex-col items-center justify-center px-1 pt-1 text-center will-change-[opacity]"
                      style={{ opacity: q.words }}
                    >
                      <span className="line-clamp-2 text-[13px] font-bold leading-[1.15]">{a.title}</span>
                      <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                        {t("portfolio.photoCount", { n: a.photoCount })}
                      </span>
                    </span>
                    {/* A shelved card stands in the shade. */}
                    <span
                      aria-hidden
                      ref={(el) => {
                        shades.current[i] = el;
                      }}
                      className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black/30 will-change-[opacity] dark:bg-black/50"
                      style={{ opacity: q.shade }}
                    />
                  </Link>
                );
              })}
            </div>

            {/* One snap point per album; nothing to see. */}
            {albums.map((a, i) => (
              <span
                key={a.slug}
                aria-hidden
                {...(i === 0 ? { "data-step": "" } : {})}
                className="block shrink-0 snap-start"
                style={{ width: STEP_WIDTH }}
              />
            ))}
            <span aria-hidden className="block shrink-0" style={{ width: `calc(100cqw - ${STEP_WIDTH})` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-4 xl:px-1">
        <button type="button" onClick={onPrivate} className={GLASS_BUTTON}>
          <Lock aria-hidden className="size-3.5" />
          {t("home.privateGalleries")}
        </button>
        <Link href={`/${locale}/portfolio`} className={GLASS_BUTTON}>
          {t("home.viewPortfolio")}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </section>
  );
}
