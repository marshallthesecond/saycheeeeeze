"use client";

// Seven scenes: attention → recognition → relief → orientation → desire →
// trust → action. Around twelve screens of scroll, about a minute.
//
//   1  hook      the camera hands over a photograph and gets out of the way
//   2  idea      you bring the idea, I handle the light
//   3  before    the ten seconds before the frame        ← the whole argument
//   4  reasons   graduation / model tests / portrait
//   5  work      eight frames, hard cuts, no copy         ← desire
//   6  who       the photographer, and two client quotes
//   7  book      two doors: the booking engine, or Telegram
//
// The 3D appears in 1, 3 and 7 only. Take it out and all seven still read —
// the argument is carried by photographs and short sentences.
//
// Every image is `null` until a file is dropped in; the layout, type and
// choreography are already final, so nothing else changes:
//
//   scene 2/1  HERO      → /public/landing/story/hero.jpg      (4:5 or taller)
//   scene 3    STORY     → /public/landing/story/before.jpg + after.jpg
//   scene 4    REASONS   → /public/landing/reasons/*.jpg
//   scene 5    FACES     → /public/landing/faces/face-01…08.jpg  (vertical only)
//   scene 6    SELF      → /public/landing/story/me.jpg
//
// Bunny URLs work too; *.b-cdn.net is already allowed in next.config.ts.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { testimonials } from "@/src/lib/testimonials";
import LanguageSwitcher from "@/src/components/common/LanguageSwitcher";
import Photo from "./Photo";
import { bunnyUrl } from "@/src/lib/bunny-url";
import Atmosphere from "./Atmosphere";
import FocusFrame, { focusStateFor, type FocusState, type FocusTarget } from "./FocusFrame";
import {
  ScrollStage,
  useSceneRef,
  useSceneProgress,
  useStage,
  ramp,
} from "./ScrollStage";
import type { CameraPhase, ScreenRect } from "./CameraScene";

// three.js stays out of the first paint. The LCP element is the scene-1
// photograph, not the canvas.
const CameraScene = dynamic(() => import("./CameraScene"), { ssr: false });

// Content

// Single source of truth for the four one-off images. These were previously
// declared and then ignored — every scene called bunnyUrl() inline instead —
// and two of them had a *call expression* pasted in as a string-literal type,
// which typed the constant as the source code that was meant to produce it.
const HERO: string | null = bunnyUrl("/Portraits/Sara/3M0A1432.png");
const STORY_BEFORE: string | null = bunnyUrl("/Portraits/Radmir/3M0A0607.jpg");
const STORY_AFTER: string | null = bunnyUrl("/Portraits/Radmir/3M0A0607.png");
const SELF: string | null = bunnyUrl("/Portraits/melol.jpg");

/** Scene 5. Vertical frames only — a landscape one breaks the cut rhythm. */
const FACES: { src: string | null; tag: string }[] = [
  { src: bunnyUrl('/Portraits/dude.jpg'), tag: "portrait" },
  { src: bunnyUrl('/Portraits/Sara/3M0A1047.png'), tag: "graduation" },
  { src: bunnyUrl('/Portraits/Radmir/3M0A0607.png'), tag: "model" },
  { src: bunnyUrl('/WIUT-Fashion-Show-2026/3M0A2669.png'), tag: "portrait" },
  { src: bunnyUrl('/Portraits/Shirin/9O6A2264.png'), tag: "graduation" },
  { src: bunnyUrl('/WIUT-Fashion-Show-2026/3M0A1788.png'), tag: "model" },
  { src: bunnyUrl('/Random/G69A0231(1).png'), tag: "portrait" },
  { src: bunnyUrl('/Portraits/3M0A4694.png'), tag: "brand" },
];

// TODO: point these at the real service pages. Left on /book so nothing 404s.
const REASONS = [
  { key: "grad", src: bunnyUrl('/download.jpg') as string | null, slug: "" },
  { key: "model", src: bunnyUrl('/Portraits/Sara/3M0A1255.png') as string | null, slug: "" },
  { key: "portrait", src: bunnyUrl('/Portraits/dude.jpg') as string | null, slug: "" },
];

const TELEGRAM_URL = "https://t.me/saycheeeeeze"; // TODO: confirm the handle

// Scenes

const SCENES = [
  { id: "hook", pinned: 90 },
  { id: "idea", pinned: 60 },
  { id: "before", pinned: 120 },
  { id: "reasons", pinned: 0 },
  { id: "work", pinned: 208 },
  { id: "who", pinned: 40 },
  { id: "book", pinned: 0 },
] as const;

const IDS = SCENES.map((s) => s.id);

/** Pinned length per scene, so no component carries a second copy of the number.
 *  These are the only knobs for pacing: raising `pinned` slows a scene down and
 *  lengthens the page, lowering it speeds the scene up. Nothing else moves.
 *  BottomNav's REVEAL_AT depends on the `hook` value — keep them in step. */
const PINNED: Record<string, number> = Object.fromEntries(
  SCENES.map((s) => [s.id, s.pinned]),
);

/** Which scenes the 3D is allowed into. */
const PHASE_BY_INDEX: Record<number, CameraPhase> = { 0: "hook", 2: "before", 6: "book" };

/** And where the brackets hunt and lock, in the same three scenes.
 *  Targets are viewport percentages, so nothing has to be measured. */
const FOCUS_BY_INDEX: Record<
  number,
  { id: string; lockAt: number; hideAfter?: number; target: FocusTarget }
> = {
  0: { id: "hook", lockAt: 0.3, hideAfter: 0.6, target: { x: 7, y: 17, w: 86, h: 58 } },
  2: { id: "before", lockAt: 0.52, target: { x: 52, y: 15, w: 42, h: 34 } },
  6: { id: "book", lockAt: 0.55, target: { x: 24, y: 56, w: 52, h: 13 } },
};

export default function LandingPage() {
  return (
    <ScrollStage ids={IDS}>
      <Page />
    </ScrollStage>
  );
}

function Page() {
  const { t, locale } = useT();
  const { active, reduceMotion } = useStage();
  // `valid: false` until the 3D writes a real projection. Without WebGL it
  // stays false and the photograph fades in full-bleed instead of expanding
  // out of a camera that was never drawn.
  const screenRect = useRef<ScreenRect>({
    x: 42,
    y: 34,
    w: 16,
    h: 11,
    rot: 0,
    facing: 0,
    visible: false,
    valid: false,
  });

  const bookHref = `/${locale}/book`;
  const portfolioHref = `/${locale}/portfolio`;
  const phase = PHASE_BY_INDEX[active] ?? null;

  return (
    <div className="relative bg-background font-sans text-foreground">
      <CameraScene phase={phase} screenRectRef={screenRect} reduceMotion={reduceMotion} />
      <Atmosphere />
      <HeroPhoto src={HERO} screenRectRef={screenRect} alt={t("landing.idea.title")} />

      <Chrome active={active} total={SCENES.length} />
      <SceneFocus active={active} reduceMotion={reduceMotion} />

      <main id="top" className="relative z-10">
        <Hook t={t} />
        <Idea t={t} />
        <Before t={t} />
        <Reasons t={t} bookHref={bookHref} locale={locale} />
        <Work t={t} portfolioHref={portfolioHref} />
        <Who t={t} />
        <Book t={t} bookHref={bookHref} />
      </main>
    </div>
  );
}

/** One bracket layer for the whole page. Keyed on the scene so switching scenes
 *  remounts it and its progress subscription follows. */
function SceneFocus({ active, reduceMotion }: { active: number; reduceMotion: boolean }) {
  const conf = FOCUS_BY_INDEX[active];
  if (!conf) return null;
  return <Brackets key={conf.id} {...conf} reduceMotion={reduceMotion} />;
}

function Brackets({
  id,
  lockAt,
  hideAfter = 1.1,
  target,
  reduceMotion,
}: {
  id: string;
  lockAt: number;
  hideAfter?: number;
  target: FocusTarget;
  reduceMotion: boolean;
}) {
  const state = useFocus(id, lockAt, hideAfter);
  return <FocusFrame state={state} target={target} reduceMotion={reduceMotion} />;
}

// Chrome

function Chrome({ active, total }: { active: number; total: number }) {
  return (
    <header className="fixed inset-x-0 top-0 z-20 flex items-start justify-between px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-8">
        <div>
          <a
            href="#top"
            className="font-serif text-[20px] leading-none tracking-[-0.01em] text-foreground transition-colors hover:text-accent-warm"
          >
            saycheeeeeze
          </a>
          {/* Telling someone the page ends is what makes them finish it. */}
          <div className="mt-3 flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
              {String(active + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
            <span className="relative block h-px w-14 bg-white/12">
              <span
                className="absolute inset-y-0 left-0 bg-accent-warm transition-[width] duration-500 ease-out"
                style={{ width: `${((active + 1) / total) * 100}%` }}
              />
            </span>
          </div>
        </div>
      <LanguageSwitcher />
    </header>
  );
}

// Shared pieces

/** Reveal on entry: 520ms, 60ms stagger, capped at four elements. Staggered
 *  per scene rather than across the document, or groups land arbitrarily. */
function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]")).slice(0, 4);
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    els.forEach((el, i) => {
      el.style.opacity = "0";
      if (!reduce) el.style.transform = "translateY(14px)";
      el.style.transition = reduce
        ? "opacity 520ms cubic-bezier(.2,.7,.2,1)"
        : "opacity 520ms cubic-bezier(.2,.7,.2,1), transform 520ms cubic-bezier(.2,.7,.2,1)";
      el.style.transitionDelay = i * 60 + "ms";
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.style.opacity = "1";
          el.style.transform = "none";
          io.unobserve(el);
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ref]);
}

/** Bracket state from a scene's progress, without re-rendering every frame. */
function useFocus(id: string, lockAt: number, hideAfter = 1.1) {
  const [state, setState] = useState<FocusState>("hidden");
  useSceneProgress(id, (p) => {
    const next: FocusState = p > hideAfter ? "hidden" : focusStateFor(p, lockAt);
    setState((prev) => (prev === next ? prev : next));
  });
  return state;
}

function Scene({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useSceneRef(id);
  const pinned = PINNED[id] ?? 0;
  return (
    <section
      ref={ref}
      id={id}
      className={className}
      // svh, and only svh. The section's height is the page's scroll length;
      // if it were dynamic the document would grow by ~9% the moment the URL
      // bar hid and the scroll position would lurch.
      style={{ minHeight: `${100 + pinned}svh` }}
    >
      {pinned > 0 ? (
        // dvh, and only dvh: the pinned child is the screen, so it has to be
        // exactly as tall as the screen is right now. With svh it stays short
        // once the URL bar slides away, and everything anchored to its bottom
        // edge hangs in mid-air over bare background. `sc-dvh` carries a JS
        // fallback for browsers without the unit.
        <div className="sc-dvh sticky top-0 overflow-hidden">{children}</div>
      ) : (
        <div className="relative min-h-svh">{children}</div>
      )}
    </section>
  );
}

/** The bands. Nothing is ever placed outside them.
 *
 *  The text band is bottom-anchored rather than a fixed slot: the densest
 *  block (scene 1) needs about 250px, more than 32% of a 667px phone. Anchored
 *  to the bottom it grows upward into the image band rather than off-screen,
 *  and the scrim keeps it legible. */
const BAND = {
  image: "top-[13%] h-[41%]",
  text: "bottom-[14%]",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-reveal
      className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-accent-warm"
    >
      {children}
    </div>
  );
}

function Title({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      data-reveal
      className={`mb-4 font-serif text-[30px] font-normal leading-[1.06] tracking-[-0.015em] md:text-[46px] ${className}`}
    >
      {children}
    </h2>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p
      data-reveal
      className="max-w-[34ch] text-[16px] leading-[1.55] text-fg-muted md:max-w-[46ch] md:text-[17px]"
      style={{ textWrap: "pretty" }}
    >
      {children}
    </p>
  );
}

/** Text never sits on 3D or photography without this. */
function Scrim() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 top-[30%]"
      style={{
        background:
          "linear-gradient(to bottom, transparent 0%, color-mix(in oklab, var(--background) 88%, transparent) 62%)",
      }}
    />
  );
}

// 1 · Hook

function Hook({ t }: { t: (k: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  const textRef = useRef<HTMLDivElement>(null);

  // The copy clears out as the photograph takes the frame.
  useSceneProgress("hook", (p) => {
    const el = textRef.current;
    if (!el) return;
    const out = ramp(p, 0.5, 0.74);
    el.style.opacity = String(1 - out);
    el.style.transform = `translateY(${-out * 18}px)`;
  });

  return (
    <Scene id="hook">
      <div ref={ref} className="absolute inset-0">
        <div ref={textRef} className={`absolute inset-x-0 ${BAND.text} px-5 md:px-8`}>
          <div
            data-reveal
            className="mb-5 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-dim"
          >
            {t("landing.hook.kicker")}
          </div>
          <h1
            data-reveal
            className="mb-5 font-serif text-[44px] font-normal leading-[0.94] tracking-[-0.02em] md:text-[88px]"
          >
            {t("landing.hook.title1")}
            <br />
            <em className="italic text-accent-warm">{t("landing.hook.title2")}</em>
          </h1>
          <p
            data-reveal
            className="max-w-[32ch] text-[16px] leading-normal text-fg-muted md:max-w-[42ch] md:text-[17px]"
            style={{ textWrap: "pretty" }}
          >
            {t("landing.hook.sub")}
          </p>
          <a
            data-reveal
            href="#work"
            className="mt-6 inline-block border-b border-white/20 pb-0.5 text-[13px] text-fg-muted transition-colors hover:text-foreground"
          >
            {t("landing.hook.secondary")}
          </a>
        </div>

        <div className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint md:left-8">
          <span className="sc-drift block h-7.5 w-px bg-linear-to-b from-fg-faint to-transparent" />
          {t("landing.hook.scroll")}
        </div>
      </div>
    </Scene>
  );
}

/**
 * The photograph that leaves the camera's screen.
 *
 * It starts on the projected rect of the LCD — written into `screenRectRef` by
 * CameraScene every frame — grows to fill the viewport, holds through scene 2,
 * then shrinks to a small inset as scene 2 exits: the frame pulling back to
 * show it was one frame out of many. A DOM image throughout, never a WebGL
 * texture, because the photograph has to be sharper than the object that made
 * it.
 *
 * Three rules keep the hand-off landing, and breaking any one of them makes
 * the photograph appear beside the camera rather than on it:
 *
 *  1. It must be visible while the back is still square-on. Fading in and
 *     growing in overlapping ranges means it is first seen already off the
 *     LCD, having travelled while too faint to notice.
 *  2. It stays welded to the reported rect, roll included, until the growth
 *     starts. Part-way through the turn the screen is well off-axis, and a
 *     bounding box of that turned quad is wider than the screen and centred
 *     somewhere else.
 *  3. The growth latches the rect it left from. Reading screenRectRef live
 *     throughout means the origin keeps moving while the photograph does,
 *     because the camera is still rotating underneath it.
 */

/** The back is considered square-on above this dot product — about 25° off. */
const SQUARE_ON = 0.9;
/** Fade onto the LCD here, sit on it, then leave. Nothing overlaps. */
const HERO_FADE: [number, number] = [0.56, 0.64];
const HERO_GROW: [number, number] = [0.66, 0.95];

function HeroPhoto({
  src,
  screenRectRef,
  alt,
}: {
  src: string | null;
  screenRectRef: React.MutableRefObject<ScreenRect>;
  alt: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** The LCD rect at the instant the photograph left it. */
  const latched = useRef<ScreenRect | null>(null);

  const apply = (
    r: { x: number; y: number; w: number; h: number },
    o: number,
    rot = 0,
  ) => {
    const el = boxRef.current;
    if (!el) return;
    el.style.left = `${r.x}%`;
    el.style.top = `${r.y}%`;
    el.style.width = `${r.w}%`;
    el.style.height = `${r.h}%`;
    el.style.opacity = String(o);
    el.style.transform = rot ? `rotate(${rot}deg)` : "none";
    // Nothing to hit-test or read while it's invisible, and no compositor
    // layer to keep around either.
    el.style.visibility = o < 0.005 ? "hidden" : "visible";
  };

  useSceneProgress("hook", (p) => {
    const grow = ramp(p, HERO_GROW[0], HERO_GROW[1]);
    const live = screenRectRef.current;

    if (grow <= 0) latched.current = null;
    // Latch on the first frame of movement so the origin can't drift out from
    // under the animation as the body keeps turning.
    if (grow > 0 && !latched.current) latched.current = { ...live };
    const from = latched.current ?? live;

    // No WebGL means no camera to emerge from, so don't pretend: fade the
    // photograph up full-bleed instead of expanding it out of thin air.
    if (!live.valid) {
      apply({ x: 0, y: 0, w: 100, h: 100 }, ramp(p, HERO_FADE[0], HERO_GROW[1]));
      return;
    }

    // Hold at zero until the LCD actually faces the reader. If the choreography
    // is retimed and the fade lands while the body is still turning, this stops
    // the photograph appearing on a screen that isn't there yet.
    const squared = Math.min(1, Math.max(0, (live.facing - SQUARE_ON) / (1 - SQUARE_ON)));
    const o = ramp(p, HERO_FADE[0], HERO_FADE[1]) * (grow > 0 ? 1 : squared);

    apply(
      {
        x: from.x + (0 - from.x) * grow,
        y: from.y + (0 - from.y) * grow,
        w: from.w + (100 - from.w) * grow,
        h: from.h + (100 - from.h) * grow,
      },
      o,
      // The body carries a velocity tilt, so the LCD is never perfectly
      // upright. Unroll to square as it takes the frame.
      from.rot * (1 - grow),
    );
  });

  useSceneProgress("idea", (p) => {
    // Hold, then pull back into an inset and fade out — the hard cut into 3.
    const out = ramp(p, 0.58, 1);
    apply(
      {
        x: 0 + 30 * out,
        y: 0 + 36 * out,
        w: 100 - 60 * out,
        h: 100 - 72 * out,
      },
      1 - ramp(p, 0.86, 1),
    );
  });

  return (
    <div
      ref={boxRef}
      aria-hidden
      className="pointer-events-none invisible fixed z-2 overflow-hidden opacity-0"
      style={{ left: "42%", top: "34%", width: "16%", height: "11%", transformOrigin: "center" }}
    >
      {/* Not `priority`: this is invisible until well over half way through the
          first scene, and preloading it competes with the LCP text on 3G. */}
      <Photo src={src} alt={alt} label="hero" className="absolute inset-0 h-full w-full" />
    </div>
  );
}

// 2 · Idea

function Idea({ t }: { t: (k: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  return (
    <Scene id="idea">
      <Scrim />
      <div ref={ref} className={`absolute inset-x-0 ${BAND.text} px-5 md:px-8`}>
        <Eyebrow>{t("landing.idea.kicker")}</Eyebrow>
        <Title>{t("landing.idea.title")}</Title>
        <Body>{t("landing.idea.body")}</Body>
      </div>
    </Scene>
  );
}

// 3 · The ten seconds before

function Before({ t }: { t: (k: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  const afterRef = useRef<HTMLDivElement>(null);

  // On the lock, the finished frame replaces the one taken ten seconds earlier.
  // A hard swap, not a crossfade.
  useSceneProgress("before", (p) => {
    const el = afterRef.current;
    if (!el) return;
    el.style.opacity = p >= 0.53 ? "1" : "0";
  });

  return (
    <Scene id="before">
      <div ref={ref} className="absolute inset-0">
        {/* Two frames, nine seconds apart. */}
        <div className={`absolute inset-x-0 ${BAND.image} flex gap-2 px-5 md:px-8`}>
          <div className="relative w-1/2">
            <Photo
              src={STORY_BEFORE}
              alt={t("landing.before.tBefore")}
              label="before"
              tone={1}
              sizes="50vw"
              className="absolute inset-0 h-full w-full opacity-80 saturate-50"
            />
            <span className="absolute left-2 top-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/70">
              {t("landing.before.tBefore")}
            </span>
          </div>
          {/* Right: an empty frame until the shutter. Showing the same image on
              both sides before the swap would read as a bug, not as a beat. */}
          <div className="relative w-1/2 border border-white/8">
            <div ref={afterRef} className="absolute inset-0 opacity-0">
              <Photo
                src={STORY_AFTER}
                alt={t("landing.before.title")}
                label="after"
                tone={4}
                sizes="50vw"
                className="absolute inset-0 h-full w-full"
              />
            </div>
            <span className="absolute left-2 top-2 z-10 font-mono text-[9px] uppercase tracking-[0.18em] text-white/70">
              {t("landing.before.tAfter")}
            </span>
          </div>
        </div>

        <div className={`absolute inset-x-0 ${BAND.text} px-5 md:px-8`}>
          <Eyebrow>{t("landing.before.kicker")}</Eyebrow>
          <Title>{t("landing.before.title")}</Title>
          <Body>{t("landing.before.body")}</Body>

          {/* Eleven words, and the most personal thing on the page. */}
          <div data-reveal className="mt-6 border-l border-accent-warm/50 pl-3.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
              {t("landing.before.sayLabel")}
            </div>
            <p className="mt-1 font-serif text-[19px] leading-[1.3] text-foreground md:text-[22px]">
              {t("landing.before.sayQuote")}
            </p>
          </div>
        </div>
      </div>
    </Scene>
  );
}

// 4 · Three reasons people call

function Reasons({
  t,
  bookHref,
  locale,
}: {
  t: (k: string) => string;
  bookHref: string;
  locale: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  return (
    <Scene id="reasons">
      <div ref={ref} className="flex min-h-svh flex-col justify-center pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[15svh]">
        <div className="px-5 md:px-8">
          <Eyebrow>{t("landing.reasons.kicker")}</Eyebrow>
        </div>

        {/* Horizontal snap on a phone, three columns above it. The scroller is
            nested, so `overscroll-behavior-x: contain` in globals.css stops a
            sideways swipe turning into a back-navigation. */}
        <div
          data-reveal
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 md:grid md:grid-cols-3 md:overflow-visible md:px-8"
        >
          {REASONS.map((r, i) => (
            <Link
              key={r.key}
              href={r.slug ? `/${locale}/${r.slug}` : bookHref}
              className="group flex w-[74vw] shrink-0 snap-center flex-col rounded-md border border-white/12 bg-white/3 transition-colors hover:border-white/25 hover:bg-white/6 md:w-auto"
            >
              {/* Height in svh rather than an aspect ratio: a 4:5 crop at 74vw
                  is 92vw tall, which pushes the card past the fold on a short
                  phone. object-cover keeps the portrait crop either way. */}
              <div className="relative h-[34svh] w-full overflow-hidden rounded-t-md md:h-[46vh]">
                <Photo
                  src={r.src}
                  alt={t(`landing.reasons.${r.key}Title`)}
                  label={r.key}
                  tone={i * 2}
                  sizes="(min-width: 820px) 33vw, 78vw"
                  className="absolute inset-0 h-full w-full"
                />
              </div>
              <div className="flex flex-col gap-2.5 p-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-warm">
                  {t(`landing.reasons.${r.key}Label`)}
                </div>
                <h3 className="font-serif text-[22px] leading-[1.12] tracking-[-0.01em] md:text-[26px]">
                  {t(`landing.reasons.${r.key}Title`)}
                </h3>
                <p className="text-[14px] leading-[1.55] text-fg-muted">
                  {t(`landing.reasons.${r.key}Body`)}
                </p>
                <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-dim transition-colors group-hover:text-accent-warm">
                  {t("landing.reasons.link")} →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Scene>
  );
}

// 5 · The work

function Work({ t, portfolioHref }: { t: (k: string) => string; portfolioHref: string }) {
  const [i, setI] = useState(0);
  const kickerRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  useSceneProgress("work", (v) => {
    // Hard cuts. floor, no interpolation, no crossfade — this scene is edited,
    // not animated. Eight renders across the whole scene, one per frame change.
    const idx = Math.min(FACES.length - 1, Math.floor(v * FACES.length * 0.999));
    setI((prev) => (prev === idx ? prev : idx));

    // The label and the exit link fade at the ends. Written straight to the
    // elements: putting progress in state here would re-render eight <Photo>s
    // on every frame of the longest scene on the page.
    if (kickerRef.current) kickerRef.current.style.opacity = v < 0.06 ? "1" : "0";
    if (outRef.current) {
      const show = v > 0.93;
      outRef.current.style.opacity = show ? "1" : "0";
      outRef.current.style.pointerEvents = show ? "auto" : "none";
      // pointer-events alone still leaves the link in the tab order, so a
      // keyboard reader could focus an invisible target seven scenes in.
      outRef.current.style.visibility = show ? "visible" : "hidden";
    }
  });

  // Eight full-bleed photographs all mounted at once is eight full-bleed
  // downloads on a phone before the reader has seen the second one. Mount a
  // frame ahead of the cut and never unmount, so the hard cuts stay instant.
  const reachRef = useRef(1);
  reachRef.current = Math.max(reachRef.current, i + 1);
  const reach = reachRef.current;

  return (
    <Scene id="work">
      <div className="absolute inset-0 bg-background">
        {FACES.map((f, n) =>
          n > reach ? null : (
            <div
              key={n}
              className="absolute inset-0"
              // Opacity, not visibility: a hidden layer can be dropped before
              // it is decoded, and the cut has to be instant when it lands.
              style={{ opacity: n === i ? 1 : 0 }}
            >
              <Photo
                src={f.src}
                alt=""
                label={`face ${String(n + 1).padStart(2, "0")}`}
                tone={n}
                priority={n === 0}
                className="absolute inset-0 h-full w-full"
              />
            </div>
          ),
        )}

        {/* The only copy in the scene: a counter, a tag, and the way out. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] md:px-8">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/60">
            {t(`landing.tags.${FACES[i].tag}`)}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/60">
            {String(i + 1).padStart(2, "0")} / {String(FACES.length).padStart(2, "0")}
          </span>
        </div>

        <div
          ref={kickerRef}
          className="absolute inset-x-0 top-[15%] px-5 opacity-0 transition-opacity duration-300 md:px-8"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">
            {t("landing.work.kicker")}
          </div>
        </div>

        <div
          ref={outRef}
          className="pointer-events-none invisible absolute inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] flex justify-center opacity-0 transition-opacity duration-300 md:px-8"
        >
          <Link
            href={portfolioHref}
            className="border-b border-white/30 pb-0.75 font-mono text-[10px] uppercase tracking-[0.18em] text-white transition-colors hover:text-accent-warm"
          >
            {t("landing.work.link")} →
          </Link>
        </div>
      </div>
    </Scene>
  );
}

// 6 · Who's behind the camera

function Who({ t }: { t: (k: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  // Two is enough. The third stays in testimonials.ts for the service pages.
  const quotes = testimonials.slice(0, 2);

  return (
    <Scene id="who">
      <div ref={ref} className="absolute inset-0 flex flex-col justify-center px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[15svh] md:px-8">
        <div className="md:flex md:items-end md:gap-8">
          {/* Shot from where the subject stands, ideally. */}
          <div className="relative mb-6 aspect-4/5 w-[58%] max-w-70 md:mb-0 md:w-[34%]">
            <Photo
              src={SELF}
              alt={t("landing.who.title")}
              label="me"
              tone={3}
              sizes="(min-width: 820px) 34vw, 58vw"
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <div className="md:flex-1">
            <Eyebrow>{t("landing.who.kicker")}</Eyebrow>
            <Title className="mb-3">{t("landing.who.title")}</Title>
            <Body>{t("landing.who.body")}</Body>
          </div>
        </div>

        {quotes.length > 0 && (
          <div
            data-reveal
            className="mt-9 grid gap-6 border-t border-white/10 pt-6 md:grid-cols-2 md:gap-10"
          >
            {quotes.map((q) => (
              <blockquote key={q.name} className="m-0">
                <p
                  className="mb-2.5 font-serif text-[19px] leading-[1.32] md:text-[21px]"
                  style={{ textWrap: "pretty" }}
                >
                  {q.quote}
                </p>
                <footer className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-dim">
                  {q.name} — {q.context}
                </footer>
              </blockquote>
            ))}
          </div>
        )}
      </div>
    </Scene>
  );
}

// 7 · Book

function Book({ t, bookHref }: { t: (k: string) => string; bookHref: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  return (
    <Scene id="book">
      <div
        ref={ref}
        className="flex min-h-svh flex-col items-center justify-center px-5 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-[15svh] text-center md:px-8"
      >
        <div
          data-reveal
          className="mb-5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent-warm"
        >
          {t("landing.book.kicker")}
        </div>
        <h2
          data-reveal
          className="mb-6 font-serif text-[44px] font-normal leading-[0.94] tracking-tight md:text-[88px]"
        >
          {t("landing.book.title")}
        </h2>
        <p
          data-reveal
          className="mb-8 max-w-[34ch] text-[16px] leading-[1.55] text-fg-muted md:max-w-[44ch] md:text-[17px]"
          style={{ textWrap: "pretty" }}
        >
          {t("landing.book.body")}
        </p>

        {/* Two doors. Some people will never fill in a form. */}
        <div data-reveal className="flex flex-col items-center gap-4">
          <Link
            href={bookHref}
            className="rounded-full bg-accent-warm px-8 py-3.75 text-[14px] font-semibold tracking-[0.03em] text-accent-ink transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            {t("landing.cta")}
          </Link>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-b border-white/20 pb-0.5 text-[14px] text-fg-muted transition-colors hover:text-foreground"
          >
            {t("landing.textMe")}
          </a>
        </div>

        <div className="mt-14 flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
          <span>{t("landing.book.foot1")}</span>
          <span>{t("landing.book.foot2")}</span>
          <Link href={bookHref} className="underline decoration-white/20 hover:text-fg-muted">
            {t("landing.book.foot3")}
          </Link>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
          <span>{t("landing.book.brand")}</span>
          <Link href={bookHref} className="hover:text-fg-muted">
            {t("landing.book.brandLink")} →
          </Link>
        </div>
      </div>
    </Scene>
  );
}