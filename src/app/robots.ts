// Served at /robots.txt.

import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Client galleries are passkey-gated; keep them out of the index.
      disallow: ["/api/", "/*/galleries/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

