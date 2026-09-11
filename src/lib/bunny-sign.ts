// src/lib/bunny-sign.ts
//
// Signed URLs for the PRIVATE pull zone. Server-only — the security key here is
// the whole ballgame. Anyone holding it can mint a valid URL for any file in
// the zone, so it must never be prefixed NEXT_PUBLIC_ and must never be
// imported by a client component.
//
// This is the counterpart to bunny-url.ts. That one builds plain public URLs
// for the public pull zone; this one builds expiring URLs for the private one.
// A storage path goes to exactly one of them depending on the gallery it
// belongs to — never both.
//
// ── The algorithm ─────────────────────────────────────────
// Bunny's Advanced (v2) token authentication:
//
//   token = "HS256-" + base64url(HMAC-SHA256(key, signature_path + expires + signing_data))
//
//   signature_path  the DECODED url path, leading slash included
//   expires         unix seconds, as a decimal string
//   signing_data    every query parameter except `token` and `expires`,
//                   sorted by key, joined "k=v" with "&", values DECODED
//
// Then + → -, / → _, and = stripped.
//
// Two details worth knowing before you debug a 403:
//
//  1. The signature covers the query string. Adding ?width=800 to a signed URL
//     after the fact invalidates it. That is why thumbnails are signed
//     separately below rather than being derived in the browser — see
//     signedPhoto() and the PhotoGrid patch that goes with it.
//
//  2. The path is hashed decoded but sent encoded. A file called "Sara 01.jpg"
//     is hashed as "/clients/x/Sara 01.jpg" and requested as
//     "/clients/x/Sara%2001.jpg". encodePath() below is what keeps those in
//     step; get it wrong and only the files with spaces or Cyrillic in their
//     names will fail, which is a miserable bug to chase.
//
// IP locking is deliberately not used. Bunny binds IPv4 tokens to the exact
// address, and clients here are on Uzbek mobile networks where the address
// changes mid-session. It would lock out the very people it's for.

import "server-only";
import { createHmac } from "node:crypto";

import type { DownloadSizes, LadderSources } from "./ladder";

/** e.g. https://saycheeeeeze-private.b-cdn.net — no trailing slash. */
const PRIVATE_HOST = process.env.BUNNY_PRIVATE_PULL_ZONE;

/** Pull Zone → Security → Token Authentication → URL Token Authentication Key. */
const TOKEN_KEY = process.env.BUNNY_PRIVATE_TOKEN_KEY;

/**
 * How long a signed URL stays valid.
 *
 * This is NOT how long a client stays logged in — the passkey cookie handles
 * that and lasts 30 days. This only bounds how long a URL survives after being
 * copied out of the page, so a leaked link goes dead the same afternoon.
 *
 * Six hours is chosen to outlast a slow "download all" over a phone
 * connection. ClientGalleryView re-signs in the background before it lapses,
 * so a gallery left open overnight doesn't wake up to broken images.
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

/** Width baked into grid thumbnails. Retina-comfortable on a phone. */
const THUMB_WIDTH = 1000;
const THUMB_QUALITY = 80;

export interface SignedPhoto {
  /** Full-size, signed. Lightbox, download, share and zip all use this. */
  src: string;
  /** Grid-size, signed with its resize parameters baked in. */
  thumbSrc: string;
  alt?: string;
  /** Pre-generated derivatives, when the worker has built them. Absent means
   *  this photo still renders from src/thumbSrc via the Optimizer. */
  ladder?: LadderSources;
  /** ThumbHash, base64. ~25 bytes; decodes to a blurred preview client-side. */
  thumbhash?: string;
  /** Intrinsic dimensions — see the note on AlbumPhoto in albums.ts. Private
   *  galleries need these just as much as public ones; a client scrolling
   *  their own shoot is exactly who notices a grid re-flowing under them. */
  width?: number;
  height?: number;
  /** Real filename. Signed URLs carry token/expires query parameters, so
   *  parsing a name out of the URL is even less reliable here than usual. */
  fileName?: string;
  /** Bytes per download tier, so the chooser can say what each one costs
   *  before the client commits to it. See DownloadSizes in ladder.ts. */
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

/**
 * Signs one exact URL.
 *
 * `params` are the query parameters that will be ON the final URL, other than
 * token and expires. They are part of the signature, so this is the only place
 * they can be added.
 */
export function signBunnyUrl(
  storagePath: string,
  options: { params?: Record<string, string>; expiresAt?: number } = {},
): string {
  const { host, key } = requireConfig();

  const path = normalisePath(storagePath);
  const expires =
    options.expiresAt ?? Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const params = options.params ?? {};

  // Sorted, decoded, "k=v" joined by "&". Empty string when there are none.
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
 * Signs a DIRECTORY, so one token covers everything beneath it.
 *
 * This is what makes the derivative ladder affordable on a private gallery.
 * Signing per file would mean one token per width per format — sixteen for a
 * single photo, ~4,800 for a 300-photo gallery, all of them in the page
 * payload. Signing the gallery's prefix once replaces the lot with a single
 * query string appended to every URL underneath it.
 *
 * ── The exact spelling matters, and it was proven, not guessed ──
 * scripts/prove-directory-token.mjs tested all four candidate spellings against
 * the live zone. Only ONE was accepted:
 *
 *   • token_path travels as a QUERY PARAMETER on the final URL, and
 *   • token_path is INCLUDED in signing_data, and
 *   • token_path — not the file path — is the signature_path.
 *
 * The other three (token_path excluded from signing_data, and the in-path
 * /bcdn_token=…/ form) returned 403. Re-run that script after any Bunny
 * security change; the failure mode is a silent 403 that looks exactly like a
 * wrong key.
 *
 * Returns the query string INCLUDING the leading "?", ready to append to any
 * URL under `directory`.
 */
export function signDirectoryQuery(
  directory: string,
  expiresAt?: number,
): string {
  const { key } = requireConfig();

  // Must have a trailing slash: it is a prefix, and "/d/gallery" would also
  // authorise "/d/gallery-of-someone-else".
  const raw = normalisePath(directory);
  const path = raw.endsWith("/") ? raw : `${raw}/`;

  const expires =
    expiresAt ?? Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;

  // token_path is itself part of signing_data — that is the whole difference
  // between the spelling that works and the one that 403s.
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

/**
 * The pair of URLs a gallery photo needs: one full-size, one grid-size.
 *
 * Both carry the same `expiresAt` so the whole page lapses at one moment
 * rather than the thumbnails dying while the lightbox still works.
 */
export function signedPhoto(
  storagePath: string,
  alt: string | null | undefined,
  expiresAt: number,
  // Optional and last, so the three existing call signatures keep compiling.
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