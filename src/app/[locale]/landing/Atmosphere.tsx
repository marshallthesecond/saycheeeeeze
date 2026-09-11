"use client";

// src/app/[locale]/landing/Atmosphere.tsx
//
// The ambient layer: stars, grain, vignette. Fixed for the whole page and
// sitting at z-0, underneath the scene content — which means photographs
// (in the flow, at z-10) are never covered by grain or vignette. That was the
// point of moving these out of CameraScene: the old version put the grain on
// top of everything, including the six photo cards.
//
// The stars used to be 420 additively-blended three.js points, which meant no
// stars in any scene without WebGL running. Now they're SVG circles: present in
// all seven scenes, free on the GPU, and they survive with 3D switched off.

// Deterministic positions — a tiny LCG rather than Math.random(), so the
// server and client render identical markup and hydration stays quiet.
function seeded(n: number) {
  let s = 20260817;
  const out: { x: number; y: number; r: number; o: number; g: number }[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const x = (s / 4294967296) * 100;
    s = (s * 1664525 + 1013904223) % 4294967296;
    const y = (s / 4294967296) * 100;
    s = (s * 1664525 + 1013904223) % 4294967296;
    const t = s / 4294967296;
    out.push({
      x,
      y,
      // Mostly dust, a few slightly larger. Pixels — these are real elements
      // now, not units in a stretched viewBox.
      r: t > 0.93 ? 2 : t > 0.7 ? 1.5 : 1,
      o: 0.12 + t * 0.4,
      g: i % 2,
    });
  }
  return out;
}

const STARS = seeded(56);

export default function Atmosphere() {
  return (
    <div aria-hidden className="sc-atmosphere pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Stars. Two groups drift in opposite directions at different speeds so
          the field has depth without anything moving fast enough to notice.

          These were SVG circles in a 100×100 viewBox with preserveAspectRatio
          "none". On a 9:19.5 phone that viewBox is stretched more than two to
          one, so every circle came out as a vertical ellipse — the radius was
          being scaled down to 0.06 to hide it, which just made the field dim
          and smeared instead of round. Positioned elements with a pixel size
          are round at any aspect ratio and cost the same. */}
      {[0, 1].map((g) => (
        <div key={g} className={`absolute inset-0 ${g === 0 ? "sc-star-a" : "sc-star-b"}`}>
          {STARS.filter((s) => s.g === g).map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-current"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.r,
                height: s.r,
                opacity: s.o,
              }}
            />
          ))}
        </div>
      ))}

      {/* Vignette. Deliberately off-centre — a symmetrical radial gradient
          reads as CSS, real lens falloff doesn't. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(118% 88% at 47% 42%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Grain. Stronger than the old 0.045 because it now only ever falls on
          bare background, never on skin. */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.07,
          mixBlendMode: "overlay",
          backgroundImage:
            "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%222%22/></filter><rect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22/></svg>')",
        }}
      />
    </div>
  );
}