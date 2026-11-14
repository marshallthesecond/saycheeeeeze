// The Studio: the photographer's side of the site, at /studio.
//
// It sits beside /[locale]/, not inside it, for two reasons. The locale layout
// adds the public bottom navigation to everything under it, and the Studio
// has its own. And a signed-in tool does not need its language in the
// address: it reads the same NEXT_LOCALE cookie the public site writes.
//
// This layout only supplies the words. It does NOT check who is signed in,
// because the sign-in page lives under it. The check is in (panel)/layout.tsx
// and in every page, through requireStudio().

import type { Metadata } from "next";
import { LanguageProvider } from "@/src/lib/i18n/LanguageProvider";
import type { Dictionary } from "@/src/lib/i18n/dictionaries";
import { getStudioDictionary } from "@/src/lib/studio/i18n";
import { getStudioLocale } from "@/src/lib/studio/locale";

export const metadata: Metadata = {
  title: { default: "Studio", template: "%s · Studio" },
  // Private pages. robots.ts also disallows /studio; this covers a crawler
  // that reaches a page anyway.
  robots: { index: false, follow: false },
};

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const locale = await getStudioLocale();
  const dict = await getStudioDictionary(locale);

  return (
    // The site's provider with the Studio's dictionary. The provider only
    // walks key paths and does not care which dictionary it holds; the cast
    // says so to TypeScript, which types the prop as the site's.
    <LanguageProvider locale={locale} dict={dict as unknown as Dictionary}>
      {children}
    </LanguageProvider>
  );
}
