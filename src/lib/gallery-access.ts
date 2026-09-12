// Who gets into a private gallery. No accounts: a passkey unlocks one gallery
// and the proof is a cookie scoped to its slug.
//
// The cookie is HMAC-signed, not encrypted — it holds only an expiry and a
// signature. The slug is inside the signed message, so a cookie minted for one
// gallery cannot be replayed against another.
//
// The passkey is checked by unlock_gallery() in Postgres, so the bcrypt hash
// never leaves the database.

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseRead } from "./supabase";

const SECRET = process.env.GALLERY_COOKIE_SECRET;

/** 30 days, so a client is not re-typing the code every visit. */
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

/** One cookie per gallery. The slug is sanitised because it lands in a header
 *  name, and a space or semicolon there is silently dropped by browsers. */
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

  // Equal lengths first, or timingSafeEqual throws instead of returning false.
  const expected = Buffer.from(sign(slug, expires));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

/**
 * Rate limiting, hashing and attempt logging all happen inside
 * unlock_gallery(). "invalid" covers both a wrong code and a gallery that does
 * not exist — telling them apart would let anyone enumerate the slugs.
 */
export async function checkPasskey(
  slug: string,
  code: string,
  ip: string | null,
): Promise<UnlockResult> {
  const trimmed = code.trim();
  if (!trimmed) return "invalid";

  // Cast because database.types.ts declares no Functions, so the typed client
  // rejects the RPC name. Regenerating types would remove the need.
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

/** Client IP through Vercel's proxy. Null rather than a constant, so a
 *  misconfigured deploy does not rate-limit every visitor as one person. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}
