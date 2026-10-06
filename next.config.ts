import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  /**
   * Twelve service pages were removed on 2026-10-06. Their URLs were in the
   * sitemap, so they are in Google, and they may be in someone's messages.
   *
   * 308 to the nearest page that still exists rather than 404 — a permanent
   * redirect passes the ranking on instead of throwing it away, and a visitor
   * who clicks an old link lands on something they can actually book.
   *
   * Two rows each because the locale prefix is optional: middleware resolves a
   * bare /services/x from the cookie, and that path has to redirect too.
   *
   * Keep in step with RETIRED_SERVICES in src/lib/booking-catalog.ts, which
   * sends the PACKAGE IDS to the same four services.
   */
  async redirects() {
    return [
      /**
       * /mini — the link to put on OLX and in Telegram.
       *
       * `/book?service=mini-lokomotiv` already lands a visitor on step 2 with
       * the date pinned, the venue shown, the price shown and the slot grid
       * open, so no code was needed to make the mini-session one click away.
       * What was needed is a URL a person can retype, read off a story, or
       * paste into a bio — and one that does not carry next week's internal id
       * in it.
       *
       * TEMPORARY (307), AND THAT IS THE WHOLE POINT. A 308 is cached by the
       * browser and by Google, so the first visitor to follow a permanent
       * /mini would keep being sent to THIS event for ever — including after
       * the venue moved and the id changed. Every other row in this file is
       * permanent because a retired service page never comes back; this one
       * points at a moving target.
       *
       * No locale prefix, so the middleware resolves the visitor's own
       * language from the cookie rather than this file deciding for them.
       *
       * UPDATE THIS WHEN THE EVENT CHANGES — it is the one place outside
       * mini-sessions.ts that names the service id.
       */
      { source: "/mini", destination: "/book?service=mini-lokomotiv", permanent: false },
      { source: "/:locale(en|ru|uz)/mini", destination: "/:locale/book?service=mini-lokomotiv", permanent: false },

      { source: "/:locale(en|ru|uz)/services/individual-portraits", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/individual-portraits", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/pair-group", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/pair-group", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/family-portraits", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/family-portraits", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/business-portraits", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/business-portraits", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/photowalk-tashkent", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/photowalk-tashkent", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/newborn-maternity", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/newborn-maternity", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/uzb-national", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/uzb-national", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/creative-photography", destination: "/:locale/services/portraits", permanent: true },
      { source: "/services/creative-photography", destination: "/services/portraits", permanent: true },
      { source: "/:locale(en|ru|uz)/services/social-media-content", destination: "/:locale/services/brand-product", permanent: true },
      { source: "/services/social-media-content", destination: "/services/brand-product", permanent: true },
      { source: "/:locale(en|ru|uz)/services/fashion-streetstyle", destination: "/:locale/services/brand-product", permanent: true },
      { source: "/services/fashion-streetstyle", destination: "/services/brand-product", permanent: true },
      { source: "/:locale(en|ru|uz)/services/wedding-love-story", destination: "/:locale/book", permanent: true },
      { source: "/services/wedding-love-story", destination: "/book", permanent: true },
      { source: "/:locale(en|ru|uz)/services/events-corporate", destination: "/:locale/book", permanent: true },
      { source: "/services/events-corporate", destination: "/book", permanent: true },
    ];
  },
  images: {
    // Still needed even though almost nothing is optimised any more:
    // next/image validates the src against this whether or not it is going to
    // transform the file.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.b-cdn.net",
        pathname: "/**",
      },
    ],

    // Bunny-hosted images opt out of the optimiser individually, at each call
    // site, rather than globally here.
    //
    // They bypass it because the ladder already produced them at exactly the
    // right size: sending one through means fetching a correct file, decoding
    // it, re-encoding it and serving it from a second cache one hop further
    // away — billed per transform on Vercel, which is the cost the ladder
    // exists to avoid. In development it was worse, fetching 30 MB originals
    // and timing out at 7 s, so album pages returned 500s.
    //
    // `unoptimized: true` here would also cover the local files in public/,
    // some of which are tens of megabytes. Next is the only thing shrinking
    // those, so they keep the optimiser until they move to Bunny.
  },
};

export default nextConfig;
