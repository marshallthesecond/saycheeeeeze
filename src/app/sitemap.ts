// Served at /sitemap.xml. Every route exists three times — /en, /ru, /uz — so
// each entry carries `alternates.languages` to say the three are translations
// of one another. Without it Google treats them as duplicates and picks one,
// which is how a Russian search ends up on the English page.

import type { MetadataRoute } from "next";
import { getAllAlbumSlugs } from "@/src/lib/albums";
import { getAllServiceSlugs } from "@/src/lib/services";
import { locales, localeHreflang } from "@/src/lib/i18n/config";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz";

/** One sitemap entry per locale, each pointing at all the others. */
function localised(
  path: string,
  changeFrequency: "weekly" | "monthly",
  priority: number,
  lastModified: Date
): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[localeHreflang[l]] = `${SITE_URL}/${l}${path}`;

  return locales.map((locale) => ({
    url: `${SITE_URL}/${locale}${path}`,
    lastModified,
    changeFrequency,
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes = [
    ...localised("",           "weekly",  1,    now),
    ...localised("/portfolio", "weekly",  0.9,  now),
    ...localised("/book",      "monthly", 0.8,  now),
    ...localised("/about",     "monthly", 0.7,  now),
  ];

  const albumRoutes = (await getAllAlbumSlugs()).flatMap((slug) =>
    localised(`/albums/${slug}`, "monthly", 0.7, now)
  );

  const serviceRoutes = getAllServiceSlugs().flatMap((slug) =>
    localised(`/services/${slug}`, "monthly", 0.8, now)
  );

  return [...staticRoutes, ...albumRoutes, ...serviceRoutes];
}
