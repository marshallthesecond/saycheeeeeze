// src/proxy.ts
//
// Every page lives under /[locale]/…, so a request to "/portfolio" needs to be
// sent to "/ru/portfolio". Detection order: saved cookie -> Accept-Language
// header -> default. Cookie first means an explicit choice always wins over
// whatever the browser reports; the default is Russian (see i18n/config.ts).
//
// proxy.ts, not middleware.ts: Next 16 renamed the convention, and the file,
// the exported function name and the runtime all changed. The matcher did not.
// Without this file every bare URL stops being locale-prefixed.
//
// One behavioural change worth knowing: Proxy defaults to the Node runtime
// where Middleware defaulted to Edge. Nothing here depends on either, but the
// `runtime` option is not merely ignored in a proxy file — it throws, so it
// must never be added.

import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, type Locale } from "@/src/lib/i18n/config";

// Paths that must never be locale-prefixed.
const EXCLUDED = ["/api", "/_next", "/sitemap.xml", "/robots.txt", "/favicon.ico"];

function detectLocale(req: NextRequest): Locale {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (cookie && isLocale(cookie)) return cookie;

  // Accept-Language looks like "ru-RU,ru;q=0.9,en;q=0.8" — take the first
  // entry whose base tag we support.
  const header = req.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (EXCLUDED.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // Any request for a real file (e.g. /img1.png) passes through untouched.
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return NextResponse.next();

  const first = pathname.split("/").filter(Boolean)[0];
  if (first && isLocale(first)) return NextResponse.next();

  const locale = detectLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and anything with a file extension. Unchanged from the
  // middleware version — the matcher format did not move.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
