// The photographic hero: a place, laid under the work, under the title.
//
// Three layers, each answering a different question a visitor has not asked out
// loud yet:
//
//   the ground   WHERE — the campus, pushed most of the way to black so it
//                reads as a place rather than as the photograph on offer
//   the stack    WHAT — real frames, overlapping and slightly turned, the way
//                prints land when you put them down. Photographs of people,
//                which is the thing being sold and the thing the drawn hero
//                could never show
//   the title    WHO IT IS FOR
//
// This replaces the drawn mortarboard for graduation, and the reasoning that
// put the drawing there still holds everywhere else: a stand-in frame of
// something unrelated says "photography" and nothing about which kind. The
// difference is that this hero shows work that IS the photographer's, from the
// folder the service already points at, so it is not standing in for anything.
//
// A server component. Nothing here is stateful; the page resolves every URL
// through the ladder and hands down plain strings, so no locale, no database
// and no signing key crosses into the browser.

import { blurStyle } from '@/src/lib/ladder';

import { accentRgb, shade } from './accent';
import { Mortarboard } from './ServiceHero';

/** A photograph, already resolved to plain strings by the page. */
export interface HeroImage {
  avif: string;
  webp: string;
  fallback: string;
  thumbhash?: string;
}

export interface HeroFrame extends HeroImage {
  alt: string;
}

/**
 * The fan, front to back as authored.
 *
 * Laid out as a flex row with negative margins rather than absolute percentage
 * offsets: the overlap then holds at any hero width instead of being three
 * numbers tuned against one viewport. The rotations alternate because a fan
 * that leans one way reads as a mistake and a fan that alternates reads as a
 * hand having put them down.
 *
 * The third frame is hidden below `sm`. Three cards plus a headline on a 390px
 * phone is not a composition, it is a collision.
 */
const FAN = [
  { rotate: -7, z: 30 },
  { rotate: 4, z: 20 },
  { rotate: -3, z: 10 },
] as const;

/** 96px on a phone, 144 on a tablet, 176 on a laptop. At 2x the widest of
 *  those wants 352, so the ladder's 480 rung is the top one worth having —
 *  which is what HERO_FRAME_MAX in the page caps them at. */
const FRAME_SIZES = '(max-width: 640px) 96px, (max-width: 1024px) 144px, 176px';

interface Props {
  title: string;
  tagline: string;
  eyebrow: React.ReactNode;
  accent: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** The place. Absent — no ladder row — leaves the gradient alone, which is
   *  the drawn hero's background and a perfectly good floor to fall to. */
  ground?: HeroImage;
  /** Up to three. Fewer is fine; none falls back to the drawn mortarboard at
   *  full strength, because a hero with an empty right half is worse than the
   *  drawing this was meant to replace. */
  frames: HeroFrame[];
}

export default function ServiceHeroStack({
  title,
  tagline,
  eyebrow,
  accent,
  Icon,
  ground,
  frames,
}: Props) {
  const rgb = accentRgb(accent);
  const shown = frames.slice(0, FAN.length);
  const hasStack = shown.length > 0;

  // Over the photograph, not instead of it. The wash is heavy on purpose: the
  // ground has to lose enough contrast that the frames on top of it are
  // unambiguously the subject, and a headline has to sit on it in white.
  const wash = [
    `radial-gradient(120% 90% at 74% 10%, ${shade(rgb, 0.1, 0.42)} 0%, transparent 62%)`,
    `linear-gradient(168deg, ${shade(rgb, -0.42, 0.82)} 0%, ${shade(rgb, -0.72, 0.9)} 48%, rgba(0,0,0,0.95) 100%)`,
  ].join(', ');

  return (
    <div className="relative w-full overflow-hidden h-[44vh] min-h-[300px] max-h-[400px] sm:h-[52vh] sm:max-h-[520px]">
      {/* The ground, at half strength. ThumbHash underneath so the hero paints
          something in the first frame rather than a flat rectangle — this is
          the LCP element on the page. */}
      {ground ? (
        <span
          aria-hidden
          className="absolute inset-0"
          style={blurStyle(ground.thumbhash)}
        >
          <picture>
            <source type="image/avif" sizes="100vw" srcSet={ground.avif} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ground.fallback}
              srcSet={ground.webp}
              sizes="100vw"
              alt=""
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: 0.55, filter: 'saturate(0.8)' }}
            />
          </picture>
        </span>
      ) : null}

      <div aria-hidden className="absolute inset-0" style={{ background: wash }} />

      {/* The cap, dropped to a watermark. At the drawn hero's contrast it would
          compete with the photographs it is sitting behind; at this one it is
          a texture you notice second, which is where it belongs once there is
          real work to look at. Hidden entirely when there is no stack — the
          drawn hero's own version takes over below. */}
      <Mortarboard
        className={`pointer-events-none absolute -top-[54px] -right-[68px] h-[78%] sm:-top-14 sm:-right-16 ${
          hasStack ? 'max-h-[300px] sm:max-h-[380px]' : 'max-h-[330px] sm:max-h-[420px]'
        }`}
        stroke={shade(rgb, 0.62, hasStack ? 0.22 : 0.4)}
        fill={shade(rgb, 0.28, hasStack ? 0.09 : 0.17)}
      />

      {hasStack && (
        <div
          className="pointer-events-none absolute top-[7%] right-3 flex items-start sm:right-8 lg:top-[10%] lg:right-12"
        >
          {shown.map((frame, i) => (
            <div
              key={i}
              // The wrapper carries the rotation and the inner element carries
              // the entrance animation, because a keyframe that animates
              // `transform` would otherwise throw the rotation away on its
              // first frame and snap it back at the end.
              className={`${i > 0 ? '-ml-7 sm:-ml-10 lg:-ml-12' : ''} ${i === 2 ? 'hidden sm:block' : ''}`}
              style={{ transform: `rotate(${FAN[i].rotate}deg)`, zIndex: FAN[i].z }}
            >
              <div
                className="sc-rise w-24 overflow-hidden rounded-xl ring-1 shadow-2xl shadow-black/60 ring-white/20 sm:w-36 lg:w-44"
                style={{ aspectRatio: '3 / 4', animationDelay: `${i * 110}ms`, ...blurStyle(frame.thumbhash) }}
              >
                <picture>
                  <source type="image/avif" sizes={FRAME_SIZES} srcSet={frame.avif} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={frame.fallback}
                    srcSet={frame.webp}
                    sizes={FRAME_SIZES}
                    alt={frame.alt}
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </picture>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fades everything out before the text begins, so the headline sits on a
          settled ground rather than across the corner of a photograph. Taller
          than the drawn hero's 144px because here it has frames to swallow,
          not just line art. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-52"
        style={{
          background:
            'linear-gradient(to bottom, transparent, var(--background, #0b0d0f) 82%)',
        }}
      />

      <div className="absolute inset-x-0 bottom-0 px-4 pb-5 sm:px-8 sm:pb-7">
        <div className="mb-2.5 flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-lg"
            style={{ background: accent }}
          >
            <Icon className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
            {eyebrow}
          </span>
        </div>
        {/* max-w-[62%] on small screens keeps the headline clear of the fan;
            by `sm` the hero is wide enough that it does not need the cap. */}
        <h1 className="max-w-[62%] text-[30px] font-extrabold leading-[0.95] tracking-tighter sm:max-w-3xl sm:text-6xl">
          {title}
        </h1>
        <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
          {tagline}
        </p>
      </div>
    </div>
  );
}
