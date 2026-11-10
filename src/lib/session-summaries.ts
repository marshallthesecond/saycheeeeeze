// One line per session type for the "Sessions" lists on Home and About:
// localised title, the cheapest price actually on offer, and a photograph.
//
// Built on the server so services.ts (70 KB of copy in three languages) stays
// out of the browser bundle for pages that only need four titles and prices.

import type { AlbumPhoto } from "@/src/lib/albums";
import type { Locale } from "@/src/lib/i18n/config";
import { formatSom } from "@/src/lib/packages";
import { PROFILE } from "@/src/lib/profile";
import { entryPackage, getServiceBySlug, pickLocale } from "@/src/lib/services";

export interface SessionSummary {
  slug: string;
  title: string;
  /** "250 000 so'm", already formatted for the locale; null when nothing is on offer. */
  fromPrice: string | null;
  photo?: AlbumPhoto;
}

/**
 * @param photoFor storage path → photo, for the thumbnail. Optional: a session
 *                 with no resolved photograph simply shows none.
 */
export function sessionSummaries(
  locale: Locale,
  photoFor: (slug: string) => AlbumPhoto | undefined = () => undefined,
): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (const slug of PROFILE.sessions) {
    const service = getServiceBySlug(slug);
    if (!service) continue;
    const entry = entryPackage(service);
    out.push({
      slug,
      title: pickLocale(service.title, locale),
      fromPrice: entry ? formatSom(entry.priceUzs, locale) : null,
      photo: photoFor(slug),
    });
  }
  return out;
}
