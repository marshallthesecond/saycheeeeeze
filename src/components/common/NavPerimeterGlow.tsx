"use client";

//
// A glowing segment running clockwise around the bottom nav pill.
//
// Sizing is explicit px measured from the host. An <svg> is a replaced element:
// leave its box to be derived and it silently falls back to 300x150, which on a
// 290x58 navbar hangs off the right edge and loops below the screen.
//
// The path uses pathLength="100" so the dash pattern in globals.css is a
// percentage of the perimeter — the navbar is content-sized and its width
// changes with locale, but the lit segment stays the same relative length.

import { useEffect, useRef, useState } from "react";

const OUTER_RADIUS = 16; // matches rounded-2xl
const BORDER = 1; // the host's border-width
const STROKE = 1.75;

/**
 * Rounded rectangle inside a w x h box, inset on all sides, drawn CLOCKWISE
 * from just after the top-left corner so a decreasing stroke-dashoffset walks
 * the segment clockwise.
 */
function roundedRectPath(w: number, h: number, inset: number, radius: number): string {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  // Clamp so a narrow or short host degrades to a stadium shape instead of
  // producing arcs that overlap and kink.
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));

  return [
    `M ${x0 + r} ${y0}`,
    `H ${x1 - r}`,
    `A ${r} ${r} 0 0 1 ${x1} ${y0 + r}`,
    `V ${y1 - r}`,
    `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `H ${x0 + r}`,
    `A ${r} ${r} 0 0 1 ${x0} ${y1 - r}`,
    `V ${y0 + r}`,
    `A ${r} ${r} 0 0 1 ${x0 + r} ${y0}`,
    "Z",
  ].join(" ");
}

export default function NavPerimeterGlow({ active }: { active: boolean }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const host = svgRef.current?.parentElement;
    if (!host) return;

    const measure = () => {
      // getBoundingClientRect gives the BORDER box, which is what we want —
      // the trace sits on the border, not inside the padding box.
      const { width, height } = host.getBoundingClientRect();
      setBox((prev) =>
        prev && Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5
          ? prev
          : { w: width, h: height }
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [active]);

  if (!active) return null;

  // Half the border width centres the stroke on the border line itself, so it
  // reads as the navbar's own border lighting up.
  const inset = BORDER / 2;
  const d = box ? roundedRectPath(box.w, box.h, inset, OUTER_RADIUS - inset) : null;

  return (
    <svg
      ref={svgRef}
      aria-hidden
      style={{
        position: "absolute",
        // The host's padding box starts 1px inside its border box, so shift out
        // by the border width to line the SVG origin up with the border box.
        top: `${-BORDER}px`,
        left: `${-BORDER}px`,
        // Explicit px, never percentages or inset-derived. Zero until measured
        // so there is no 300x150 flash on the first frame.
        width: box ? `${box.w}px` : 0,
        height: box ? `${box.h}px` : 0,
        display: "block",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {d && (
        <>
          {/* Blurred wide copy — the bloom. Identical geometry and animation, so
              it can never drift away from the crisp stroke. */}
          <path
            className="sc-nav-trace"
            d={d}
            pathLength={100}
            fill="none"
            stroke="var(--sc-accent-hover)"
            strokeWidth={STROKE * 2.5}
            strokeLinecap="round"
            opacity={0.3}
            style={{ filter: "blur(2.5px)" }}
          />

          {/* The line itself. */}
          <path
            className="sc-nav-trace"
            d={d}
            pathLength={100}
            fill="none"
            stroke="var(--sc-accent-hover)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}