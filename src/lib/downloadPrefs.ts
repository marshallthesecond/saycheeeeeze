// What the client last chose in the download sheet, per browser.
//
// localStorage rather than the database: a laptop choosing "originals" must
// not make the phone pull 30 MB over mobile data, and one gallery link is
// often opened by several people under one passkey with no identity at all.
//
// Every access is wrapped — Safari in private mode throws rather than
// returning null.

import { DEFAULT_DOWNLOAD_TIERS, type DownloadTier } from "./ladder";

const KEY = "scz_download_pref_v1";

export interface DownloadPreference {
  tier: DownloadTier;
  /** null = no standing answer; the sheet decides from the photo count. */
  asZip: boolean | null;
}

/**
 * The stored preference, or null when there is none.
 *
 * Whether the tier is still on offer is the caller's business — see
 * preferredTier(). This only reports what was stored.
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
    // Storage full, disabled, or a private window. The client gets asked
    // again next time, which is the old behaviour.
  }
}

export function clearDownloadPreference(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}

/** Where the sheet starts when nothing has been remembered. */
export const FALLBACK_TIER: DownloadTier = DEFAULT_DOWNLOAD_TIERS.includes("full")
  ? "full"
  : DEFAULT_DOWNLOAD_TIERS[0];
