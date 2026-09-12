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

/** The switch itself. A switch rather than a checkbox or link because it
 *  reads as a setting that changes what's on screen, which is what it is.
 *  One button, so the label is part of the tap target. */
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
