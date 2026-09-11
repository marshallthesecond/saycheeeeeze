"use client";

// src/app/[locale]/landing/FocusFrame.tsx
//
// Four corner brackets that hunt, lock, and hold. This is the signature
// element and the reason the 3D camera can be demoted: the *idea* of a camera
// stays on screen the whole way down, at the cost of 1px of SVG stroke.
//
// It appears in scenes 1, 3 and 7 — the same three scenes as the 3D — so its
// return means something. Never more than one lock per scene.
//
// State machine, driven by the owning scene's progress:
//   hidden   → nothing drawn
//   hunting  → brackets drift around the target, out of focus
//   locking  → 260ms convergence on the target
//   locked   → static, dimmed

import { useEffect, useRef } from "react";

export type FocusState = "hidden" | "hunting" | "locking" | "locked";

/** Target rect in viewport %, so it doesn't need pixel measurement. */
export interface FocusTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CORNER = 16; // bracket arm length, px

export default function FocusFrame({
  state,
  target,
  reduceMotion = false,
}: {
  state: FocusState;
  target: FocusTarget;
  reduceMotion?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // The hunt: a slow lissajous wobble, only while hunting. Written straight to
  // the element rather than through state — this runs at 60fps and React has no
  // reason to hear about it. Stopped entirely under reduced motion; a static
  // bracket is fine, a drifting one isn't.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (state !== "hunting" || reduceMotion) {
      el.style.transform = "translate(0px, 0px)";
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = (performance.now() - t0) / 1000;
      el.style.transform = `translate(${Math.sin(t * 1.3) * 6}px, ${Math.cos(t * 0.9) * 5}px)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state, reduceMotion]);

  if (state === "hidden") return null;

  const opacity = state === "locked" ? 0.6 : state === "locking" ? 0.9 : 0.45;

  return (
    <div
      ref={boxRef}
      aria-hidden
      className="pointer-events-none fixed z-15"
      style={{
        left: `${target.x}%`,
        top: `${target.y}%`,
        width: `${target.w}%`,
        height: `${target.h}%`,
        transition:
          state === "locking"
            ? "transform 260ms cubic-bezier(.2,.7,.2,1), opacity 260ms linear"
            : "opacity 200ms linear",
        color: "var(--sc-accent-hex)",
        opacity,
      }}
    >
      {/* Each corner is two 1px rules rather than a stroked path — crisper at
          1px on a phone than an SVG stroke, which lands on a half-pixel. */}
      {(
        [
          ["top-0 left-0", "border-t border-l"],
          ["top-0 right-0", "border-t border-r"],
          ["bottom-0 left-0", "border-b border-l"],
          ["bottom-0 right-0", "border-b border-r"],
        ] as const
      ).map(([pos, edges]) => (
        <span
          key={pos}
          className={`absolute ${pos} ${edges} border-current`}
          style={{ width: CORNER, height: CORNER }}
        />
      ))}
    </div>
  );
}

/**
 * Maps a scene's 0→1 onto the bracket state machine.
 * `lockAt` is where the lock lands; everything before it is a hunt.
 */
export function focusStateFor(p: number, lockAt: number): FocusState {
  if (p <= 0.02) return "hidden";
  if (p < lockAt - 0.05) return "hunting";
  if (p < lockAt + 0.04) return "locking";
  return "locked";
}