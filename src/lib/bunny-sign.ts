// Signed URLs for the private pull zone. Server-only: this key mints a valid
// URL for any file in the zone.
//
// Bunny Advanced (v2) token auth:
//   token = "HS256-" + base64url(HMAC-SHA256(key, path + expires + signing_data))
// signing_data is every query param except token/expires, sorted, "k=v" joined
// with "&", values decoded. Then + → -, / → _, = stripped.
//
// Debugging a 403: the signature covers the query string, so appending
// ?width=800 to a signed URL breaks it. And the path is hashed DECODED but
// sent ENCODED — get encodePath() wrong and only filenames with spaces or
// Cyrillic fail. IP locking is off; clients are on mobile networks that
// change address mid-session.

import "server-only";
import { createHmac } from "node:crypto";

import type { DownloadSizes, LadderSources } from "./ladder";

/** e.g. https://saycheeeeeze-private.b-cdn.net — no trailing slash. */
const PRIVATE_HOST = process.env.BUNNY_PRIVATE_PULL_ZONE;

/** Pull Zone → Security → Token Authentication → URL Token Authentication Key. */
const TOKEN_KEY = process.env.BUNNY_PRIVATE_TOKEN_KEY;

/** Six hours: outlasts a slow "download all". ClientGalleryView re-signs
 *  before it lapses. Not the login lifetime — that is the passkey cookie. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

/** Width baked into grid thumbnails. Retina-comfortable on a phone. */
const THUMB_WIDTH = 1000;
const THUMB_QUALITY = 80;

export interface SignedPhoto {
  src: string;
  /** Grid-size, with its resize parameters baked into the signature. */
  thumbSrc: string;
  alt?: string;
  /** Absent means no pre-generated derivatives for this photo yet. */
  ladder?: LadderSources;
  thumbhash?: string;
  width?: number;
  height?: number;
  /** Signed URLs carry query params, so the name cannot be parsed out. */
  fileName?: string;
  sizes?: DownloadSizes;
}

export function privateZoneConfigured(): boolean {
  return Boolean(PRIVATE_HOST && TOKEN_KEY);
}

function requireConfig(): { host: string; key: string } {
  if (!PRIVATE_HOST || !TOKEN_KEY) {
    throw new Error(
      "Private galleries need BUNNY_PRIVATE_PULL_ZONE and BUNNY_PRIVATE_TOKEN_KEY. " +
        "Set both in .env.local and restart the dev server — env is read at startup. " +
        "See docs: the private pull zone is the one with Token Authentication ON.",
    );
  }
  return { host: PRIVATE_HOST.replace(/\/$/, ""), key: TOKEN_KEY };
}

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** "clients/sara/IMG 01.jpg" → "/clients/sara/IMG%2001.jpg" */
function encodePath(decodedPath: string): string {
  return decodedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** "clients/sara/IMG 01.jpg" or "/clients/…" → "/clients/sara/IMG 01.jpg" */
function normalisePath(storagePath: string): string {
  const trimmed = storagePath.replace(/^\/+/, "");
  return `/${trimmed}`;
}

/** `params` are part of the signature, so this is the only place query
 *  parameters can be added. */
export function signBunnyUrl(
  storagePath: string,
  options: { params?: Record<string, string>; expiresAt?: number } = {},
): string {
  const { host, key } = requireConfig();

  const path = normalisePath(storagePath);
  const expires =
    options.expiresAt ?? Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const params = options.params ?? {};

  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const message = `${path}${expires}${signingData}`;
  const token = `HS256-${base64url(
    createHmac("sha256", key).update(message, "utf8").digest(),
  )}`;

  const query = new URLSearchParams(params);
  query.set("token", token);
  query.set("expires", String(expires));

  return `${host}${encodePath(path)}?${query.toString()}`;
}

/**
 * One token for a whole directory. Per-file signing would put ~4,800 tokens in
 * a 300-photo gallery's payload.
 *
 * The spelling is not guesswork: prove-directory-token.mjs tested four against
 * the live zone and only this one works — token_path as a query parameter,
 * INCLUDED in signing_data, and itself the signature path. Re-run that script
 * after any Bunny security change.
 */
export function signDirectoryQuery(
  directory: string,
  expiresAt?: number,
): string {
  const { key } = requireConfig();

  // Trailing slash required: it is a prefix, and "/d/gallery" would also
  // authorise "/d/gallery-of-someone-else".
  const raw = normalisePath(directory);
  const path = raw.endsWith("/") ? raw : `${raw}/`;

  const expires =
    expiresAt ?? Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;

  const params: Record<string, string> = { token_path: path };
  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const token = `HS256-${base64url(
    createHmac("sha256", key).update(`${path}${expires}${signingData}`, "utf8").digest(),
  )}`;

  const query = new URLSearchParams(params);
  query.set("token", token);
  query.set("expires", String(expires));
  return `?${query.toString()}`;
}

/** The host a signed URL must be built against. */
export function privateHost(): string {
  return requireConfig().host;
}

/** Both URLs share an expiry, so the page lapses all at once. */
export function signedPhoto(
  storagePath: string,
  alt: string | null | undefined,
  expiresAt: number,
  // Optional and last, so the existing call signatures keep compiling.
  meta?: {
    width?: number | null;
    height?: number | null;
    fileName?: string | null;
    sizes?: DownloadSizes;
  },
): SignedPhoto {
  return {
    src: signBunnyUrl(storagePath, { expiresAt }),
    thumbSrc: signBunnyUrl(storagePath, {
      expiresAt,
      params: { quality: String(THUMB_QUALITY), width: String(THUMB_WIDTH) },
    }),
    alt: alt ?? undefined,
    width: meta?.width ?? undefined,
    height: meta?.height ?? undefined,
    fileName: meta?.fileName ?? undefined,
    sizes: meta?.sizes,
  };
}

/** One deadline for a whole page of photos. */
export function nextExpiry(): number {
  return Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
}
