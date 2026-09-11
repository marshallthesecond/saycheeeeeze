// src/lib/i18n/rememberLocale.ts
//
// Writes the NEXT_LOCALE cookie that middleware reads when someone lands on a
// bare "/" — so a returning Russian visitor doesn't get bounced to English by
// their browser's Accept-Language header.
//
// It lives in its own module rather than inline in the switcher because
// touching document.cookie is a side effect on a browser global; keeping it
// out of the component body makes that boundary explicit.

import type { Locale } from "./config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function rememberLocale(next: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
