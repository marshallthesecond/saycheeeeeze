// Shown while the server component fetches the image list. A shaped skeleton
// reads as "loading"; a blank screen reads as "broken".

import { NavLoadingBeacon } from "@/src/lib/nav-loading";

export default function PortfolioLoading() {
  return (
    <div className="min-h-screen bg-background text-white overflow-x-clip">
      {/* Runs the bottom-nav glow while this fallback is mounted. */}
      <NavLoadingBeacon />

      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-95 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(252,169,66,0.28) 0%, rgba(252,169,66,0.09) 45%, rgba(14,12,9,0) 100%)",
        }}
      />

      <section
        className="relative z-10 px-4 sm:px-8 pb-6"
        style={{ paddingTop: "calc(5rem + env(safe-area-inset-top))" }}
      >
        <div className="h-3 w-40 rounded bg-white/15 animate-pulse" />
        <div className="h-12 w-56 rounded-lg bg-white/15 animate-pulse mt-3" />
        <div className="h-4 w-full max-w-sm rounded bg-white/10 animate-pulse mt-4" />
      </section>

      {/* Filter pill placeholders */}
      <section className="relative z-10 px-4 sm:px-8 pb-4 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-9 w-20 rounded-full bg-white/[0.07] animate-pulse" />
        ))}
      </section>

      {/* Photo grid placeholder — 3 columns, matching PhotoGrid on mobile */}
      <section className="relative z-10 pb-10">
        <div className="[column-count:3] sm:[column-count:3] lg:[column-count:4] xl:[column-count:5] gap-0.5">
          {Array.from({ length: 18 }).map((_, i) => (
            <div
              key={i}
              className="w-full bg-white/6 animate-pulse mb-0.5"
              // Varied heights so it reads as a photo grid, not a table
              style={{ height: [120, 170, 140, 200, 150][i % 5] }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}