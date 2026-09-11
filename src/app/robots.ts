// src/app/robots.ts — served at /robots.txt

import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /home is the unfinished page gated behind NEXT_PUBLIC_SHOW_HOME.
      disallow: ["/api/", "/*/galleries/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

