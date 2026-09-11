// src/lib/testimonials.ts
//
// Social proof. Someone deciding whether to book has nothing else to go on —
// no reviews, no client names, no sense of what working together is like. Even
// a handful of short, specific quotes changes that more than any amount of
// design polish.
//
// The homepage (scene 6, "Who's behind the camera") shows the FIRST TWO, so the
// order matters: put the two that speak to portrait, graduation and model
// clients at the top. The rest are still used by the service pages.
//
// REPLACE THESE PLACEHOLDERS with real quotes before going live. Fabricated
// testimonials are both dishonest and easy to spot. If you don't have any yet,
// message three recent clients and ask — most will say yes, and it takes them
// two minutes. Until then, set `testimonials` to an empty array: scene 6 drops
// the quotes block on its own and the layout still holds.
//
// What makes a quote worth keeping: a specific detail, an admission, or a
// number. "Great photos, highly recommend" proves nothing.

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