// Type for the journal spread on /portfolio, and nothing else on the site:
// Cormorant Garamond for the headline, the quote and the photo captions, Jost
// for the running text. Both carry Cyrillic, so /ru reads in the same faces.
// next/font hosts the files with the site, so nothing is fetched from Google
// at runtime.

import { Cormorant_Garamond, Jost } from "next/font/google";

export const journalDisplay = Cormorant_Garamond({
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-journal-display",
  display: "swap",
});

export const journalText = Jost({
  weight: ["300", "400", "500"],
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-journal-text",
  display: "swap",
});
