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
//
// THE STUDIO (/studio) is the one section that is not locale-prefixed, and the
// one section with a signed-in session. For those paths this file does a
// second job: it keeps the session alive. See studioProxy() at the bottom.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { defaultLocale, isLocale, type Locale } from "@/src/lib/i18n/config";
import {
  STUDIO_COOKIE_OPTIONS,
  STUDIO_HOME,
  STUDIO_LOGIN,
  isAuthOutage,
  isStudioPath,
  studioSupabaseEnv,
} from "@/src/lib/studio/config";

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

  // Before the locale logic: /studio must not become /ru/studio.
  if (isStudioPath(pathname)) return studioProxy(req);

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

/**
 * The Studio's session, refreshed before the page renders.
 *
 * WHY HERE. A Supabase session is a short-lived access token (one hour) plus a
 * refresh token that swaps it for a new pair. Server Components can read
 * cookies but cannot write them, so a page that found an expired token could
 * refresh it and then have nowhere to store the result — and a refresh token
 * works once, so the next request would arrive with a dead one and be signed
 * out. The proxy runs first and CAN write cookies, so the swap happens here
 * and the page always receives a live session.
 *
 * WHAT IT DECIDES. Only where to send someone, from the cookie alone: signed
 * out and not on the sign-in page goes to sign-in; signed in and on the
 * sign-in page goes to the Studio. It does not decide what anyone may see.
 * That is requireStudio() in every page and Row Level Security in the
 * database; this is a shortcut in front of them, not a replacement.
 */
async function studioProxy(req: NextRequest) {
  const env = studioSupabaseEnv();
  // No Supabase settings: let the page load and report it properly.
  if (!env) return NextResponse.next();

  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(env.url, env.anon, {
    cookieOptions: STUDIO_COOKIE_OPTIONS,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        // Onto the request, so the page rendering after this sees the new
        // session; onto the response, so the browser stores it.
        for (const { name, value } of cookiesToSet) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) res.cookies.set(name, value, options);
        // Cache-Control: private, no-store and friends. A response that sets
        // a session cookie must never be kept by a CDN and served to someone
        // else.
        for (const [key, value] of Object.entries(headers)) res.headers.set(key, value);
      },
    },
  });

  let signedIn: boolean;
  try {
    // Reads the token, checks its signature and refreshes it if it has
    // expired. Nothing may run between creating the client and this call.
    const { data, error } = await supabase.auth.getClaims();
    // Supabase did not answer (a free project waking up, a dropped
    // connection). That is not "signed out": let the request through, and the
    // page will say "try again" instead of asking for a password.
    if (isAuthOutage(error)) return res;
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    return res;
  }

  const onLogin = req.nextUrl.pathname === STUDIO_LOGIN;
  if (signedIn === onLogin) {
    const url = req.nextUrl.clone();
    url.pathname = signedIn ? STUDIO_HOME : STUDIO_LOGIN;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // A refresh may have happened on the way to this decision. Carry it.
    for (const cookie of res.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return res;
}

export const config = {
  // Skip Next internals and anything with a file extension. Unchanged from the
  // middleware version — the matcher format did not move.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
