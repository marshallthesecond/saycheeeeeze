// Studio constants shared by the proxy and the server code.
//
// Nothing here may import "server-only" or anything that does: src/proxy.ts
// loads this file, and the proxy is not a Server Component.

export const STUDIO_HOME = "/studio";
export const STUDIO_LOGIN = "/studio/login";
export const STUDIO_NEW_GALLERY = "/studio/new";

/** A gallery's page in the Studio. `tab` is "settings" or "access". */
export function studioGalleryPath(slug: string, tab?: "settings" | "access"): string {
  return `/studio/g/${encodeURIComponent(slug)}${tab ? `/${tab}` : ""}`;
}

/** "/studio" and everything under it, but not "/studios" or "/studio-x". */
export function isStudioPath(pathname: string): boolean {
  return pathname === STUDIO_HOME || pathname.startsWith(`${STUDIO_HOME}/`);
}

/**
 * The Supabase address and the public (anon) key, or null when either is
 * missing. Supabase renamed the key; accept both spellings, as supabase.ts does.
 *
 * The anon key is the right one for the Studio: a signed-in photographer's
 * requests carry their own session, and the database decides what that session
 * may read. The service key is never used on a member's behalf.
 */
export function studioSupabaseEnv(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && anon ? { url, anon } : null;
}

/**
 * How the session cookie is stored.
 *
 * httpOnly: the Studio never talks to Supabase from the browser, only from the
 * server, so no script on the page needs to read the session, and one that is
 * injected cannot steal it.
 *
 * secure only in production, because `next dev` runs on plain http and Safari
 * drops a Secure cookie there.
 *
 * path "/" rather than "/studio": the upload endpoints will live under /api
 * and must receive the same cookie.
 */
export const STUDIO_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};

/**
 * Did Supabase Auth fail to ANSWER, as opposed to answering "no"?
 *
 * A free Supabase project that has been idle takes a few seconds to wake, and
 * a connection can simply drop. Neither means the photographer is signed out,
 * and treating it that way sends them to a sign-in form that explains nothing.
 * Callers use this to show "try again" instead.
 *
 * True for a network failure (supabase-js names it AuthRetryableFetchError and
 * gives it status 0), for any 5xx, and for an error with no status at all.
 * False for the real answers: 400 no session, 401/403 bad or expired token,
 * 429 too many attempts.
 */
export function isAuthOutage(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  return typeof error.status !== "number" || error.status === 0 || error.status >= 500;
}
