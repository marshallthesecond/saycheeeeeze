// Client-side variant loading, deliberately outside the i18n dictionaries.
//
// The dictionary goes to LanguageProvider in the [locale] layout, so anything
// added there rides in the RSC payload of every page. The bio pool is only
// needed on /about and grows over time — 100 variants would be ~20KB on every
// navigation. Loaded here it becomes its own chunk, fetched once, only on the
// About page, only for the active language.

import type { Locale } from "@/src/lib/i18n/config";
import { defaultLocale } from "@/src/lib/i18n/config";

const loaders = {
  en: () => import("./variants/en").then((m) => m.bios),
  ru: () => import("./variants/ru").then((m) => m.bios),
  uz: () => import("./variants/uz").then((m) => m.bios),
} as const;

export function loadBios(locale: Locale): Promise<readonly string[]> {
  return (loaders[locale] ?? loaders[defaultLocale])();
}

/**
 * Dev-only warning when the three files have drifted out of sync.
 *
 * The deck stores an index rather than the text, so switching language keeps
 * you on the same variant — but only while the arrays are the same length and
 * roughly parallel. Drift breaks nothing (the index is clamped); it just
 * silently hands you a different bio on language switch.
 */
export async function assertPoolParity(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const counts = await Promise.all(
    (Object.keys(loaders) as Locale[]).map(async (l) => [l, (await loaders[l]()).length] as const)
  );
  const unique = new Set(counts.map(([, n]) => n));
  if (unique.size > 1) {
    console.warn(
      "[bio] Variant counts differ between locales:",
      Object.fromEntries(counts),
      "\nAdd the same number of variants to each file in src/lib/bio/variants/."
    );
  }
}