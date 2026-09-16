'use client';

// "WIUT student?" — one switch that re-points the page's copy at a specific
// audience, with no navigation and no reload.
//
// A toggle rather than a /graduation/wiut route: a second URL would split the
// same offer in two, halve whatever search authority either earns, and make a
// visitor classify themselves before reading anything.
//
// The state is a context because the switch is in one place and the text it
// changes is in several, some inside other client islands. The provider takes
// `children`, so everything inside stays a server component — only the pieces
// that change on toggle are client-rendered, which is why <AudienceText>
// exists rather than the page branching.
//
// Nothing is persisted. Reading a stored answer would mean rendering base copy
// on the server and swapping it after hydration — a flicker of the wrong text
// on every load, to save a tap that costs nothing.

import { createContext, useContext, useState, type ReactNode } from 'react';

import { blurStyle } from '@/src/lib/ladder';

interface AudienceState {
  on: boolean;
  setOn: (v: boolean) => void;
}

const Ctx = createContext<AudienceState>({ on: false, setOn: () => {} });

export function useAudience(): AudienceState {
  return useContext(Ctx);
}

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return <Ctx.Provider value={{ on, setOn }}>{children}</Ctx.Provider>;
}

/** Renders `alt` when the switch is on, `base` otherwise. Client-side by
 *  necessity: a server component's output is fixed HTML, so text that changes
 *  on a toggle has to be produced here. */
export function AudienceText({ base, alt }: { base: string; alt?: string }) {
  const { on } = useAudience();
  return <>{on && alt ? alt : base}</>;
}

/**
 * Content that belongs to the selected audience only — the ceremony block, in
 * practice. A WIUT ceremony at a named venue is either the most useful thing on
 * the page or noise about someone else's university, and which one it is has an
 * answer sitting directly above it.
 *
 * Collapsed, NOT unmounted, for three reasons. The children stay in the
 * server-rendered HTML, so a crawler reading this page for "where is the WIUT
 * graduation held" still finds the venue and the slots. The height animates —
 * a block that appears instantly under the control you just pressed reads as
 * the page jumping rather than as an answer. And the countdown inside keeps its
 * mounted clock instead of restarting on every toggle.
 *
 * `grid-template-rows: 0fr → 1fr` is the only way to transition to a height the
 * content decides; `height: auto` does not animate, and a fixed max-height is a
 * guess that clips the moment the Russian copy runs one line longer. The inner
 * element needs both `min-h-0` and `overflow-hidden` or the 0fr row refuses to
 * shrink below its content.
 *
 * aria-hidden alone is enough here: ServiceEventBlock is text and icons with
 * nothing focusable in it, so there is no tab stop to strand inside a collapsed
 * box. Put anything clickable in here and this needs `inert` as well.
 */
export function AudienceOnly({ children }: { children: ReactNode }) {
  const { on } = useAudience();

  return (
    <div
      aria-hidden={!on}
      className="grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: on ? '1fr' : '0fr', opacity: on ? 1 : 0 }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * A backdrop photograph, already resolved to plain strings by the page.
 *
 * The island stays ignorant of the ladder, the database and the locale — same
 * rule as every other client component here. Absent means "no ladder row for
 * that path", and the band renders as accent alone rather than reaching for the
 * original file.
 */
export interface AudienceBackdrop {
  avif: string;
  webp: string;
  fallback: string;
  thumbhash?: string;
}

/** The band spans the intro column: full width on a phone, 672px capped. */
const BACKDROP_SIZES = '(max-width: 704px) 100vw, 672px';

/** Lifted out of the JSX so the two layers below are visibly the same gradient
 *  with different weights, rather than two long strings to diff by eye. */
function offGradient(): string {
  return `linear-gradient(96deg,
    rgba(6,10,16,0.95) 0%,
    rgba(6,10,16,0.88) 44%,
    rgba(6,10,16,0.62) 74%,
    rgba(6,10,16,0.46) 100%)`;
}

function onGradient(accent: string): string {
  return `linear-gradient(96deg,
    rgba(6,10,16,0.94) 0%,
    rgba(6,10,16,0.80) 38%,
    ${accent}8c 72%,
    ${accent}52 100%)`;
}

/**
 * The switch itself — a photograph of the place, the question, and the control.
 *
 * A switch rather than a checkbox or link because it reads as a setting that
 * changes what's on screen, which is what it is. One button, so the whole band
 * is the tap target.
 *
 * The campus behind it does two jobs at once, which is why it is worth the
 * bytes: it identifies the audience faster than the sentence does, and it gives
 * the switch a visible ON state — the photograph lifts out of the dark and the
 * accent washes across it — so nothing has to be written underneath explaining
 * that a tap worked.
 */
export function AudienceToggle({
  prompt,
  accent,
  backdrop,
}: {
  prompt: string;
  accent: string;
  backdrop?: AudienceBackdrop;
}) {
  const { on, setOn } = useAudience();

  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      className="relative flex min-h-19 w-full items-center gap-4 overflow-hidden rounded-2xl border px-4 py-4 text-left transition active:scale-[0.995] sm:min-h-21 sm:px-5"
      style={{
        borderColor: on ? accent : 'rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      {backdrop && (
        // ThumbHash underneath, so the band is never an empty rectangle that
        // fills in late — the placeholder is an inline data URL and costs a
        // request of nothing.
        <span aria-hidden className="absolute inset-0" style={blurStyle(backdrop.thumbhash)}>
          <picture>
            <source type="image/avif" sizes={BACKDROP_SIZES} srcSet={backdrop.avif} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={backdrop.fallback}
              srcSet={backdrop.webp}
              sizes={BACKDROP_SIZES}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-[center_38%] transition-[opacity,filter] duration-500 motion-reduce:transition-none"
              style={{
                opacity: on ? 0.9 : 0.5,
                filter: on ? 'saturate(1.05)' : 'saturate(0.75)',
              }}
            />
          </picture>
        </span>
      )}

      {/* Two gradients cross-faded on opacity rather than one whose stops
          change. CSS cannot interpolate between two gradient IMAGES, so
          transitioning `background` snaps from one to the other at whatever
          frame the toggle lands on; stacked layers at opposite opacities is the
          only version of this that actually animates. */}
      <span
        aria-hidden
        className="absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none"
        style={{ background: offGradient(), opacity: on ? 0 : 1 }}
      />
      <span
        aria-hidden
        className="absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none"
        style={{ background: onGradient(accent), opacity: on ? 1 : 0 }}
      />

      {/* The text sits on the 0.94-opaque end of both gradients, never on bare
          photograph — a question in white over a daylit building is the kind of
          thing that reads fine on the one frame you tested it against. */}
      <span className="relative z-10 min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-snug tracking-tight text-white sm:text-base">
          {prompt}
        </span>
      </span>

      {/* The track and knob are plain spans because a styled checkbox brings
          more browser inconsistency than it saves; the button carries the
          semantics via aria-pressed. The off-state track is brighter than it
          was — 0.16 white vanished once there was a photograph behind it. */}
      <span
        aria-hidden
        className="relative z-10 h-6 w-11 shrink-0 rounded-full shadow-sm transition-colors"
        style={{ background: on ? accent : 'rgba(255,255,255,0.32)' }}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: on ? 'translateX(20px)' : 'none' }}
        />
      </span>
    </button>
  );
}
