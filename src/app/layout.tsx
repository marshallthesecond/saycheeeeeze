import type { Metadata, Viewport } from "next";
import {
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Instrument_Serif,
  Playfair_Display,
} from "next/font/google";
import { ThemeProvider } from "@/src/components/theme-provider";
import "./globals.css";

// The three-font system, used site-wide:
//   IBM Plex Sans    — body copy         (--font-sans)
//   Instrument Serif — display headings  (--font-serif)
//   IBM Plex Mono    — eyebrows / labels (--font-mono)
//
// Instrument Serif has no Cyrillic. Russian is the primary audience, so every
// display headline in /ru was falling back to a system serif. Rather than
// detect the locale (the root layout doesn't receive it) the two faces are
// stacked in globals.css: the browser uses Instrument Serif for Latin and
// automatically falls through to the Cyrillic face for Cyrillic glyphs. No JS,
// no flash, no per-locale branching. Swap the Cyrillic family here if you want
// a different pairing — Prata and Cormorant are the other candidates.
const plexSans = IBM_Plex_Sans({
  // 700 is what the redesigned About hero headline renders at — without it the
  // browser synthesises a fake bold and the display type looks smeared.
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

// Cyrillic only — it never renders a Latin glyph, so its metrics only have to
// agree with Instrument Serif closely enough that RU headlines don't look
// heavier. Check a RU headline at 44px before shipping.
const cyrillicSerif = Playfair_Display({
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-cyrillic",
  subsets: ["cyrillic"],
});

// Set NEXT_PUBLIC_SITE_URL to your production domain (e.g. https://saycheeeeeze.uz).
// metadataBase makes relative OG image paths resolve to absolute URLs, which
// social platforms require — without it, shared links show no preview image.
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
  // Aimed at the work actually on offer. The old list pushed wedding
  // photography, which isn't what the homepage argues for.
  keywords: [
    "photographer Tashkent", "portrait photographer Tashkent",
    "graduation photos Tashkent", "model test Tashkent",
    "фотограф Ташкент", "фотограф на выпускной Ташкент",
    "fotograf Toshkent", "bitiruv fotosessiya Toshkent",
  ],
  openGraph: {
    type: "website",
    siteName: "saycheeeeeze",
    // Follows defaultLocale. This is what a link preview announces itself as
    // when nothing more specific applies, and it said en_US while the site's
    // default became Russian.
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

// viewportFit: "cover" lets the site use the full screen on notched phones,
// and enables the env(safe-area-inset-*) values BottomNav relies on so the
// nav never sits under the iOS home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // don't trap users who need to pinch-zoom
  viewportFit: "cover",
  // Cool near-black, matching --background: oklch(0.1854 0.0052 248.11).
  // The old #0e0c09 was a warm brown left over from an earlier palette, so on
  // Android the browser chrome was visibly a different colour from the page.
  themeColor: "#111315",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${instrumentSerif.variable} ${cyrillicSerif.variable} antialiased dark`}
      // next-themes writes style="color-scheme: dark" onto <html> from a script
      // that runs BEFORE React hydrates — that is the whole point, since it is
      // what stops a light flash on first paint. React then finds an attribute
      // the server never rendered and logs a hydration mismatch on every single
      // page load.
      //
      // suppressHydrationWarning is the documented fix, and it applies to this
      // element's own attributes only — a genuine mismatch anywhere inside the
      // tree is still reported. Worth doing for its own sake: this warning has
      // been the loudest thing in the console all through the migration, and
      // noise that is always present is noise nobody reads.
      suppressHydrationWarning
      // Tells Next the smooth scrolling in globals.css is deliberate, so it
      // stops warning about route transitions.
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