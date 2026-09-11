// src/lib/i18n/config.ts — locale definitions, safe to import anywhere.

export const locales = ["en", "ru", "uz"] as const;
export type Locale = (typeof locales)[number];

/**
 * The language the site speaks when nothing else says otherwise.
 *
 * Russian, not English. The audience is in Tashkent; English was the default
 * only because it was the language the code was written in.
 *
 * This is the FALLBACK, not an override. middleware.ts still resolves a saved
 * NEXT_LOCALE cookie first and the browser's Accept-Language second, so an
 * explicit choice and a real browser preference both still win — an
 * English-speaking visitor with an English browser is not dragged to Russian.
 * What changed is everything downstream of those two: a bare "/" from a browser
 * reporting a language we do not have, every `?? defaultLocale` guard, and the
 * dictionary loaded for an unrecognised locale segment.
 */
export const defaultLocale: Locale = "ru";

/** Shown in the language switcher, each in its own language. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  uz: "O'zbekcha",
};

/** Short codes for a compact mobile switcher. */
export const localeShort: Record<Locale, string> = { en: "EN", ru: "RU", uz: "UZ" };

/** hreflang values for <link rel="alternate">. */
export const localeHreflang: Record<Locale, string> = {
  en: "en",
  ru: "ru-UZ",
  uz: "uz-UZ",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Pulls the locale out of "/ru/portfolio" -> "ru". Falls back to default. */
export function localeFromPathname(pathname: string): Locale {
  const first = pathname.split("/").filter(Boolean)[0];
  return first && isLocale(first) ? first : defaultLocale;
}

/** Swaps the locale segment: ("/ru/book", "uz") -> "/uz/book". */
export function pathWithLocale(pathname: string, locale: Locale): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 0 && isLocale(parts[0])) parts[0] = locale;
  else parts.unshift(locale);
  return "/" + parts.join("/");
}