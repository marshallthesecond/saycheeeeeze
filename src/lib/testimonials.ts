// Client quotes for the About page's "Kind words" card.
//
// EMPTY ON PURPOSE (2026-11-10). The three quotes that were here were
// placeholders written for the design — invented clients presented as real
// reviews. They were live on the old About page; the rebuilt page renders the
// card only when this list has entries, so it stays hidden until it holds
// real quotes from real clients who agreed to be quoted.
//
// Add one like this:
//   { quote: "…their words…", name: "Kamila", context: "Portrait, 2026" },
//
// Order matters: the first ones show first.

export interface Testimonial {
  /** The quote itself — shorter and more specific is better than long praise. */
  quote: string;
  /** First name, or first name + last initial. Full names feel like ad copy. */
  name: string;
  /** What the shoot was, e.g. "Graduation, 2026". Adds credibility. */
  context: string;
}

export const testimonials: Testimonial[] = [];
