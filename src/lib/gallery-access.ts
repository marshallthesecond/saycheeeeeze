// src/lib/gallery-access.ts
//
// Who is allowed into a private gallery, and how we remember it.
//
// There is no user account here and there doesn't need to be one. A passkey
// unlocks exactly one gallery, and the proof of that unlock is a signed cookie
// scoped to that gallery's slug. Unlocking Sara's gallery gets you into Sara's
// gallery and nothing else.
//
// The cookie is HMAC-signed rather than encrypted. It carries no secret — only
// an expiry and a signature — so there is nothing in it worth hiding. What
// matters is that it can't be forged, and that a cookie minted for one slug
// can't be replayed against another, which is why the slug is inside the
// signed message.
//
// Verifying the passkey itself happens in Postgres, not here. See
// unlock_gallery() in the migration: pgcrypto compares the bcrypt hash inside
// a SECURITY DEFINER function, so the hash never leaves the database and
// setting a new code stays a one-line UPDATE you can run from the Supabase SQL
// editor.

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseRead } from "./supabase";

const SECRET = process.env.GALLERY_COOKIE_SECRET;

/** 30 days. Long enough that a client doesn't re-enter the code every visit. */
export const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 30;

export type UnlockResult = "ok" | "invalid" | "rate_limited" | "unavailable";

function requireSecret(): string {
  if (!SECRET || SECRET.length < 32) {
    throw new Error(
      "GALLERY_COOKIE_SECRET must be set to at least 32 characters. " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  return SECRET;
}

/**
 * One cookie per gallery. The slug is sanitised because it lands in a header
 * name — a slug with a space or a semicolon in it would otherwise produce a
 * malformed Set-Cookie that browsers drop silently.
 */
export function accessCookieName(slug: string): string {
  return `scz_gk_${slug.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
}

function sign(slug: string, expires: number): string {
  return createHmac("sha256", requireSecret())
    .update(`${slug.toLowerCase()}:${expires}`, "utf8")
    .digest("base64url");
}

/** Cookie value: "<unix-expiry>.<signature>" */
export function issueAccessCookie(slug: string): {
  name: string;
  value: string;
  maxAge: number;
} {
  const expires = Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS;
  return {
    name: accessCookieName(slug),
    value: `${expires}.${sign(slug, expires)}`,
    maxAge: ACCESS_TTL_SECONDS,
  };
}

export function verifyAccessCookie(
  slug: string,
  value: string | undefined,
): boolean {
  if (!value) return false;

  const [rawExpires, signature] = value.split(".");
  const expires = Number(rawExpires);
  if (!Number.isInteger(expires) || !signature) return false;
  if (expires <= Math.floor(Date.now() / 1000)) return false;

  // Compare as buffers of equal length, or timingSafeEqual throws rather than
  // returning false.
  const expected = Buffer.from(sign(slug, expires));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

/**
 * Checks a passkey against the database.
 *
 * Rate limiting, hash comparison and attempt logging all happen inside the
 * Postgres function — one round trip, and no path where a caller forgets to
 * count the attempt. `ip` is best-effort: behind a proxy it may be shared by a
 * whole network, which is why the limit is generous rather than strict.
 *
 * Returns "invalid" for both a wrong code and a gallery that doesn't exist.
 * Distinguishing them would let anyone enumerate which slugs are real.
 */
export async function checkPasskey(
  slug: string,
  code: string,
  ip: string | null,
): Promise<UnlockResult> {
  const trimmed = code.trim();
  if (!trimmed) return "invalid";

  // Cast because database.types.ts declares no Functions, so the typed client
  // rejects the RPC name outright. Regenerating types after the migration
  // teaches it about unlock_gallery and this can go back to supabaseRead().
  const { data, error } = await (
    supabaseRead() as unknown as SupabaseClient
  ).rpc("unlock_gallery", {
    p_slug: slug,
    p_code: trimmed,
    p_ip: ip ?? "unknown",
  });

  if (error) {
    console.error(`unlock_gallery failed for "${slug}": ${error.message}`);
    return "unavailable";
  }

  if (data === "ok" || data === "rate_limited") return data;
  return "invalid";
}

/**
 * Client IP as seen through Vercel's proxy. Falls back to null rather than to
 * a constant, so that a misconfigured deployment doesn't rate-limit every
 * visitor as if they were one person.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}