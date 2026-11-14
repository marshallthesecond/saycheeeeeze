// The Studio's own words, kept apart from the site's dictionaries.
//
// The site's dictionary is sent to the browser with every public page. The
// Studio's texts would ride along with it and reach every visitor, for a
// screen only a signed-in photographer opens. So they live here and load only
// under /studio.
//
// Same rule as the site: en.json is the reference and all three files must
// carry the same keys. `node scripts/check-dictionaries.mjs --dir
// src/lib/studio/dictionaries` checks it in a few milliseconds.

import type { Locale } from "@/src/lib/i18n/config";
import { defaultLocale } from "@/src/lib/i18n/config";

const loaders = {
  en: () => import("./dictionaries/en.json").then((m) => m.default),
  ru: () => import("./dictionaries/ru.json").then((m) => m.default),
  uz: () => import("./dictionaries/uz.json").then((m) => m.default),
} as const;

export type StudioDictionary = Awaited<ReturnType<typeof loaders.en>>;

export async function getStudioDictionary(locale: Locale): Promise<StudioDictionary> {
  return (loaders[locale] ?? loaders[defaultLocale])();
}

type Vars = Record<string, string | number>;
export type StudioT = (key: string, vars?: Vars) => string;

/**
 * t() for Server Components, which cannot use the useT() hook.
 *
 *   const t = translator(await getStudioDictionary(locale));
 *   t("galleries.title")              -> "Galleries"
 *   t("galleries.photosMany", { n })  -> "86 photos"
 *
 * A missing key returns the key itself, like useT().
 */
export function translator(dict: StudioDictionary): StudioT {
  return (key, vars) => {
    let value: unknown = dict;
    for (const part of key.split(".")) {
      if (value && typeof value === "object" && part in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return key;
      }
    }
    if (typeof value !== "string") return key;
    if (!vars) return value;
    return Object.entries(vars).reduce(
      (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)),
      value,
    );
  };
}
