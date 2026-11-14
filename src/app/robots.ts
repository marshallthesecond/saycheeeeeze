// Served at /robots.txt.

import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Client galleries are passkey-gated; keep them out of the index.
      // /studio is the photographers' side and has nothing for a crawler.
      disallow: ["/api/", "/*/galleries/", "/studio"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
