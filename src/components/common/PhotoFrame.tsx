"use client";

// One photograph, rendered the way every photograph on this site should be:
// ThumbHash first, the right rung of the ladder second, and something
// deliberate when neither arrives.
//
// Three layers, back to front:
//
//   1. the accent colour     always painted, so an empty frame is never white
//   2. the ThumbHash         a blurred preview, present before any byte lands
//   3. the photograph        covers both completely once it decodes
//
// The image sits ON TOP rather than replacing the layers beneath, which is
// what makes this free: there is no "loaded" state to track and no fade to get
// wrong. Photographs here are opaque — JPEG, and AVIF/WebP encoded without
// alpha — so the moment one paints it hides everything under it.
//
// That layering is also the whole error strategy. When an image fails, hiding
// it reveals the blur that was already there, instead of the browser painting
// alt text across the frame. The alt attribute stays: screen readers need it,
// and it costs a sighted visitor nothing once the img itself is not drawn.

import { useEffect, useState } from "react";
import { blurStyle, hasLadder, srcSet, fallbackSrc, type LadderSources } from "@/src/lib/ladder";

interface PhotoFrameProps {
  /** The derivative ladder. Preferred over `src` whenever it exists. */
  ladder?: LadderSources | null;
  /** Single URL, for anything not yet through the ladder. */
  src?: string | null;
  /** Describes the photograph for screen readers. Empty string for decoration. */
  alt: string;
  thumbhash?: string;
  /** Painted under everything, so a missing photo reads as a design choice. */
  accent?: string;
  /** Same contract as the sizes attribute — what width this will display at. */
  sizes: string;
  /** Classes for the frame itself. Give it a size or an aspect ratio. */
  className?: string;
  /** Classes for the img. Defaults to filling the frame. */
  imgClassName?: string;
  /** Above the fold: skip lazy loading and hint the decoder. */
  priority?: boolean;
}

export default function PhotoFrame({
  ladder,
  src,
  alt,
  thumbhash,
  accent = "#2a2f36",
  sizes,
  className = "",
  imgClassName = "absolute inset-0 h-full w-full object-cover",
  priority = false,
}: PhotoFrameProps) {
  const [failed, setFailed] = useState(false);
  const ladderOk = hasLadder(ladder);
  const url = ladderOk ? fallbackSrc(ladder) : (src ?? null);

  // A new photograph in the same frame deserves its own chance to load —
  // without this, one failure would poison the frame for every later src.
  useEffect(() => setFailed(false), [url]);

  return (
    <span
      className={`relative block overflow-hidden ${className}`}
      style={{ background: accent, ...blurStyle(thumbhash) }}
    >
      {url && !failed && (
        <picture>
          {ladderOk && (
            <source type="image/avif" sizes={sizes} srcSet={srcSet(ladder, "avif")} />
          )}
          {ladderOk && (
            <source type="image/webp" sizes={sizes} srcSet={srcSet(ladder, "webp")} />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            sizes={sizes}
            loading={priority ? "eager" : "lazy"}
            decoding={priority ? "sync" : "async"}
            fetchPriority={priority ? "high" : "auto"}
            onError={() => setFailed(true)}
            className={imgClassName}
          />
        </picture>
      )}
    </span>
  );
}
