import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // remotePatterns still matters even though almost nothing is optimised any
    // more: next/image validates the src against it whether or not it is going
    // to transform the file.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.b-cdn.net",
        pathname: "/**",
      },
    ],

    // ── Why Bunny photos bypass this entirely ────────────────
    //
    // Every image coming off Bunny is already exactly the size it should be —
    // the derivative ladder produced it that way at ingest. Sending it through
    // Next's optimiser means fetching a file that is already correct, decoding
    // it, re-encoding it, and serving it from a second cache one network hop
    // further away. On Vercel it is also billed per transform, which is the
    // per-image cost this whole migration exists to avoid.
    //
    // In development it was worse than wasteful: the optimiser was fetching
    // 30 MB+ originals and timing out at 7 s, so album pages returned 500s.
    //
    // This is NOT set globally, deliberately. `unoptimized: true` here would
    // also cover the local files in public/ — and img2.png is 39.6 MB. Next is
    // currently the only thing shrinking those, so they keep the optimiser
    // until they move to Bunny and go through the ladder like everything else.
    // Bunny-hosted images opt out individually at each call site instead.
  },
};

export default nextConfig;
