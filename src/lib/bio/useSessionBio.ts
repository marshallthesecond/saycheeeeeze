"use client";

// Owns two rules: one variant per browser session, dealt from the deck, and
// one typing animation per browser session.
//
// Everything runs inside an effect so the server and the first client render
// agree — both produce no variant — and the draw happens after mount. No
// hydration mismatch.

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/src/lib/i18n/config";
import { assertPoolParity, loadBios } from "./pool";
import { drawIndex, readSession, writeSession } from "./deck";

interface State {
  /** null until the pool has loaded and a variant has been dealt. */
  text: string | null;
  /** True only on the session's first paint of the About page. */
  animate: boolean;
}

export function useSessionBio(locale: Locale) {
  const [state, setState] = useState<State>({ text: null, animate: false });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let bios: readonly string[];
      try {
        bios = await loadBios(locale);
      } catch {
        return; // chunk failed to load — component falls back to the dictionary bio
      }

      // Re-running for a locale switch must not overwrite a newer result.
      if (cancelled || bios.length === 0) return;

      void assertPoolParity();

      const existing = readSession(bios.length);

      if (existing) {
        // Same session: keep the variant, animate only if the first play
        // never finished — they navigated away mid-type.
        setState({ text: bios[existing.index] ?? bios[0]!, animate: !existing.typed });
        return;
      }

      const index = drawIndex(bios.length);
      if (index < 0) return;

      writeSession({ index, typed: false });
      setState({ text: bios[index] ?? bios[0]!, animate: true });
    })();

    return () => {
      cancelled = true;
    };
    // Locale is the only dependency: switching language re-reads the same
    // index from the new file, so the visitor keeps their variant, translated.
  }, [locale]);

  const markTyped = useCallback(() => {
    const current = readSession();
    if (current) writeSession({ ...current, typed: true });
  }, []);

  return { ...state, markTyped };
}