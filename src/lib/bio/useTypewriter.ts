"use client";

// src/lib/bio/useTypewriter.ts
//
// Reveals `text` one character at a time.
//
// Driven by requestAnimationFrame against elapsed time rather than
// setInterval(fn, 1000 / cps). Two reasons: setInterval drifts under load, and
// browsers throttle it hard in background tabs — you'd come back to a tab that
// is still slowly typing a paragraph from thirty seconds ago. Deriving the
// character count from the real elapsed time means the animation is always in
// the right place, whatever the frame rate did.

import { useEffect, useMemo, useRef, useState } from "react";

interface Options {
  /** False renders the full text instantly — used after the first play. */
  enabled: boolean;
  /** Characters per second. */
  cps?: number;
  onDone?: () => void;
}

export function useTypewriter(text: string, { enabled, cps = 65, onDone }: Options) {
  // Array.from, not split(""): split("") breaks on surrogate pairs, and Uzbek
  // and Russian text can carry combining marks that would tear mid-character.
  const chars = useMemo(() => Array.from(text), [text]);

  const [count, setCount] = useState(0);

  // Kept in a ref so a caller passing an inline arrow doesn't restart the
  // animation on every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (chars.length === 0) {
      setCount(0);
      return;
    }

    if (!enabled) {
      setCount(chars.length);
      return;
    }

    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      setCount(chars.length);
      onDoneRef.current?.();
      return;
    }

    setCount(0);

    let frame = 0;
    let startedAt = 0;

    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const elapsedSeconds = (now - startedAt) / 1000;
      const revealed = Math.min(chars.length, Math.floor(elapsedSeconds * cps));
      setCount(revealed);

      if (revealed < chars.length) {
        frame = requestAnimationFrame(tick);
      } else {
        onDoneRef.current?.();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [chars, enabled, cps]);

  return {
    typed: chars.slice(0, count).join(""),
    done: count >= chars.length,
  };
}