// src/lib/i18n/dictionaries.ts — SERVER-side dictionary loading.
//
// Dynamic imports mean only the requested language ships in the payload,
// rather than all three.

import type { Locale } from "@/src/lib/i18n/config";
import { defaultLocale } from "@/src/lib/i18n/config";

const loaders = {
  en: () => import("./dictionaries/en.json").then((m) => m.default),
  ru: () => import("./dictionaries/ru.json").then((m) => m.default),
  uz: () => import("./dictionaries/uz.json").then((m) => m.default),
} as const;

export type Dictionary = Awaited<ReturnType<typeof loaders.en>>;

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  return (loaders[locale] ?? loaders[defaultLocale])();
}