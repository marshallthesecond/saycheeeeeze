"use client";

// src/app/[locale]/landing/Photo.tsx
//
// One way to put a photograph on the page, plus the placeholder that stands in
// until the real file exists. Pass `src: null` and you get a graded panel at
// the right aspect ratio with a REPLACE label — the layout, the type and the
// scroll choreography are all final before a single image is dropped in.
//
// No rounded corners, no border, no shadow: full-bleed photographs get no
// treatment at all. Grain and vignette live in Atmosphere at z-0, underneath.

import Image from "next/image";

export default function Photo({
  src,
  alt,
  caption,
  label,
  priority = false,
  tone = 0,
  className = "",
  sizes = "100vw",
}: {
  /** null renders the placeholder. */
  src: string | null;
  alt: string;
  /** 9px mono line under the frame — category · month. */
  caption?: string;
  /** Shown on the placeholder only, e.g. "FACE 03". */
  label?: string;
  priority?: boolean;
  /** 0–7, shifts the placeholder gradient so a run of them doesn't tile. */
  tone?: number;
  className?: string;
  sizes?: string;
}) {
  // `relative` is only correct when the caller hasn't positioned the frame
  // itself. Tailwind emits `.relative` after `.absolute`, so the base class was
  // silently winning over every `absolute inset-0` passed in from a scene —
  // the frames landed in the right place only because their parents happened
  // to be the right size, and any caller relying on inset offsets would have
  // been quietly ignored.
  const positioned = /(^|\s)(absolute|fixed|sticky|relative)(\s|$)/.test(className);

  return (
    <figure className={`${positioned ? "" : "relative"} m-0 overflow-hidden ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          // Every caller passes a bunnyUrl(), which already carries ?width=1600.
          // Guarded rather than hardcoded so a local file dropped in here later
          // still gets optimized.
          unoptimized={/^https?:\/\//.test(src)}
          className="object-cover"
        />
      ) : (
        <Placeholder label={label} tone={tone} />
      )}

      {caption && (
        <figcaption
          className="absolute bottom-0 left-0 right-0 px-3 pb-2 pt-6 font-mono text-[9px] uppercase tracking-[0.18em] text-white/70"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function Placeholder({ label, tone = 0 }: { label?: string; tone?: number }) {
  // Angles and lightness cycle with the index — enough variation that a run of
  // placeholders reads as separate frames rather than one repeated texture.
  // Explicit rgba over an opaque base rather than color-mix(): color-mix with
  // percentages that don't sum to 100 multiplies alpha, which would let the 3D
  // canvas show through the "photograph".
  const angle = 145 + tone * 17;
  const lift = (0.05 + (tone % 3) * 0.02).toFixed(3);

  return (
    <div className="absolute inset-0 bg-background">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${angle}deg,
            rgba(255,255,255,${lift}) 0%,
            rgba(255,255,255,0) 58%,
            rgba(0,0,0,0.28) 100%)`,
        }}
      />
      {/* A single diagonal hairline: reads as "empty slot", not as a design. */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 22px)",
          color: "white",
        }}
      />
      {label && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/35">
            {label} · replace
          </span>
        </div>
      )}
    </div>
  );
}