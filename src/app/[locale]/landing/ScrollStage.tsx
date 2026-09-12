"use client";

// One rAF loop for the whole landing page, and a registry of scenes.
//
// Each scene registers its own element and gets its own 0→1:
//
//   0  — the scene's top edge is at the top of the viewport
//   1  — the scene's bottom edge is at the bottom of the viewport
//
// which for a tall section with a sticky child is exactly the range over which
// that child is pinned. A scene only 100svh tall has no pinned range and
// reports 0→1 across its entry instead (see `progressFor`). Deriving one
// page-wide 0→1 from scrollTop instead would tie every timing constant to the
// height of the document, so adding a pane would retune everything.
//
// Progress arrives through callbacks rather than React state: at 60fps, state
// would re-render the page every frame. Components mutate refs and styles in
// the callback. The one thing that is state is the active scene index, which
// changes a few times per page and drives the indicator and the 3D phase.
//
// Mobile viewport chrome. The URL bar collapses as you scroll and the viewport
// grows by ~9%, so two heights matter and must not be confused:
//
//   svh  the height with browser chrome shown. Never changes while scrolling,
//        so every scroll LENGTH is expressed in it — dynamic section heights
//        would resize the document mid-scroll and make the position jump.
//   dvh  the height right now. Anything pinned to the bottom needs this, or it
//        floats above the real edge once the bar goes.
//
// So sections are sized in svh, sticky children in dvh, and the progress
// denominator below uses the stable svh measurement rather than
// window.innerHeight — which would shrink the pinned range by 9% the moment
// the URL bar hid, shifting every timing constant mid-scene.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ProgressFn = (p: number) => void;

interface Entry {
  /** null between a subscriber mounting and the section's ref callback firing. */
  el: HTMLElement | null;
  /** Subscribers, called on every frame where p moved perceptibly. */
  cbs: Set<ProgressFn>;
  /** Last delivered value, so we can skip no-op frames. */
  last: number;
}

interface StageValue {
  register: (id: string, el: HTMLElement) => () => void;
  subscribe: (id: string, cb: ProgressFn) => () => void;
  /** Index of the scene currently filling most of the viewport, 0-based. */
  active: number;
  /** True when the OS asks for less motion. Read once, on mount. */
  reduceMotion: boolean;
}

const StageContext = createContext<StageValue | null>(null);

/** Below this width the 3D drops geometry detail and the layout goes single-column. */
export const MOBILE_MAX = 820;

/**
 * Measures the small viewport height by asking the browser directly, with a
 * throwaway element sized `100svh`, rather than inferring it from innerHeight
 * — which is whatever the viewport happens to be at that instant.
 *
 * Only width and orientation can change svh, so it is remeasured on those and
 * never on the URL bar collapsing. `--sc-dvh` is published for browsers
 * without dvh support (Safari < 15.4); everything else uses the native unit.
 */
function measureViewport(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none";
  document.documentElement.appendChild(probe);
  const svh = probe.getBoundingClientRect().height || window.innerHeight || 1;
  probe.remove();
  return svh;
}

export function ScrollStage({
  ids,
  children,
}: {
  /** Scene ids in document order — used to resolve the active index. */
  ids: readonly string[];
  children: React.ReactNode;
}) {
  const entries = useRef(new Map<string, Entry>());
  const [active, setActive] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  /** Stable viewport height in px. 0 until measured — the loop falls back to
   *  innerHeight for the first frame or two. */
  const svh = useRef(0);
  /** Set by anything that invalidates cached geometry: resize, font load,
   *  image load, orientation change. Forces one full measuring pass. */
  const dirty = useRef(true);

  useEffect(() => {
    let lastW = -1;
    const remeasure = () => {
      svh.current = measureViewport();
      dirty.current = true;
    };
    const onViewportChange = () => {
      // The dynamic height is published for the dvh fallback and updated on
      // every visual-viewport change, including the URL bar sliding away.
      const dvh = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--sc-dvh", `${dvh}px`);
      dirty.current = true;
      // Width changes (rotation, desktop resize, tablet split view) are the
      // only thing that can move svh. A URL bar collapse must not.
      const w = window.innerWidth;
      if (w !== lastW) {
        lastW = w;
        remeasure();
      }
    };

    onViewportChange();
    remeasure();
    lastW = window.innerWidth;

    window.addEventListener("resize", onViewportChange, { passive: true });
    window.addEventListener("orientationchange", remeasure, { passive: true });
    window.visualViewport?.addEventListener("resize", onViewportChange, { passive: true });
    // Late-loading webfonts and images change section heights.
    document.fonts?.ready.then(() => (dirty.current = true)).catch(() => {});

    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", remeasure);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const register = useCallback((id: string, el: HTMLElement) => {
    const existing = entries.current.get(id);
    if (existing) {
      existing.el = el;
      existing.last = -1;
    } else {
      entries.current.set(id, { el, cbs: new Set(), last: -1 });
    }
    dirty.current = true;
    return () => {
      const e = entries.current.get(id);
      if (!e) return;
      // Drop the element either way: a detached node's rect is all zeros, which
      // reads as a short scene sitting at p = 1 forever.
      if (e.el === el) e.el = null;
      if (e.cbs.size === 0) entries.current.delete(id);
    };
  }, []);

  const subscribe = useCallback((id: string, cb: ProgressFn) => {
    let e = entries.current.get(id);
    if (!e) {
      // A subscriber can mount before the section's ref callback fires.
      e = { el: null, cbs: new Set(), last: -1 };
      entries.current.set(id, e);
    }
    e.cbs.add(cb);
    // A late subscriber — a bracket layer remounting on a scene change — needs
    // a value even if the reader has stopped scrolling, so replay on the next
    // frame rather than waiting for p to move.
    e.last = -1;
    dirty.current = true;
    return () => {
      e!.cbs.delete(cb);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let dead = false;
    let lastActive = -1;

    let lastY = NaN;

    // `stable` is the svh height and drives the pinned range; `live` is the
    // current viewport and decides what's on screen. Keeping them apart is the
    // whole fix for the URL bar: only `stable` goes near a timing constant.
    const progressFor = (r: DOMRect, stable: number) => {
      const pinned = r.height - stable;
      if (pinned > 1) {
        // Tall scene: 0 when its top reaches the top of the viewport, 1 when
        // its bottom reaches the bottom.
        return clamp(-r.top / pinned);
      }
      // Short scene: 0 as its top enters from below, 1 once it has left above.
      return clamp((stable - r.top) / (stable + r.height));
    };

    const tick = () => {
      if (dead) return;
      raf = requestAnimationFrame(tick);

      // Nothing can have moved unless the page scrolled or something resized.
      // Without this the loop forces two layouts per scene per frame, forever,
      // which on a phone is a measurable amount of battery for zero output.
      const y = window.scrollY;
      if (y === lastY && !dirty.current) return;
      lastY = y;
      dirty.current = false;

      const live = window.innerHeight || 1;
      const stable = svh.current || live;

      let bestId = "";
      let bestVisible = 0;

      for (const [id, e] of entries.current) {
        if (!e.el) continue;
        const r = e.el.getBoundingClientRect();
        const p = progressFor(r, stable);
        if (Math.abs(p - e.last) > 0.0004) {
          e.last = p;
          for (const cb of e.cbs) cb(p);
        }
        // How much of the viewport this scene currently covers — measured
        // against the live viewport, because this is a question about pixels
        // on the glass right now, not about scroll length.
        const visible = Math.min(r.bottom, live) - Math.max(r.top, 0);
        if (visible > bestVisible) {
          bestVisible = visible;
          bestId = id;
        }
      }

      const idx = ids.indexOf(bestId);
      if (idx !== -1 && idx !== lastActive) {
        lastActive = idx;
        setActive(idx);
      }
    };

    tick();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [ids]);

  const value = useMemo<StageValue>(
    () => ({ register, subscribe, active, reduceMotion }),
    [register, subscribe, active, reduceMotion],
  );

  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

function clamp(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function useStage() {
  const ctx = useContext(StageContext);
  if (!ctx) throw new Error("useStage must be used inside <ScrollStage>");
  return ctx;
}

/**
 * Attach to the <section> that owns a scene.
 *
 *   const ref = useSceneRef("hook");
 *   <section ref={ref} …>
 */
export function useSceneRef(id: string) {
  const { register } = useStage();
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (el) cleanup.current = register(id, el);
    },
    [id, register],
  );
}

/**
 * Run `cb` with this scene's 0→1 on every frame it changes.
 * `cb` is stored in a ref, so it doesn't need to be memoised by the caller.
 */
export function useSceneProgress(id: string, cb: ProgressFn) {
  const { subscribe } = useStage();
  const ref = useRef(cb);
  ref.current = cb;

  useEffect(() => {
    return subscribe(id, (p) => ref.current(p));
  }, [id, subscribe]);
}

// Small maths shared by the scenes and the 3D

/** Smoothstep. */
export function ease(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** Map p through a list of [progress, value] stops with eased segments. */
export type Stop = [number, number];
export function track(p: number, stops: Stop[]): number {
  if (p <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, v0] = stops[i];
    const [p1, v1] = stops[i + 1];
    if (p <= p1) return v0 + (v1 - v0) * ease((p - p0) / (p1 - p0 || 1));
  }
  return stops[stops.length - 1][1];
}

/** 0→1 over [a, b], eased. Reads better than track() for a single ramp. */
export function ramp(p: number, a: number, b: number) {
  return ease((p - a) / (b - a || 1));
}