// Site-wide SEO: the canonical URL, per-path hreflang, and the Russian and
// Uzbek copy the search results are actually built from.
//
// WHY THIS FILE EXISTS. Two things were wrong and both were invisible from the
// browser.
//
// 1. CANONICALS POINTED AT THE WRONG PAGE. `[locale]/layout.tsx` declared
//    `canonical: ${SITE_URL}/${locale}` and `languages` pointing at the three
//    locale ROOTS. A layout's metadata is inherited by every page beneath it,
//    so /ru/portfolio, /ru/book and every service page told Google "the real
//    version of me is the home page" — which is an instruction to drop them
//    from the index in favour of a page they are not. Alternates now live on
//    the pages, where the path is known, and the layout declares none.
//
// 2. THE METADATA WAS ENGLISH ON EVERY LOCALE. Service pages localised their
//    own titles (see generateMetadata there), but the home, portfolio, booking
//    and about pages shipped one English title and description to /ru and /uz
//    alike. A Russian search result with an English title is the same bug as
//    an English heading, except it happens before anyone has arrived — and it
//    weakens the language signal for the market this site is for.
//
// ORDER OF THE LANGUAGES IS DELIBERATE. Tashkent searches in Russian first,
// Uzbek second, English a distant third. `defaultLocale` is already `ru`;
// everything here follows it.

import { locales, localeHreflang, defaultLocale, type Locale } from "./i18n/config";

/** No trailing slash — every URL here is built by concatenation. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz"
).replace(/\/+$/, "");

/**
 * Canonical and hreflang for ONE path, in every language.
 *
 *   alternatesFor("ru", "/portfolio")
 *     canonical  https://…/ru/portfolio
 *     ru-UZ      https://…/ru/portfolio
 *     uz-UZ      https://…/uz/portfolio
 *     en         https://…/en/portfolio
 *     x-default  https://…/ru/portfolio
 *
 * `path` is the part AFTER the locale, with a leading slash or empty for the
 * locale's home page.
 *
 * x-default points at Russian rather than English. It is what a search engine
 * shows a visitor whose language matches none of the three, and for a
 * photographer working in Tashkent that visitor is far likelier to read
 * Russian than English. It is a choice, not a default — change this line if
 * the audience ever stops being local.
 */
export function alternatesFor(locale: Locale, path = "") {
  const languages: Record<string, string> = {};
  for (const l of locales) languages[localeHreflang[l]] = `${SITE_URL}/${l}${path}`;
  languages["x-default"] = `${SITE_URL}/${defaultLocale}${path}`;

  return {
    canonical: `${SITE_URL}/${locale}${path}`,
    languages,
  };
}

/**
 * The city, in the reader's language.
 *
 * ONE DEFINITION, because it is now needed in four places — the business
 * schema below, every service page's <title>, the Service/Offer schema on
 * those pages, and the image alt text. Three of those were about to spell it
 * out again inline, and a city that is "Ташкент" on the title and "Tashkent"
 * in the schema of the same page is a weaker signal than either on its own.
 */
export function cityName(locale: Locale): string {
  return locale === "ru" ? "Ташкент" : locale === "uz" ? "Toshkent" : "Tashkent";
}

/**
 * "<thing> в Ташкенте" — a page title with the place in it.
 *
 * Russian and Uzbek need a case the bare noun does not carry (`в Ташкенте`,
 * `Toshkentda`), and Uzbek puts the place FIRST, so this cannot be done by
 * concatenating `cityName()` onto a title. It is three sentence patterns, and
 * they are written out rather than assembled.
 *
 * Why titles need it at all: a service page's <title> was the service name and
 * nothing else — "Портретная съёмка · saycheeeeeze" — on a site whose entire
 * SEO problem is being found for "фотограф в Ташкенте". Every page built
 * through PAGE_COPY already carries the city; the service pages were localised
 * for language in an earlier pass and never for place.
 */
export function titleInCity(thing: string, locale: Locale): string {
  if (locale === "ru") return `${thing} в Ташкенте`;
  if (locale === "uz") return `Toshkentda ${lowerFirst(thing)}`;
  return `${thing} in Tashkent`;
}

/** "Portret suratga olish" -> "portret suratga olish", mid-sentence in Uzbek. */
function lowerFirst(s: string): string {
  return s ? s[0].toLocaleLowerCase("uz") + s.slice(1) : s;
}

/** A localised string, one per locale, with no fallback: all three are written. */
type Trio = Record<Locale, string>;

export interface PageCopy {
  title: Trio;
  description: Trio;
}

/**
 * THE SEARCH RESULT ITSELF.
 *
 * Titles are kept short because the root layout appends " · saycheeeeeze" and
 * Google truncates somewhere around sixty characters — a title that gets cut
 * loses whatever was at the end, which is where the keyword usually is. So the
 * keyword goes first.
 *
 * Descriptions are written to be read, not stuffed. Google rewrites a
 * description it finds unhelpful and ignores keyword density entirely; what it
 * does use is whether the text matches the query well enough that someone
 * clicks. Each one names what the thing is, where it happens, and what to do
 * next.
 */
export const PAGE_COPY: Record<"home" | "portfolio" | "book" | "about", PageCopy> = {
  home: {
    title: {
      ru: "Фотограф в Ташкенте — портреты и выпускные",
      uz: "Toshkentda fotograf — portret va bitiruv suratlari",
      en: "Photographer in Tashkent",
    },
    description: {
      ru: "Портретная, выпускная и модельная фотосъёмка в Ташкенте. Посмотрите работы, выберите пакет и забронируйте съёмку онлайн за пару минут.",
      uz: "Toshkentda portret, bitiruv va model suratga olish. Ishlarni ko'ring, paketni tanlang va suratga olishni onlayn bron qiling.",
      en: "Portrait, graduation and model-test photography in Tashkent. Browse the work, pick a package and book a session online.",
    },
  },
  portfolio: {
    title: {
      ru: "Портфолио — фотосъёмка в Ташкенте",
      uz: "Portfolio — Toshkentda suratga olish",
      en: "Portfolio — photography in Tashkent",
    },
    description: {
      ru: "Избранные работы: портреты, выпускные, модельные тесты и съёмка для брендов в Ташкенте.",
      uz: "Tanlangan ishlar: portretlar, bitiruv suratlari, model testlari va brendlar uchun suratga olish — Toshkentda.",
      en: "Selected work: portraits, graduation sessions, model tests and brand shoots in Tashkent.",
    },
  },
  book: {
    title: {
      ru: "Забронировать фотосессию в Ташкенте",
      uz: "Toshkentda fotosessiyani bron qilish",
      en: "Book a photo session in Tashkent",
    },
    description: {
      ru: "Выберите съёмку, дату и место — бронь занимает пару минут. Портреты, выпускные и мини-съёмки в Ташкенте.",
      uz: "Suratga olish turini, sanani va joyni tanlang — bron bir necha daqiqa. Toshkentda portret, bitiruv va mini-suratga olish.",
      en: "Pick a session, a date and a place — booking takes a couple of minutes. Portraits, graduation and mini-sessions in Tashkent.",
    },
  },
  about: {
    title: {
      ru: "Обо мне — фотограф в Ташкенте",
      uz: "Men haqimda — Toshkentda fotograf",
      en: "About — photographer in Tashkent",
    },
    description: {
      ru: "Шамшод, фотограф из Ташкента: портреты, выпускные, модельные тесты и съёмка для брендов. Как я работаю и что входит в съёмку.",
      uz: "Shamshod, Toshkentdan fotograf: portretlar, bitiruv suratlari, model testlari va brendlar uchun suratga olish.",
      en: "Shamshod, a photographer in Tashkent: portraits, graduation, model tests and brand work. How I shoot and what a session includes.",
    },
  },
};

/** Builds a page's Metadata title/description/OG/alternates in one call. */
export function pageMetadata(
  key: keyof typeof PAGE_COPY,
  locale: Locale,
  path = "",
) {
  const { title, description } = PAGE_COPY[key];
  return {
    title: title[locale],
    description: description[locale],
    alternates: alternatesFor(locale, path),
    openGraph: {
      title: `${title[locale]} · saycheeeeeze`,
      description: description[locale],
      url: `${SITE_URL}/${locale}${path}`,
      locale: locale === "ru" ? "ru_UZ" : locale === "uz" ? "uz_UZ" : "en_US",
    },
  };
}

/**
 * The business, as a machine-readable entity.
 *
 * This is what a local search has to connect "фотограф Ташкент" to. Without
 * it a search engine has a website; with it, it has a named business that
 * serves a named city, speaks three listed languages, and sells things at
 * stated prices.
 *
 * NO STREET ADDRESS ON PURPOSE. Sessions happen wherever the client wants —
 * campus, a park, a hired studio — so there is no premises to publish.
 * `areaServed` is the honest shape for that, and inventing an address to look
 * more local is the kind of thing that gets a listing suspended rather than
 * ranked.
 *
 * `sameAs` is doing more work than it looks: it is how the site, the Instagram
 * account and the Telegram account are understood to be one business rather
 * than three unrelated pages.
 */
export function businessSchema(locale: Locale) {
  const copy = PAGE_COPY.home.description[locale];
  return {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": `${SITE_URL}/#business`,
    name: "saycheeeeeze",
    alternateName: "Shamshod with a Camera",
    url: `${SITE_URL}/${locale}`,
    description: copy,
    image: `${SITE_URL}/apple-icon.png`,
    email: "hello@saycheeeeeze.uz",
    priceRange: "150000-900000 UZS",
    currenciesAccepted: "UZS",
    areaServed: {
      "@type": "City",
      name: cityName(locale),
      address: {
        "@type": "PostalAddress",
        addressLocality: cityName(locale),
        addressCountry: "UZ",
      },
    },
    // Declared so a Russian or Uzbek speaker searching in their own language
    // is matched to a business that answers in it.
    knowsLanguage: ["ru", "uz", "en"],
    sameAs: [
      "https://www.instagram.com/saycheeeeeze",
      "https://t.me/saycheeeeeze",
    ],
  };
}
