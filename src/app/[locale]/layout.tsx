// src/app/[locale]/layout.tsx
//
// Wraps every localised page. Loads the dictionary on the SERVER and hands it
// to the client provider, so there's no loading flash and only the active
// language ships to the browser.
//
// This sits INSIDE the existing root layout (src/app/layout.tsx) — that one
// keeps <html>, <body>, fonts and BottomNav; this one only adds locale context.

import { notFound } from "next/navigation";
import { locales, isLocale, localeHreflang, type Locale } from "@/src/lib/i18n/config";
import { getDictionary } from "@/src/lib/i18n/dictionaries";
import { LanguageProvider } from "@/src/lib/i18n/LanguageProvider";
import BottomNav from "@/src/components/common/BottomNav";
import { NavLoadingProvider } from "@/src/lib/nav-loading";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Tells search engines the three versions are translations of each other rather
// than duplicate content — the main SEO payoff of URL-based locales.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const languages: Record<string, string> = {};
  for (const l of locales) languages[localeHreflang[l]] = `${SITE_URL}/${l}`;

  return {
    alternates: {
      canonical: `${SITE_URL}/${locale}`,
      languages,
    },
  };
}

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