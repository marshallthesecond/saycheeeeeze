import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
