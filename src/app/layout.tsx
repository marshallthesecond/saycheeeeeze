import type { Metadata, Viewport } from "next";
import {
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Instrument_Serif,
  Playfair_Display,
} from "next/font/google";
import { ThemeProvider } from "@/src/components/theme-provider";
import "./globals.css";

// Three fonts, site-wide:
//   IBM Plex Sans    — body copy         (--font-sans)
//   Instrument Serif — display headings  (--font-serif)
//   IBM Plex Mono    — eyebrows / labels (--font-mono)
//
// Instrument Serif has no Cyrillic, so every display headline in /ru was
// falling back to a system serif. The root layout doesn't receive the locale,
// so instead of detecting it the two faces are stacked in globals.css: the
// browser uses Instrument Serif for Latin and falls through to the Cyrillic
// face for Cyrillic glyphs. No JS, no flash, no per-locale branching. Prata
// and Cormorant are the other candidates if you want a different pairing.
const plexSans = IBM_Plex_Sans({
  // 700 is what the About hero headline renders at; without it the browser
  // synthesises a fake bold and the display type looks smeared.
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-latin",
  subsets: ["latin"],
});

// Cyrillic only, so its metrics only have to agree with Instrument Serif
// closely enough that RU headlines don't look heavier. Check one at 44px
// before swapping the family.
const cyrillicSerif = Playfair_Display({
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-cyrillic",
  subsets: ["cyrillic"],
});

// NEXT_PUBLIC_SITE_URL is the production domain. metadataBase resolves
// relative OG image paths to absolute URLs, which social platforms require —
// without it, shared links show no preview image.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saycheeeeeze.uz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // Child pages set just their own name; this appends the brand.
    default: "saycheeeeeze · Photography in Tashkent",
    template: "%s · saycheeeeeze",
  },
  description:
    "Shamshod with a Camera — portrait, graduation and model-test photography in Tashkent. Book a session or browse the work.",
  applicationName: "saycheeeeeze",
  authors: [{ name: "saycheeeeeze" }],
  // Aimed at the work actually on offer, not weddings.
  keywords: [
    "photographer Tashkent", "portrait photographer Tashkent",
    "graduation photos Tashkent", "model test Tashkent",
    "фотограф Ташкент", "фотограф на выпускной Ташкент",
    "fotograf Toshkent", "bitiruv fotosessiya Toshkent",
  ],
  openGraph: {
    type: "website",
    siteName: "saycheeeeeze",
    // Follows defaultLocale: what a link preview announces itself as when
    // nothing more specific applies.
    locale: "ru_UZ",
    alternateLocale: ["en_US", "uz_UZ"],
    title: "saycheeeeeze · Photography in Tashkent",
    description: "Portraits, graduation and model tests in Tashkent.",
  },
  twitter: {
    card: "summary_large_image",
    title: "saycheeeeeze · Photography in Tashkent",
    description: "Portraits, graduation and model tests in Tashkent.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// viewportFit "cover" gives the site the full screen on notched phones and
// enables the env(safe-area-inset-*) values BottomNav needs to stay clear of
// the iOS home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // don't trap users who need to pinch-zoom
  viewportFit: "cover",
  // Cool near-black, matching --background: oklch(0.1854 0.0052 248.11). Must
  // track that token — a mismatch shows up as Android browser chrome in a
  // visibly different colour from the page.
  themeColor: "#111315",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // Hardcoded because this layout sits ABOVE [locale] and never receives
      // it. "ru" is the default locale, so it is right for most visitors and
      // wrong for /en and /uz. The real fix is to make [locale]/layout.tsx the
      // root layout — Next allows a root layout under a dynamic segment — and
      // read the locale from params here.
      lang="ru"
      className={`${plexSans.variable} ${plexMono.variable} ${instrumentSerif.variable} ${cyrillicSerif.variable} antialiased dark`}
      // next-themes writes style="color-scheme: dark" onto <html> from a
      // script that runs before React hydrates — which is the point, it's what
      // stops a light flash on first paint. React then finds an attribute the
      // server never rendered and logs a mismatch on every page load.
      //
      // suppressHydrationWarning is the documented fix and covers this
      // element's own attributes only; a real mismatch inside the tree is
      // still reported.
      suppressHydrationWarning
      // Tells Next the smooth scrolling in globals.css is deliberate.
      data-scroll-behavior="smooth"
    >
      <body className="bg-background">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}