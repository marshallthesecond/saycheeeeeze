// Wraps every localised page. The dictionary is loaded on the server and
// handed to the client provider, so there is no loading flash and only the
// active language ships to the browser.
//
// Sits inside the root layout, which owns <html>, <body>, fonts and BottomNav.
// This one only adds locale context.

import { notFound } from "next/navigation";
import { locales, isLocale, type Locale } from "@/src/lib/i18n/config";
import { getDictionary } from "@/src/lib/i18n/dictionaries";
import { LanguageProvider } from "@/src/lib/i18n/LanguageProvider";
import BottomNav from "@/src/components/common/BottomNav";
import { NavLoadingProvider } from "@/src/lib/nav-loading";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/**
 * NO `alternates` HERE, and that is the fix rather than an omission.
 *
 * This layout wraps every page in the locale, and metadata declared in a
 * layout is inherited by all of them. It used to set
 * `canonical: <site>/<locale>` plus hreflang pointing at the three
 * locale ROOTS — so /ru/portfolio, /ru/book and every service page inherited
 * "the canonical version of this page is the home page", which is an
 * instruction to drop them from the index in favour of a page they are not.
 * The hreflang was wrong the same way: /ru/portfolio offered /uz and /en as
 * its translations rather than /uz/portfolio and /en/portfolio.
 *
 * A layout cannot know its children's paths, so alternates belong on the
 * pages. `alternatesFor()` in src/lib/seo.ts builds them from the locale and
 * the path; a page that forgets simply self-canonicalises, which is correct by
 * default — unlike inheriting someone else's URL.
 */

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = await getDictionary(locale as Locale);

  return (
    <LanguageProvider locale={locale as Locale} dict={dict}>
      <NavLoadingProvider>
        {children}
        <BottomNav />
      </NavLoadingProvider>
    </LanguageProvider>
  );
}