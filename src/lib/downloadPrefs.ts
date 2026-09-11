// src/lib/downloadPrefs.ts
//
// What the client last chose in the download sheet, remembered per browser.
//
// ── Why this is remembered at all ────────────────────────────
// The sheet asks two questions — which quality, and one archive or separate
// files. Asking them again for every photo turns saving twenty favourites into
// forty taps and forty identical answers. So the sheet is shown once, the
// answer is kept, and after that a single-photo download just happens with a
// small control beside the button for changing it.
//
// ── Why localStorage and not the database ────────────────────
// This is a per-device convenience, not a fact about the client. Someone who
// picks "originals" on their laptop should not have their phone start pulling
// 30 MB files over mobile data because a server remembered. And a gallery link
// is often opened by more than one person — a graduate and their parents —
// under one passkey and no identity at all, so there is nowhere on the server
// this could correctly be stored.
//
// Every access is wrapped: Safari in private mode throws on localStorage rather
// than returning null, and a download button that throws is worse than one that
// forgets.

import { DEFAULT_DOWNLOAD_TIERS, type DownloadTier } from "./ladder";

const KEY = "scz_download_pref_v1";

export interface DownloadPreference {
  tier: DownloadTier;
  /** null = no standing answer; the sheet decides from the photo count. */
  asZip: boolean | null;
}

/**
 * Reads the stored preference, or null when there is none.
 *
 * The tier is checked against `allowed` by the caller rather than here, because
 * "this gallery no longer offers originals" is a fact about the gallery, and
 * preferredTier() already resolves it. This function's only job is to say what
 * was stored, honestly, including "nothing".
 */
export function readDownloadPreference(): DownloadPreference | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DownloadPreference>;
    const tier = parsed?.tier;
    if (tier !== "share" && tier !== "full" && tier !== "original") return null;
    return { tier, asZip: typeof parsed.asZip === "boolean" ? parsed.asZip : null };
  } catch {
    return null;
  }
}

export function writeDownloadPreference(pref: DownloadPreference): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    // Storage full, disabled, or a private window. The client simply gets
    // asked again next time, which is the old behaviour and not a failure.
  }
}

export function clearDownloadPreference(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}

/** The tier to start the sheet on when nothing has been remembered. */
export const FALLBACK_TIER: DownloadTier = DEFAULT_DOWNLOAD_TIERS.includes("full")
  ? "full"
  : DEFAULT_DOWNLOAD_TIERS[0];
