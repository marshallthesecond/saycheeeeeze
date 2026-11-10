// The photographer this site belongs to, in one place.
//
// Everything the Home and About pages say about the person — links, the year
// they started, what they shoot, which sessions to list — reads from here
// rather than being written into each page. When the site serves more than one
// photographer, this object becomes a row in a `profiles` table and these
// pages read that row instead; nothing else about them has to change.
//
// The words themselves (name, headline, labels) live in the dictionaries under
// `profile.*`, because they are translated.

export interface SocialLink {
  label: string;
  href: string;
}

export const PROFILE = {
  /** Shown as "Since 2022" and in the details list. */
  sinceYear: 2022,

  /**
   * The public account, for a first contact. The booking form's enquiry link
   * is a different, private account on purpose.
   */
  telegram: "https://t.me/saycheeeeeze",

  /** In display order. Add one and every row that shows them still fits on
   *  one line — see SocialLinks. */
  socials: [
    { label: "Instagram", href: "https://www.instagram.com/saycheeeeeze" },
    { label: "Telegram", href: "https://t.me/saycheeeeeze" },
    { label: "Kavyar", href: "https://kavyar.com/o6yaavonoqek" },
    { label: "Pixieset", href: "https://pixies.et/LTdEhFHc" },
  ] satisfies SocialLink[],

  /** Keys into `profile.tags.*`. */
  specialties: ["portraits", "graduation", "fashion"] as const,

  /** Service slugs for the "Sessions" lists, in order. Each must exist in
   *  services.ts; one that does not is skipped rather than linking to a 404. */
  sessions: ["portraits", "graduation", "models", "brand-product"] as const,
};
