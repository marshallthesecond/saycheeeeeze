// src/app/[locale]/page.tsx — the landing page.
//
// A scroll-driven story: ten screens of copy passing over a 3D camera that
// assembles, fires, and comes apart as you scroll. The heavy part
// (three.js) loads client-side only; everything the crawler needs is plain
// server-rendered markup inside <LandingPage />.

import type { Metadata } from "next";
import LandingPage from "./landing/LandingPage";
import AboutPage from "./about/page";

export const metadata: Metadata = {
  title: "saycheeeeeze · Photography in Tashkent",
  description:
    "Marshall with a Camera — portraits, fashion, events and commercial photography in Tashkent. Book a session or browse the portfolio.",
  openGraph: {
    title: "saycheeeeeze · Photography in Tashkent",
    description:
      "Portraits, fashion, events and commercial photography in Tashkent.",
  },
};

export default function HomePage() {
  // The scroll-driven 3D landing lives in ./landing/LandingPage and is not
  // wired up for launch. To switch back: re-add the import and return it here.
  return <AboutPage />;
}