// The site root. Renders the About page — see the note in HomePage below.

import type { Metadata } from "next";
import { isLocale, type Locale } from "@/src/lib/i18n/config";
import { businessSchema, pageMetadata } from "@/src/lib/seo";
import LandingPage from "./landing/LandingPage";
import AboutPage from "./about/page";

// Localised per locale. A static `metadata` object cannot be, because it is
// evaluated once with no access to params — which is why /ru and /uz were
// both being described to searchers in English.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMetadata("home", locale as Locale);
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const schema = businessSchema(isLocale(locale) ? (locale as Locale) : "ru");

  // ./landing/LandingPage is a scroll-driven three.js piece, not wired up for
  // launch. Return it here instead to switch back.
  return (
    <>
      {/* The home page is where the business entity belongs: one copy, on the
          URL every other page points back to. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <AboutPage />
    </>
  );
}