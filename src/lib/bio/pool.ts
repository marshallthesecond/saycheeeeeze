// src/lib/bio/pool.ts — CLIENT-side variant loading.
//
// Deliberately NOT part of the i18n dictionaries. The dictionary is handed to
// LanguageProvider in the [locale] layout, so anything added there ships in the
// RSC payload of EVERY page. The bio pool is only ever needed on /about, and it
// grows over time — 100 variants would be ~20KB riding along on every single
// navigation.
//
// Loading it here instead means it becomes its own chunk, fetched once, only on
// the About page, and only for the active language.

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
 * Warns (dev only) if the three files have drifted out of sync.
 *
 * The deck stores an INDEX, not the text, so switching language keeps you on
 * the same variant. That only holds while the arrays are the same length and
 * roughly parallel in position. Nothing breaks if they drift — the index is
 * clamped — but you'd silently get a different bio on language switch.
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