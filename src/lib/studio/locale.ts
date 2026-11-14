// Which language the Studio speaks.
//
// The Studio is not under /[locale]/, so there is no language in its address.
// It follows the same NEXT_LOCALE cookie the public site writes when someone
// switches language, then the browser's own preference, then the default.
// Same order as src/proxy.ts.

import "server-only";

import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, type Locale } from "@/src/lib/i18n/config";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export async function getStudioLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (saved && isLocale(saved)) return saved;

  const accept = (await headers()).get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
}
