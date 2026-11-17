// The Studio's JSON endpoints under /api/studio: who is asking, and answers.
//
// Pages use requireStudio(), which redirects. An endpoint answers 401
// instead, because the caller is a script in the Studio page, not a person.
//
// /api is outside the proxy (src/proxy.ts), so nothing refreshed the session
// before this runs. studioSupabase() refreshes it itself when it has expired
// and writes the new cookies onto the answer, which a Route Handler may do.

import "server-only";

import { getStudioState, type StudioSession } from "./session";
import type { UploadRefused } from "./uploads";

/** JSON that no cache keeps: every answer here is one person's. */
export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** The signed-in photographer, or the answer to send instead. */
export async function studioApiSession(): Promise<StudioSession | Response> {
  let state;
  try {
    state = await getStudioState();
  } catch {
    // Supabase did not answer. Not "signed out": the page can try again.
    return json(503, { error: "unavailable" });
  }
  if (state.kind === "signed-out") return json(401, { error: "signed_out" });
  if (state.kind === "no-account") return json(403, { error: "no_account" });
  return state.session;
}

/**
 * A change may only come from the Studio's own pages. The session cookie is
 * SameSite=Lax, which already keeps it off another site's POST; this refuses
 * such a request outright as well. A request with no Origin (not a browser)
 * still needs the cookie.
 */
export function fromThisSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

/** The JSON body of a request, or null when it is not JSON. */
export async function readJson(req: Request): Promise<unknown> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  try {
    return await req.json();
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// Which refusals mean "someone else's, or gone" and which "not now".
const NOT_FOUND = new Set(["not_found", "not_member"]);
const CONFLICT = new Set(["worker_offline", "quota", "no_folder", "folder_not_private", "not_failed", "cannot_retry"]);

/** A refusal from uploads.ts as an answer: { error: "<reason>", ...detail }. */
export function refusalResponse(err: UploadRefused): Response {
  const status = NOT_FOUND.has(err.reason) ? 404 : CONFLICT.has(err.reason) ? 409 : 400;
  return json(status, { error: err.reason, ...(err.detail ?? {}) });
}
