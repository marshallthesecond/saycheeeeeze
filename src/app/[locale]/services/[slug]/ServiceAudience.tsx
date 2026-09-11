'use client';

// src/app/[locale]/services/[slug]/ServiceAudience.tsx
//
// "WIUT student?" — one switch that re-points the page's copy at a specific
// audience, with no navigation and no reload.
//
// ── Why a toggle rather than a second page ───────────────────
// A /graduation/wiut route would split the same offer across two URLs, halve
// whatever search authority either one earns, and force a visitor to classify
// themselves before they have read anything. This is the same page saying the
// same thing in the visitor's own terms — "At WIUT" instead of "At campus" —
// which is what personalisation is actually for.
//
// ── Why the state lives in a context ─────────────────────────
// The switch is in one place and the text it changes is in several, some of
// them inside other client islands (the package titles are in
// ServicePackages). A context is the smallest thing that connects them without
// making the whole page a client component.
//
// The provider takes `children`, so everything inside it stays a SERVER
// component — a client component can render server children passed as a prop.
// Only the pieces that actually change on toggle need to be client-rendered,
// which is why <AudienceText> exists rather than the page simply branching.
//
// ── Why nothing is persisted ─────────────────────────────────
// Reading a stored answer would mean rendering the base copy on the server and
// swapping it after hydration — a visible flicker of the wrong text on every
// load, to save a tap that costs nothing. It resets on reload, and that is the
// better trade.

import { createContext, useContext, useState, type ReactNode } from 'react';

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

/**
 * Renders `alt` when the switch is on, `base` otherwise.
 *
 * Both strings are rendered by the CLIENT — that is the whole point. A server
 * component's output is fixed HTML, so any text that has to change on a toggle
 * has to be produced here.
 */
export function AudienceText({ base, alt }: { base: string; alt?: string }) {
  const { on } = useAudience();
  return <>{on && alt ? alt : base}</>;
}

/**
 * The switch itself.
 *
 * A real switch rather than a checkbox or a link: it reads as a setting that
 * changes what is on screen, which is exactly what it does. `aria-pressed`
 * carries the state, and the whole control is one button so the label is part
 * of the tap target.
 */
export function AudienceToggle({
  prompt,
  accent,
  hint,
}: {
  prompt: string;
  accent: string;
  /** Shown once the switch is on, to confirm something actually happened. */
  hint?: string;
}) {
  const { on, setOn } = useAudience();

  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition"
      style={{
        borderColor: on ? accent : 'rgba(255,255,255,0.12)',
        background: on ? `${accent}1f` : 'rgba(255,255,255,0.03)',
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-white">{prompt}</span>
        {on && hint && (
          <span className="mt-0.5 block text-[11px] leading-snug text-white/50">{hint}</span>
        )}
      </span>

      {/* The track and knob are plain divs because a styled checkbox brings
          more browser inconsistency than it saves; the button carries the
          semantics via aria-pressed. */}
      <span
        aria-hidden
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: on ? accent : 'rgba(255,255,255,0.16)' }}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: on ? 'translateX(20px)' : 'none' }}
        />
      </span>
    </button>
  );
}
