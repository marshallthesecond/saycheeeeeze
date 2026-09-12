// TODO(marshall): THESE ARE PLACEHOLDERS. Replace with real quotes or set the
// array to [] before going live — the quotes block drops itself when empty.
// Invented testimonials are dishonest and easy to spot.
//
// Order matters: the homepage shows the first two.

export interface Testimonial {
  /** The quote itself — shorter and more specific is better than long praise. */
  quote: string;
  /** First name, or first name + last initial. Full names feel like ad copy. */
  name: string;
  /** What the shoot was, e.g. "Graduation, 2026". Adds credibility. */
  context: string;
}

export const testimonials: Testimonial[] = [
  {
    quote:
      "I hate being photographed and said so upfront. He worked around it instead of telling me to relax.",
    name: "Kamila",
    context: "Portrait, 2025",
  },
  {
    quote:
      "Forty-five minutes, and we still made it to dinner. Half my year group has asked me who shot them.",
    name: "Nilufar",
    context: "Graduation, 2026",
  },
  {
    quote:
      "Sent the edits two days early and every single one was usable. Our whole spring catalogue came from that afternoon.",
    name: "Timur",
    context: "Brand & product, 2026",
  },
];