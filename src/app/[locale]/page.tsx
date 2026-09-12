// The site root. Renders the About page — see the note in HomePage below.

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
  // ./landing/LandingPage is a scroll-driven three.js piece, not wired up for
  // launch. Return it here instead to switch back.
  return <AboutPage />;
}