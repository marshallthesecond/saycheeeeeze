/**
 * A string written once, or once per language. A bare string means "the same
 * everywhere", so fields convert one at a time. `en` is required because it is
 * the fallback — a missing translation renders English, never nothing.
 */
export type Localized = string | ({ en: string } & Partial<Record<'ru' | 'uz', string>>);

/**
 * Two plain functions rather than one with overloads. The overloaded version
 * type-checks and then fails to BUILD — Turbopack cannot see an export whose
 * only body sits below two type-only signatures. Do not "tidy" these into one.
 */
/** Every package a service sells, grouped or flat, in display order. */
export function allPackages(service: ServiceData): ServicePackage[] {
  if (service.packageGroups?.length) return service.packageGroups.flatMap((g) => g.packages);
  return service.packages ?? [];
}

/** The one to quote a "from" price against — the cheapest thing on offer. */
export function entryPackage(service: ServiceData): ServicePackage | undefined {
  const all = allPackages(service);
  if (all.length === 0) return undefined;
  return all.reduce((cheapest, p) => (p.priceUzs < cheapest.priceUzs ? p : cheapest));
}

/**
 * Finds one bookable package by its id, across every service.
 *
 * This is what makes a package on a service page the same object the booking
 * form and the API route resolve — the fix for the two systems that used to
 * quote different prices for the same click.
 */
export function findServicePackage(
  id: string,
): { service: ServiceData; pkg: ServicePackage } | undefined {
  for (const service of servicesData) {
    const pkg = allPackages(service).find((p) => p.id === id);
    if (pkg) return { service, pkg };
  }
  return undefined;
}

export function pickLocale(value: Localized, locale: string): string {
  if (typeof value === 'string') return value;
  const key = locale as 'ru' | 'uz';
  return value[key] ?? value.en;
}

/** The same, for fields that may be absent. */
export function pickLocaleOpt(
  value: Localized | undefined,
  locale: string,
): string | undefined {
  return value === undefined ? undefined : pickLocale(value, locale);
}

/**
 * How many finished frames. Numbers rather than a sentence, so it renders in
 * whichever language is being read. `max` omitted means "and up".
 */
export interface PhotoCount {
  min: number;
  max?: number;
  /** Portrait services count portraits, not photos. Defaults to photos. */
  of?: 'photos' | 'portraits';
}

/** When the set arrives, for the same reason PhotoCount exists. */
export interface DeliverySpec {
  /** Working days until the full set. */
  days: number;
  /** A few finished frames the same evening, ahead of the full set. */
  sameDayPreview?: boolean;
}

export interface ServicePackage {
  /**
   * Stable id, and the id the booking form and the server use for this exact
   * package. Optional: a package without one is marketing only, and its service
   * falls back to the four generic session packages in packages.ts.
   *
   * NEVER reuse or renumber one. It is written into `bookings` rows, so a
   * recycled id silently relabels somebody's past booking.
   */
  id?: string;
  /**
   * Overrides the rendered length, for the packages where the WORD is the
   * point: "Full day" says something "10 hours" does not.
   *
   * Normally absent. The old field was a hand-written English copy of
   * durationMinutes that appeared beside it on every package — free to drift,
   * impossible to translate, and the reason a Russian reader saw "1 hour" in
   * the middle of a Russian price list. formatDuration() renders it now.
   */
  duration?: Localized;
  /**
   * The same length as a number, for the calendar.
   *
   * The booking form has to know how long a session blocks out to work out the
   * last legal start time of the day. Deriving it by parsing "2.5 hours" would
   * put a regex between a client and a valid time slot; this is the length,
   * stated once.
   */
  durationMinutes: number;
  photos: PhotoCount;
  delivery: DeliverySpec;
  /**
   * Price in so'm, as a number. formatSom() handles display and the currency
   * word per locale, and the server can verify a booking against it — none of
   * which a display string could do.
   */
  priceUzs: number;
  highlight?: boolean;
  /**
   * Extra lines shown when the package is opened.
   *
   * Anything the duration and photo count do not already say — printed photos,
   * a second location, a same-evening preview. These are what a package is
   * tiered ON: things a client can perceive and choose between, as opposed to
   * which camera body was used, which they cannot.
   */
  perks?: Localized[];
  /** A short qualifier after the duration — "group session", "up to 5". */
  note?: Localized;
  /**
   * Ask how many people are coming, and record it.
   *
   * NOT a pricing input — the group session is one price whatever the head
   * count, which is the whole reason it stopped dividing by four. This is so a
   * shoot for six is not planned as a shoot for two.
   */
  asksPeople?: { min: number; max: number };
  /**
   * A fixed head count this package is priced for, when it genuinely has one.
   *
   * Graduation does NOT use it: a group turns up as two, three or five, and
   * dividing by a hardcoded four printed a per-person figure that would be
   * wrong for most of them. Left in the type for a service that really does
   * sell a fixed-size session.
   */
  groupSize?: number;
}

/**
 * For a service selling more than one KIND of thing. Graduation is two
 * products under one name — a session you schedule, and coverage on the day —
 * kept on one page because a visitor does not yet know which they want.
 *
 * Unset and `packages` renders as before.
 */
export interface ServicePackageGroup {
  key: string;
  title: Localized;
  blurb: Localized;
  /**
   * The locations this kind of session actually happens in, in order — the
   * first is preselected.
   *
   * A campus gown session happens on campus, optionally with a studio. Offering
   * the ceremony venue there was the form asking a question the client's own
   * choice had already answered, and answering it wrongly. The full list is
   * still one tap away behind "somewhere else".
   */
  locationIds?: string[];
  packages: ServicePackage[];
}

/** The same, after pickLocale() has run — what the client components receive. */
export interface ResolvedPackage
  extends Omit<ServicePackage, 'perks' | 'note' | 'duration' | 'photos' | 'delivery'> {
  /** Rendered from durationMinutes (or the override) in the page's locale. */
  duration: string;
  photos: string;
  delivery: string;
  perks?: string[];
  note?: string;
}

export interface ResolvedPackageGroup {
  key: string;
  title: string;
  blurb: string;
  locationIds?: string[];
  packages: ResolvedPackage[];
}

/** A dated event the client is buying FOR. Drives the countdown and the copy. */
export interface ServiceEvent {
  /** ISO date, "2026-11-21". Edit this once a year; nothing else changes. */
  date: string;
  label: Localized;
  venue?: Localized;
  /** Anything a client would be glad you knew — slot times, registration cut-offs. */
  note?: Localized;
  /**
   * Sessions you will take around the date, and how many are gone.
   *
   * Real numbers only. Scarcity is the strongest lever on a page like this
   * precisely because it is true here — one ceremony, one day, one of you. The
   * moment it is decoration it stops working, and in a cohort where everyone
   * knows everyone it gets found out.
   */
  capacity?: number;
  booked?: number;
}

/**
 * Copy for one audience, behind a toggle. Same offers, same prices, same order
 * — only the wording changes ("At campus" → "At WIUT"). Anything omitted keeps
 * the default, so a variant can be one group title.
 */
export interface ServiceAudience {
  /** The switch's label — a question, because the visitor answers it. */
  prompt: Localized;
  /**
   * Bunny STORAGE PATH for the photograph behind the switch — the place this
   * audience recognises on sight. There is no explanatory line under the label
   * any more: a band that visibly lights up when you tap it is the receipt, and
   * a sentence telling you what just happened to a page you are looking at was
   * reading homework for a control that had already answered itself.
   *
   * Resolved through the derivative ladder like every other photograph and
   * CAPPED at the grid rungs — see AUDIENCE_BACKDROP_MAX in the page. A path
   * with no ladder row renders no image at all rather than falling back to the
   * original, which for these files is a multi-megabyte PNG sitting behind one
   * line of text.
   */
  backdropPath?: string;
  eyebrow?: Localized;
  description?: Localized;
  /** Keyed by ServicePackageGroup.key. */
  groups?: Record<string, { title?: Localized; blurb?: Localized }>;
}

/** The same, after pickLocale() has run. */
export interface ResolvedAudience {
  prompt: string;
  eyebrow?: string;
  description?: string;
  groups?: Record<string, { title?: string; blurb?: string }>;
}

/** A short highlighted block: honest positioning, or a seasonal notice. */
export interface ServiceNotice {
  title: Localized;
  body: Localized;
}

export interface ServiceProofQuote {
  /** A person's name is not translated. It is their name. */
  name: string;
  /** "BSc Business Management, 2025" — placing the person makes the quote real. */
  detail?: Localized;
  quote: Localized;
}

export interface ServiceFAQ {
  question: Localized;
  answer: Localized;
}

/** A ServiceFAQ after pickLocale() — FAQList and the JSON-LD both want strings. */
export interface ResolvedFAQ {
  question: string;
  answer: string;
}

export interface ServiceData {
  slug: string;
  category: 'commercial' | 'moments' | 'fashion';
  /**
   * Localized, not plain strings: a translated shell around English content
   * looks like a finished translation and is worse than an English page.
   * Graduation is done; the other fifteen convert one at a time.
   */
  title: Localized;
  tagline: Localized;
  description: Localized;
  iconName: string;
  /**
   * Bunny STORAGE PATH, not a URL and not a local file.
   *
   * These were files in public/ — img1.png through img5.JPG, up to 39.6 MB
   * each, shared between sixteen services and resized by Next on every cold
   * request. As paths they go through the same derivative ladder as every
   * other photograph, and the resolver turns them into URLs at render time.
   */
  coverPath: string;
  /**
   * Where the example rail's photographs come from. Without it every service
   * showed the same eight portfolio images.
   *
   * `galleryPaths` wins and keeps its order, for a page curated frame by frame.
   * `galleryCategory` is the cheap version: one top-level Bunny folder. Neither
   * set falls back to an even spread of the portfolio.
   */
  galleryPaths?: string[];
  galleryCategory?: string;
  /**
   * Search terms specific to THIS service, in the languages the search happens
   * in. The root layout already carries the site-wide set; this is the page's
   * own. For graduation that means English, Russian and Uzbek — the student
   * searches in one, the parent paying for it often searches in another.
   */
  keywords?: string[];
  /**
   * Replaces the photo hero with a drawn one.
   *
   * For a service with no representative photographs yet — a stand-in frame of
   * something else says "photography" and nothing about WHICH kind. Remove this
   * once there is real work to lead with; `coverPath` is still used for the
   * social preview image either way.
   */
  hero?: {
    graphic: 'mortarboard';
    /** Overrides the category line. "GRADUATION · TASHKENT" beats "moments". */
    eyebrow?: Localized;
  };
  includes: Localized[];
  howToPrepare: Localized[];
  /**
   * The flat list, for services that sell one kind of thing.
   *
   * Optional now: a service with `packageGroups` would otherwise have to
   * duplicate its first group here, and a hand-copied duplicate of a price list
   * is a price list that will eventually disagree with itself. Read it through
   * entryPackage() rather than directly.
   */
  packages?: ServicePackage[];
  /** When set, replaces `packages` entirely. See ServicePackageGroup. */
  packageGroups?: ServicePackageGroup[];
  event?: ServiceEvent;
  audience?: ServiceAudience;
  notice?: ServiceNotice;
  proof?: ServiceProofQuote[];
  faqs: ServiceFAQ[];
  accentColor: string;
}

export const servicesData: ServiceData[] = [
  // COMMERCIAL
  {
    slug: 'brand-product',
    category: 'commercial',
    title: 'Brand & Product Photography',
    tagline: 'Make your product impossible to scroll past.',
    description:
      'Clean, intentional images that put your product front and center. Whether you need e-commerce flats, lifestyle context shots, or a full brand campaign, we build a visual story around what you sell.',
    iconName: 'Camera',
    coverPath: 'Random/espressomachine.jpg',
    galleryCategory: 'Random',
    includes: [
      'Full pre-shoot mood board & concept call',
      'Professional lighting setup (studio or on-location)',
      'Up to 3 product variations per session',
      'High-resolution exports optimised for web and print',
    ],
    howToPrepare: [
      'Bring products clean and polished — no fingerprints or dust',
      'Have a rough idea of where the images will be used (Instagram, website, ads)',
      'Share any reference images or brand guidelines beforehand',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 15, max: 25 },   delivery: { days: 1 },  priceUzs: 150000 },
      { durationMinutes: 180, photos: { min: 40, max: 60 },   delivery: { days: 2 }, priceUzs: 350000, highlight: true },
      { durationMinutes: 360, photos: { min: 80, max: 120 },  delivery: { days: 3 }, priceUzs: 600000 },
    ],
    faqs: [
      { question: 'Can I bring multiple products?', answer: 'Yes — up to 3 variations are included. Additional products can be added for a small fee.' },
      { question: 'Do you offer video too?', answer: 'Short Reels-style clips can be added to any package. Ask about pricing when booking.' },
      { question: 'What if I need a specific aesthetic?', answer: 'Share your references and I will replicate the lighting style and colour palette.' },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'business-portraits',
    category: 'commercial',
    title: 'Business Portraits',
    tagline: 'A great headshot opens doors before you say a word.',
    description:
      'Professional portraits for LinkedIn profiles, company websites, speaker bios, and press kits. The focus is a confident, approachable image that represents you and your brand honestly.',
    iconName: 'User',
    coverPath: 'Portraits/Radmir/3M0A0675.png',
    galleryCategory: 'Portraits',
    includes: [
      'Wardrobe and posing guidance before the shoot',
      'Multiple background options (solid, textured, or environmental)',
      'Expression coaching during the session',
      'Retouching: skin smoothing, background cleanup, colour grading',
    ],
    howToPrepare: [
      "Bring 2–3 outfit options — solid colours work best on camera",
      "Get a good night's sleep and stay hydrated the day before",
      'Avoid heavy patterns or logos that distract from your face',
    ],
    packages: [
      { durationMinutes: 30,  photos: { min: 5, max: 10, of: 'portraits' },  delivery: { days: 1 },  priceUzs: 80000 },
      { durationMinutes: 60,  photos: { min: 15, max: 25, of: 'portraits' }, delivery: { days: 1 },  priceUzs: 140000, highlight: true },
      { durationMinutes: 120, photos: { min: 30, max: 50, of: 'portraits' }, delivery: { days: 2 }, priceUzs: 240000 },
    ],
    faqs: [
      { question: 'Can I bring a colleague for a joint portrait?', answer: 'Absolutely. Group rates are available — mention this when booking.' },
      { question: 'Where is the shoot?', answer: 'My studio or an outdoor location in Tashkent — your choice.' },
      { question: "What if I'm not photogenic?", answer: "That's what posing guidance is for. Most clients feel completely natural after the first 10 minutes." },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'social-media-content',
    category: 'commercial',
    title: 'Social Media Content',
    tagline: 'A month of content in one afternoon.',
    description:
      'Batch content creation for Instagram, Telegram, TikTok, or whatever platform you publish on. We plan the shoot around your calendar, captions, and aesthetic so everything is ready to post.',
    iconName: 'CalendarDays',
    coverPath: 'Random/capp.jpg',
    galleryCategory: 'Random',
    includes: [
      'Content plan & shot list created together before the day',
      'Mix of flat-lays, lifestyle, and portrait shots',
      'Vertical and square crops for Stories and Feed',
      'Colour-consistent editing across all images',
    ],
    howToPrepare: [
      'Write down 5–10 topics or products you want to cover this month',
      'Bring props, packaging, or anything that tells your brand story',
      'Wear outfits that match your brand palette',
    ],
    packages: [
      { durationMinutes: 120, photos: { min: 20, max: 30 },   delivery: { days: 2 }, priceUzs: 200000 },
      { durationMinutes: 240, photos: { min: 50, max: 70 },   delivery: { days: 3 }, priceUzs: 380000, highlight: true },
      { durationMinutes: 480, photos: { min: 100, max: 140 }, delivery: { days: 5 }, priceUzs: 650000 },
    ],
    faqs: [
      { question: 'Can you help me with the content plan?', answer: 'Yes — a short planning call is included in every package.' },
      { question: 'Do you deliver vertical and horizontal versions?', answer: 'Yes, crops for Stories (9:16), Feed (1:1), and landscape (4:3) are all included.' },
      { question: 'How far in advance should I book?', answer: 'At least 5–7 days ahead so we have time for the planning call.' },
    ],
    accentColor: '#c8b400',
  },

  // MOMENTS
  {
    slug: 'wedding-love-story',
    category: 'moments',
    title: 'Weddings & Love Stories',
    tagline: 'The day goes fast. The photos stay forever.',
    description:
      'Documentary-style wedding coverage that captures real emotion — not just posed shots. From the morning getting-ready chaos to the last dance, I stay in the background and let the story unfold naturally.',
    iconName: 'Camera',
    coverPath: 'Portraits/Sara/3M0A1333.png',
    includes: [
      'Pre-wedding location scouting or engagement session',
      'Full-day coverage (up to 10 hours)',
      'Two shooting angles during the ceremony',
      'Online gallery with download access for 1 year',
    ],
    howToPrepare: [
      'Share your timeline at least 2 weeks before the date',
      'Create a short list of must-have shots (family groupings, details)',
      'Assign a point-of-contact on the day to help coordinate family shots',
    ],
    packages: [
      { durationMinutes: 240,  photos: { min: 100, max: 150 }, delivery: { days: 7 },  priceUzs: 500000 },
      { durationMinutes: 480,  photos: { min: 250, max: 350 }, delivery: { days: 10 }, priceUzs: 900000, highlight: true },
      { duration: { en: 'Full day', ru: 'Полный день', uz: 'To‘liq kun' }, durationMinutes: 600, photos: { min: 400 },    delivery: { days: 14 }, priceUzs: 1500000 },
    ],
    faqs: [
      { question: 'Do you travel outside Tashkent?', answer: 'Yes. Travel costs are added to the package — ask for a quote.' },
      { question: 'Can we add an engagement shoot?', answer: 'Yes, and I recommend it — it helps you relax in front of the camera before the big day.' },
      { question: 'What happens if it rains?', answer: 'We adapt. Rain photos are often the most memorable.' },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'family-portraits',
    category: 'moments',
    title: 'Family Portraits',
    tagline: 'Everyone in the same frame. Finally.',
    description:
      'Relaxed, natural family portraits that capture who you actually are right now — not a stiff lineup. Kids welcome, chaos included.',
    iconName: 'Users',
    coverPath: 'Portraits/Radmir/3M0A0568.png',
    includes: [
      'Location consultation (park, home, studio)',
      'Gentle direction for natural, un-posed moments',
      'Individual and group compositions',
      'Child-friendly pacing — no rushing',
    ],
    howToPrepare: [
      'Dress in coordinating (not matching) colours — avoid logos',
      'Schedule the shoot around nap times for young children',
      'Bring a snack or small toy if you have toddlers',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 20, max: 30 },  delivery: { days: 2 }, priceUzs: 150000 },
      { durationMinutes: 120, photos: { min: 40, max: 60 },  delivery: { days: 3 }, priceUzs: 260000, highlight: true },
      { durationMinutes: 180, photos: { min: 70, max: 100 }, delivery: { days: 4 }, priceUzs: 380000 },
    ],
    faqs: [
      { question: 'How many people can you shoot?', answer: 'Any size — extended families, multiple generations, no limit.' },
      { question: "What if the kids won't cooperate?", answer: 'It happens. I build buffer time into every family session for exactly this.' },
      { question: 'Can we do it at our home?', answer: 'Yes — home sessions have a beautiful, intimate quality.' },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'events-corporate',
    category: 'moments',
    title: 'Events & Corporate Photoshoots',
    tagline: 'Coverage that makes people wish they were there.',
    description:
      'Conferences, product launches, team-building days, and corporate galas. I work fast, stay unobtrusive, and deliver images you can share within 24 hours.',
    iconName: 'CalendarDays',
    coverPath: 'WIUT/3M0A0363.png',
    galleryCategory: 'WIUT',
    includes: [
      'Pre-event briefing to understand key moments',
      'Fast turnaround — highlight reel within 24 hours',
      'Both candid and staged group shots',
      'High-res files licensed for commercial use',
    ],
    howToPrepare: [
      'Share the event schedule and venue floor plan in advance',
      'Identify 3–5 VIP faces I should prioritise',
      'Let me know any moments that are strictly off the record',
    ],
    packages: [
      { durationMinutes: 120,  photos: { min: 50, max: 80 },   delivery: { days: 1 },  priceUzs: 250000 },
      { durationMinutes: 240,  photos: { min: 100, max: 150 }, delivery: { days: 2 }, priceUzs: 420000, highlight: true },
      { duration: { en: 'Full day', ru: 'Полный день', uz: 'To‘liq kun' }, durationMinutes: 600, photos: { min: 200, max: 300 }, delivery: { days: 3 }, priceUzs: 750000 },
    ],
    faqs: [
      { question: 'Can you shoot in low-light venues?', answer: 'Yes — I use fast lenses and off-camera flash when needed.' },
      { question: 'Do you provide a photo booth?', answer: 'Not directly, but I can recommend a partner service.' },
      { question: 'What about a video highlight reel?', answer: 'Video add-ons are available — mention it when booking.' },
    ],
    accentColor: '#c8b400',
  },
  {
    slug: 'individual-portraits',
    category: 'moments',
    title: 'Individual Portraits',
    tagline: 'Just you — at your best.',
    description:
      'A personal portrait session built entirely around you. No special occasion needed — just great, honest photos of who you are right now.',
    iconName: 'User',
    coverPath: 'Portraits/Sara/3M0A1432.png',
    galleryCategory: 'Portraits',
    includes: [
      'Location scouting or studio session',
      'Posing guidance throughout',
      'Multiple outfit changes (time permitting)',
      'Retouched final selects',
    ],
    howToPrepare: [
      'Bring 2–3 outfits you feel confident in',
      'Hair and makeup can be arranged — ask when booking',
      'Think of a mood or vibe you want the photos to have',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 15, max: 25 }, delivery: { days: 2 }, priceUzs: 100000 },
      { durationMinutes: 120, photos: { min: 30, max: 45 }, delivery: { days: 3 }, priceUzs: 180000, highlight: true },
      { durationMinutes: 180, photos: { min: 50, max: 70 }, delivery: { days: 4 }, priceUzs: 260000 },
    ],
    faqs: [
      { question: 'Do I need experience in front of a camera?', answer: 'Not at all — I will guide every pose.' },
      { question: 'Can we shoot in multiple locations?', answer: 'Yes — 2 spots within Tashkent are typical for longer sessions.' },
      { question: 'What should I wear?', answer: 'Bring a few options — solid colours and textures you love photograph best.' },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'pair-group',
    category: 'moments',
    title: 'Pair & Group Portraits',
    tagline: 'Everyone you love, one frame.',
    description:
      'Portrait sessions for couples, best friends, or a full friend group. Relaxed direction that captures real connection, not stiff lineup energy.',
    iconName: 'Users',
    coverPath: 'WIUT/5I9A3029.png',
    includes: [
      'Location scouting or studio session',
      'Posing guidance for pairs and groups',
      'Individual and combined compositions',
      'Retouched final selects',
    ],
    howToPrepare: [
      'Coordinate (not match) outfits across the group',
      'Let everyone know the rough timeline in advance',
      'A shared playlist or activity helps everyone relax on camera',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 20, max: 30 },  delivery: { days: 2 }, priceUzs: 130000 },
      { durationMinutes: 120, photos: { min: 40, max: 60 },  delivery: { days: 3 }, priceUzs: 230000, highlight: true },
      { durationMinutes: 180, photos: { min: 70, max: 100 }, delivery: { days: 4 }, priceUzs: 330000 },
    ],
    faqs: [
      { question: 'How many people can you shoot?', answer: 'Any size — couples, small friend groups, no strict limit.' },
      { question: 'Can my friend join for a few shots only?', answer: 'Yes — friends can jump in for a few frames at no extra cost.' },
      { question: 'Can we shoot in multiple locations?', answer: 'Yes — 2–3 spots within Tashkent are typical for longer sessions.' },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'photowalk-tashkent',
    category: 'moments',
    title: 'Photowalk in Tashkent',
    tagline: 'The city as your backdrop.',
    description:
      "A relaxed walk through Tashkent's most photogenic spots — Old City, Chorsu, Amir Timur Square, and more. Casual, spontaneous, and full of authentic city energy.",
    iconName: 'MapPin',
    coverPath: 'Nature/streetlights.jpg',
    galleryCategory: 'Nature',
    includes: [
      'Curated route through 3–5 Tashkent locations',
      'Candid and portrait shots along the way',
      'Golden-hour timing when possible',
      'On-the-spot editing preview',
    ],
    howToPrepare: [
      'Wear comfortable shoes — we cover a lot of ground',
      'Bring a bag for personal items',
      "Dress for the weather; layers if it's an evening walk",
    ],
    packages: [
      { durationMinutes: 90, photos: { min: 25, max: 35 }, delivery: { days: 2 }, priceUzs: 130000 },
      { durationMinutes: 180,   photos: { min: 50, max: 80 }, delivery: { days: 3 }, priceUzs: 230000, highlight: true },
    ],
    faqs: [
      { question: 'What time of day works best?', answer: 'Golden hour (1–2 hours before sunset) is the most flattering light.' },
      { question: 'Can I bring friends?', answer: 'Yes — group photowalks are some of the most fun sessions.' },
      { question: "What if it's cloudy?", answer: 'Overcast light is actually very flattering. Only heavy rain would cause a reschedule.' },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'newborn-maternity',
    category: 'moments',
    title: 'New-born & Maternity',
    tagline: 'The smallest hands. The biggest feeling.',
    description:
      'Gentle, warm sessions celebrating pregnancy and the first weeks of a new life. Shot with patience, softness, and an eye for the quiet moments that pass too fast.',
    iconName: 'Baby',
    coverPath: 'Portraits/Sara/3M0A1105.png',
    includes: [
      'Newborn sessions scheduled within 5–14 days after birth',
      'Warm, safe environment — studio temperature controlled',
      'Parent and sibling poses included',
      'Soft, timeless editing style',
    ],
    howToPrepare: [
      'For newborns: feed baby right before the session so they sleep',
      'Bring a swaddle or blanket with sentimental value',
      'For maternity: schedule in the 28–34 week window for best results',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 20, max: 30 }, delivery: { days: 3 }, priceUzs: 160000 },
      { durationMinutes: 120, photos: { min: 40, max: 60 }, delivery: { days: 4 }, priceUzs: 280000, highlight: true },
      { durationMinutes: 180, photos: { min: 70, max: 90 }, delivery: { days: 5 }, priceUzs: 400000 },
    ],
    faqs: [
      { question: 'Is the studio safe for a newborn?', answer: 'Absolutely. I maintain a clean, temperature-controlled environment and have experience handling newborns.' },
      { question: 'Can we use props we bring?', answer: 'Yes — personal items like a toy, blanket, or heirloom add beautiful meaning to the images.' },
      { question: 'When should we book?', answer: 'Book during the second trimester so the spot is secured before the baby arrives.' },
    ],
    accentColor: '#c8b400',
  },

  {
    slug: 'portraits',
    category: 'moments',
    title: 'Portrait Sessions',
    tagline: 'Studio polish or street spontaneity — portraits made your way.',
    description:
      "Solo, duo, or a full friend group — shot in-studio or as a relaxed photowalk through Tashkent's best backdrops instead of a fixed location. One flexible service built around however you want to show up on camera.",
    iconName: 'User',
    coverPath: 'Portraits/Radmir/3M0A0772.png',
    galleryCategory: 'Portraits',
    includes: [
      'Choice of studio session or on-location / photowalk format',
      'Solo, pair, or group compositions — mix and match on the day',
      'Posing guidance for individuals and groups alike',
      'Retouched final selects, delivered as a private online gallery',
    ],
    howToPrepare: [
      'Bring 2–3 outfit options — solid colours and textures photograph best',
      'For groups, coordinate (not match) colours across everyone',
      'Choosing the photowalk format? Wear comfortable shoes',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 20, max: 30 },  delivery: { days: 2 }, priceUzs: 130000 },
      { durationMinutes: 120, photos: { min: 40, max: 60 },  delivery: { days: 3 }, priceUzs: 230000, highlight: true },
      { durationMinutes: 180, photos: { min: 70, max: 100 }, delivery: { days: 4 }, priceUzs: 330000 },
    ],
    faqs: [
      { question: 'Studio or outdoors — which should I pick?', answer: 'Studio gives full lighting control; a photowalk through Tashkent adds movement and real backdrops. Tell me your vibe and I will recommend a spot.' },
      { question: 'How many people can join?', answer: 'Solo sessions to full friend groups — just let me know the headcount when booking so I can plan timing.' },
      { question: 'Can we split time between two locations?', answer: 'Yes — this is common for 2–3 hour sessions, for example half studio, half photowalk.' },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'graduation',
    category: 'moments',
    title: {
      en: 'Graduation Photography',
      ru: 'Фотосъёмка выпускного',
      uz: 'Bitiruv fotosessiyasi',
    },
    tagline: {
      en: 'Cap, gown, and the people who got you there.',
      ru: 'Мантия, шапочка и те, благодаря кому вы здесь.',
      uz: 'Mantiya, bitiruv shapkasi va sizni shu kunga yetkazgan odamlar.',
    },
    description: {
      en: 'Four years, one afternoon. Most of these happen on the WIUT campus with a gown borrowed for the day — solo portraits, your friends, and your parents, who have been waiting for this longer than you have. If you also want someone at the ceremony itself, that is a separate booking below.',
      ru: 'Четыре года — и один день. Чаще всего съёмка проходит на кампусе WIUT, с мантией, взятой на день: портреты соло, друзья и родители, которые ждали этого дольше вас. Если фотограф нужен и на самой церемонии — это отдельная съёмка ниже.',
      uz: 'To‘rt yil — va bitta kun. Ko‘pincha suratga olish WIUT kampusida, bir kunga olingan mantiyada bo‘ladi: yakka portretlar, do‘stlar va bu kunni sizdan ham ko‘proq kutgan ota-onangiz. Marosimning o‘zida ham fotograf kerak bo‘lsa — bu quyida alohida buyurtma.',
    },
    iconName: 'GraduationCap',
    coverPath: 'WIUT/5Y2A4401.png',
    galleryCategory: 'WIUT',
    hero: {
      graphic: 'mortarboard',
      eyebrow: {
        en: 'Graduation · Tashkent',
        ru: 'Выпускной · Ташкент',
        uz: 'Bitiruv · Toshkent',
      },
    },
    keywords: [
      'WIUT graduation photographer',
      'graduation photoshoot Tashkent',
      'graduation photographer Tashkent',
      'фотограф на выпускной Ташкент',
      'фотосессия выпускной Ташкент',
      'bitiruv fotosessiya Toshkent',
      'bitiruv uchun fotograf',
    ],

    // TODO(marshall): fill in `date` once WIUT announces it — check
    // wiut.uz/events in October. Empty on purpose rather than guessed: 2023 was
    // 18 Nov and 2024 was 22 Nov, but "probably" is not printable on a page
    // someone books from. Venue and slots render regardless; a countdown
    // appears the moment a real date lands here.
    event: {
      date: '',
      label: {
        en: 'WIUT Graduation Ceremony',
        ru: 'Церемония вручения дипломов WIUT',
        uz: 'WIUT diplom topshirish marosimi',
      },
      venue: {
        en: 'Alisher Navoi Cinema Palace (Panorama), Navoi 15',
        ru: 'Дворец кино имени Алишера Навои («Панорама»), Навои 15',
        uz: 'Alisher Navoiy nomidagi kino saroyi («Panorama»), Navoiy 15',
      },
      note: {
        en: 'Held off campus, in two slots — Business Management and Business Information Systems in the morning, every other course in the afternoon. Registration has closed about a week and a half beforehand in past years.',
        ru: 'Проходит не на кампусе, в двух потоках: Business Management и Business Information Systems утром, остальные направления днём. В прошлые годы регистрация закрывалась примерно за полторы недели до церемонии.',
        uz: 'Kampusda emas, ikki bosqichda o‘tadi: ertalab Business Management va Business Information Systems, tushdan keyin qolgan yo‘nalishlar. O‘tgan yillarda ro‘yxatdan o‘tish taxminan bir yarim hafta oldin yopilgan.',
      },
      // Real numbers only. Raise `booked` as sessions fill; the page says
      // nothing about scarcity until there is something true to say.
      capacity: 12,
      booked: 0,
    },

    audience: {
      // "Are you a WIUTerian?" — what the cohort calls itself, kept as a proper
      // noun in all three languages rather than translated. "Студент WIUT?" is
      // a category a form would put you in; WIUTerian is a thing people call
      // themselves, and the point of this switch is that the visitor recognises
      // themselves in it before they read anything else on the page.
      prompt: {
        en: 'Are you a WIUTerian?',
        ru: 'Вы WIUTerian?',
        uz: 'Siz WIUTerianmisiz?',
      },
      // The campus itself, behind the switch. A WIUT student identifies the
      // building faster than they read the question above it.
      backdropPath: 'WIUT/5I9A3029.png',
      eyebrow: {
        en: 'WIUT Graduation · Tashkent',
        ru: 'Выпускной WIUT · Ташкент',
        uz: 'WIUT bitiruvi · Toshkent',
      },
      description: {
        en: 'Four years, one afternoon. Most WIUT graduates borrow a gown and shoot on campus — solo portraits, your friends, and your parents, who have been waiting for this longer than you have. The ceremony itself is at Panorama on Navoi, and that is a separate booking below.',
        ru: 'Четыре года — и один день. Большинство выпускников WIUT берут мантию и снимаются на кампусе: портреты, друзья и родители, которые ждали этого дольше вас. Сама церемония проходит в «Панораме» на Навои — это отдельная съёмка ниже.',
        uz: 'To‘rt yil — va bitta kun. WIUT bitiruvchilarining ko‘pi mantiya olib, kampusda suratga tushadi: yakka portretlar, do‘stlar va bu kunni sizdan ham ko‘proq kutgan ota-onangiz. Marosimning o‘zi Navoiydagi «Panorama»da bo‘ladi — bu quyida alohida buyurtma.',
      },
      groups: {
        session: {
          title: { en: 'At WIUT', ru: 'В WIUT', uz: 'WIUTda' },
          blurb: {
            en: 'On the WIUT campus, on a day that suits you — gown borrowed, no ceremony crowd, no rush.',
            ru: 'На кампусе WIUT, в удобный вам день — мантия взята заранее, без толпы и без спешки.',
            uz: 'WIUT kampusida, sizga qulay kunda — mantiya oldindan olinadi, olomon ham, shoshilish ham yo‘q.',
          },
        },
        ceremony: {
          title: { en: 'At the ceremony', ru: 'На церемонии', uz: 'Marosimda' },
          blurb: {
            en: 'Coverage at Panorama — walking up, the moment itself, and your family straight afterwards.',
            ru: 'Съёмка в «Панораме» — выход, сам момент и семья сразу после.',
            uz: '«Panorama»da suratga olish — sahnaga chiqish, o‘sha lahza va darhol keyin oilangiz.',
          },
        },
      },
    },

    notice: {
      title: {
        en: 'My first graduation season',
        ru: 'Мой первый сезон выпускных',
        uz: 'Bitiruvlar bo‘yicha birinchi mavsumim',
      },
      body: {
        en: 'I have not shot a WIUT graduation before, and the pricing says so rather than pretending otherwise. What you get instead of a long client list: portrait work you can look at on this page right now, a campus I know well, and far more attention than a photographer running six sessions a day in November.',
        ru: 'Я ещё не снимал выпускной WIUT, и цена говорит об этом честно, а не делает вид, что всё наоборот. Вместо длинного списка клиентов вы получаете портретные работы, которые можно посмотреть прямо на этой странице, кампус, который я хорошо знаю, и куда больше внимания, чем у фотографа с шестью съёмками в день в ноябре.',
        uz: 'Men hali WIUT bitiruvini suratga olmaganman, va narx buni yashirmay aytadi. Uzun mijozlar ro‘yxati o‘rniga sizga shu sahifada hozir ko‘rib chiqsa bo‘ladigan portret ishlari, men yaxshi biladigan kampus va noyabrda kuniga oltita suratga olish o‘tkazadigan fotografnikidan ancha ko‘proq e’tibor beriladi.',
      },
    },

    // Empty until real quotes exist. The section renders nothing rather than
    // showing placeholder praise \u2014 invented testimonials in a cohort where
    // everyone knows everyone is the fastest way to lose the cohort.
    proof: [],


    includes: [
      {
        en: 'Solo portraits, your friend group, and your family — all in one session',
        ru: 'Портреты соло, компания друзей и семья — всё за одну съёмку',
        uz: 'Yakka portretlar, do‘stlar davrasi va oila — hammasi bitta suratga olishda',
      },
      {
        en: 'On the WIUT campus, or anywhere in Tashkent you would rather be',
        ru: 'На кампусе WIUT или в любом другом месте Ташкента, где вам приятнее',
        uz: 'WIUT kampusida yoki Toshkentning siz xohlagan istalgan joyida',
      },
      {
        en: 'Your own private gallery link, with download sizes for posting and for printing',
        ru: 'Личная ссылка на галерею — с размерами и для публикации, и для печати',
        uz: 'Shaxsiy galereya havolasi — ijtimoiy tarmoq va bosma uchun alohida o‘lchamlar bilan',
      },
      {
        en: 'A few finished frames within hours, so you have something to post the same day',
        ru: 'Несколько готовых кадров уже через пару часов — будет что выложить в тот же день',
        uz: 'Bir necha soatdayoq bir nechta tayyor kadr — o‘sha kuniyoq joylashingiz uchun',
      },
    ],
    howToPrepare: [
      {
        en: 'Sort the gown first — the university has a limited number and they go quickly the closer you get to the ceremony',
        ru: 'Сначала решите вопрос с мантией — их в университете ограниченное число, и ближе к церемонии они разбираются быстро',
        uz: 'Avval mantiyani hal qiling — universitetda ular soni cheklangan va marosimga yaqinlashgan sari tez tugaydi',
      },
      {
        en: 'Late afternoon is the light you want; in November that means around 3–4pm',
        ru: 'Лучший свет — ближе к вечеру; в ноябре это примерно 15:00–16:00',
        uz: 'Eng yaxshi yorug‘lik — kunning ikkinchi yarmida; noyabrda bu taxminan 15:00–16:00',
      },
      {
        en: 'Bring whoever is coming. Parents and friends are part of the session, not an extra',
        ru: 'Берите с собой всех, кто хочет прийти. Родители и друзья — часть съёмки, а не доплата',
        uz: 'Kelmoqchi bo‘lgan hammani olib keling. Ota-ona va do‘stlar — suratga olishning bir qismi, qo‘shimcha to‘lov emas',
      },
      {
        en: 'Flat shoes for walking between spots, and carry the ones you want to be photographed in',
        ru: 'Удобная обувь для переходов между точками, а ту, в которой хотите сниматься, возьмите с собой',
        uz: 'Joydan joyga yurish uchun qulay poyabzal, suratga tushmoqchi bo‘lganingizni esa o‘zingiz bilan olib yuring',
      },
    ],

    packageGroups: [
      {
        key: 'session',
        locationIds: ['wiut', 'studio'],
        title: { en: 'At campus', ru: 'На кампусе', uz: 'Kampusda' },
        blurb: {
          en: 'On campus or a location you pick, on a day that suits you — no ceremony crowd, no rush.',
          ru: 'На кампусе или в месте, которое выберете вы, в удобный день — без толпы и без спешки.',
          uz: 'Kampusda yoki o‘zingiz tanlagan joyda, qulay kunda — olomonsiz va shoshilinchsiz.',
        },
        packages: [
          { id: 'grad-campus-1h', durationMinutes: 60, photos: { min: 25, max: 40 }, delivery: { days: 1 }, priceUzs: 250000 },
          {
            id: 'grad-campus-90m', durationMinutes: 90, photos: { min: 40, max: 60 }, delivery: { days: 2 },
            priceUzs: 400000, highlight: true,
            perks: [
              { en: 'Two locations on campus', ru: 'Две локации на кампусе', uz: 'Kampusda ikkita joy' },
              { en: '2 printed photos, 20×30 cm', ru: '2 напечатанных фото, 20×30 см', uz: '2 ta bosma surat, 20×30 sm' },
            ],
          },
          {
            id: 'grad-campus-group', durationMinutes: 150, photos: { min: 80, max: 120 }, delivery: { days: 3 },
            priceUzs: 700000,
            // Short on purpose: this sits after the duration on one truncating
            // line ("2,5 часа · группа"). The long Russian and Uzbek wordings
            // ran past the row and were cut mid-word on any phone under 360px.
            note: { en: 'group', ru: 'группа', uz: 'guruh' },
            asksPeople: { min: 2, max: 8 },
            perks: [
              { en: 'One price for the whole group, however many of you come', ru: 'Одна цена за всю группу, сколько бы вас ни было', uz: 'Butun guruh uchun bitta narx, nechta bo‘lsangiz ham' },
              { en: 'Solo portraits for everyone, not only group shots', ru: 'Сольные портреты для каждого, не только общие кадры', uz: 'Har kimga yakka portret, faqat guruh kadrlari emas' },
              // 15x21 rather than 20x30 here: two prints EACH is eight prints,
              // and at 20x30 that is 200 000 so'm — 29% of the booking.
              { en: '2 printed photos each, 15×21 cm (up to 5 people)', ru: 'По 2 напечатанных фото каждому, 15×21 см (до 5 человек)', uz: 'Har biriga 2 tadan bosma surat, 15×21 sm (5 kishigacha)' },
            ],
          },
        ],
      },
      {
        key: 'ceremony',
        locationIds: ['panorama', 'studio'],
        title: { en: 'On the day', ru: 'В день церемонии', uz: 'Marosim kuni' },
        blurb: {
          en: 'Coverage at the ceremony — walking up, the moment itself, and your family straight afterwards.',
          ru: 'Съёмка на самой церемонии — выход, момент вручения и семья сразу после.',
          uz: 'Marosimning o‘zida suratga olish — sahnaga chiqish, topshirish lahzasi va darhol keyin oilangiz.',
        },
        packages: [
          {
            id: 'grad-ceremony-2h', durationMinutes: 120, photos: { min: 60, max: 90 },
            delivery: { days: 3, sameDayPreview: true }, priceUzs: 500000,
            perks: [
              { en: 'A few finished frames the same evening', ru: 'Несколько готовых кадров в тот же вечер', uz: 'O‘sha oqshomning o‘zida bir nechta tayyor kadr' },
              { en: '2 printed photos, 20×30 cm', ru: '2 напечатанных фото, 20×30 см', uz: '2 ta bosma surat, 20×30 sm' },
            ],
          },
          {
            id: 'grad-ceremony-4h', durationMinutes: 240, photos: { min: 150, max: 200 },
            delivery: { days: 4, sameDayPreview: true }, priceUzs: 900000, highlight: true,
            perks: [
              { en: 'Before, during and after the ceremony', ru: 'До, во время и после церемонии', uz: 'Marosimdan oldin, davomida va keyin' },
              { en: 'A few finished frames the same evening', ru: 'Несколько готовых кадров в тот же вечер', uz: 'O‘sha oqshomning o‘zida bir nechta tayyor kadr' },
              { en: '4 printed photos, 20×30 cm', ru: '4 напечатанных фото, 20×30 см', uz: '4 ta bosma surat, 20×30 sm' },
            ],
          },
        ],
      },
    ],

    faqs: [
      {
        question: {
          en: 'Can we shoot on the WIUT campus?',
          ru: 'Можно снимать на кампусе WIUT?',
          uz: 'WIUT kampusida suratga tushish mumkinmi?',
        },
        answer: {
          en: 'Yes — that is where most of these happen. Students can get a gown for a photoshoot, and we pick a time when the light is good and the campus is quiet rather than fighting the crowd on ceremony day.',
          ru: 'Да — там и проходит большинство таких съёмок. Студенты могут взять мантию для фотосессии, а время мы выбираем такое, когда свет хороший, а на кампусе спокойно, — вместо толпы в день церемонии.',
          uz: 'Ha — bunday suratga olishlarning ko‘pi aynan o‘sha yerda bo‘ladi. Talabalar fotosessiya uchun mantiya olishlari mumkin, vaqtni esa yorug‘lik yaxshi va kampus tinch bo‘lgan paytga qo‘yamiz — marosim kunidagi olomon o‘rniga.',
        },
      },
      {
        question: {
          en: 'Where is the ceremony itself held?',
          ru: 'Где проходит сама церемония?',
          uz: 'Marosimning o‘zi qayerda o‘tadi?',
        },
        answer: {
          en: 'Not on campus. WIUT holds it at the Alisher Navoi Cinema Palace (Panorama) on Navoi Street, in two slots — Business Management and Business Information Systems in the morning, every other course in the afternoon. If you want photographs there, book the ceremony-day package.',
          ru: 'Не на кампусе. WIUT проводит её во Дворце кино имени Алишера Навои («Панорама») на улице Навои, в двух потоках: Business Management и Business Information Systems утром, остальные направления днём. Если нужны фотографии оттуда — берите пакет на день церемонии.',
          uz: 'Kampusda emas. WIUT uni Navoiy ko‘chasidagi Alisher Navoiy nomidagi kino saroyida («Panorama») ikki bosqichda o‘tkazadi: ertalab Business Management va Business Information Systems, tushdan keyin qolgan yo‘nalishlar. O‘sha yerdan suratlar kerak bo‘lsa — marosim kuni paketini tanlang.',
        },
      },
      {
        question: {
          en: 'Can I split a session with friends?',
          ru: 'Можно разделить съёмку с друзьями?',
          uz: 'Suratga olishni do‘stlar bilan bo‘lishsa bo‘ladimi?',
        },
        answer: {
          en: 'Yes, and it is the option most people want once they hear it. The 2.5-hour group session is 700,000 so\'m for the whole group — two of you or five, the price is the same — and everyone gets their own solo portraits as well as the group shots.',
          ru: 'Да, и, услышав про этот вариант, большинство выбирает именно его. Групповая съёмка на 2,5 часа стоит 700 000 сум за всю группу — вдвоём или впятером, цена одна, — и каждый получает свои сольные портреты, а не только общие кадры.',
          uz: 'Ha, va bu variantni eshitgach ko‘pchilik aynan shuni tanlaydi. 2,5 soatlik guruh suratga olish butun guruh uchun 700 000 so‘m — ikki kishimisiz yoki besh, narx bir xil — va har kim guruh kadrlaridan tashqari o‘z yakka portretlarini ham oladi.',
        },
      },
      {
        question: {
          en: 'How soon can I post something?',
          ru: 'Как скоро я смогу что-нибудь выложить?',
          uz: 'Qachon birinchi suratni joylay olaman?',
        },
        answer: {
          en: 'A few finished frames the same evening, every time. The full set follows within a day or three depending on the package.',
          ru: 'Несколько готовых кадров в тот же вечер — всегда. Полный набор приходит через один-три дня, в зависимости от пакета.',
          uz: 'Bir nechta tayyor kadr o‘sha oqshomning o‘zida — har doim. To‘liq to‘plam paketga qarab bir-uch kun ichida keladi.',
        },
      },
      {
        question: {
          en: 'You have not shot a graduation before — why book you?',
          ru: 'Вы раньше не снимали выпускной — почему тогда вы?',
          uz: 'Siz ilgari bitiruv suratga olmagansiz — nega aynan siz?',
        },
        answer: {
          en: 'Fair question, and the honest answer is on this page: the portrait work above is mine, and a gown does not change how a portrait is made. What it does change is the price — this is my first season and it costs a fraction of what it will next year. You are trading a track record for a better rate and a photographer with time for you.',
          ru: 'Справедливый вопрос, и честный ответ — на этой странице: портреты выше сняты мной, а мантия не меняет того, как делается портрет. Что она меняет — это цену: это мой первый сезон, и он стоит малую долю от того, что будет стоить в следующем году. Вы меняете послужной список на цену получше и на фотографа, у которого есть на вас время.',
          uz: 'O‘rinli savol, halol javob esa shu sahifada: yuqoridagi portretlar meniki, mantiya esa portret qanday olinishini o‘zgartirmaydi. U o‘zgartiradigani — narx: bu mening birinchi mavsumim va u kelasi yilgining kichik bir ulushiga turadi. Siz tajriba ro‘yxatini yaxshiroq narxga va sizga vaqt ajrata oladigan fotografga almashtiryapsiz.',
        },
      },
      {
        question: {
          en: 'What if it rains, or the date moves?',
          ru: 'А если дождь или дата сдвинется?',
          uz: 'Yomg‘ir yog‘sa yoki sana siljisa-chi?',
        },
        answer: {
          en: 'We move the session, no charge. November in Tashkent is unpredictable and I would rather reshoot than hand you something grey.',
          ru: 'Переносим съёмку без доплаты. Ноябрь в Ташкенте непредсказуем, и мне проще переснять, чем отдать вам серые кадры.',
          uz: 'Suratga olishni qo‘shimcha to‘lovsiz ko‘chiramiz. Toshkentda noyabr oldindan aytib bo‘lmaydigan oy, menga esa kulrang kadrlar berishdan ko‘ra qayta suratga olish osonroq.',
        },
      },
    ],
    // Westminster blue, one step brighter than WIUT's own #0143A3.
    //
    // Deliberately NOT their exact swatch. This page names WIUT throughout and
    // is a commercial page by someone the university has nothing to do with;
    // adopting their brand hex as well edges it toward looking official. Same
    // family, clearly its own — and no crest, no logo, no lettermark anywhere.
    accentColor: '#1B4F9C',
  },
  {
    slug: 'models',
    category: 'fashion',
    title: 'Model Portfolio',
    tagline: 'Your book, built to open agency doors.',
    description:
      'A focused portfolio shoot for models looking to build or refresh their book. Strong variety: editorial, commercial, and beauty shots that show range to agencies and clients.',
    iconName: 'Camera',
    coverPath: 'WIUT-Fashion-Show/3M0A1946.png',
    galleryCategory: 'WIUT-Fashion-Show',
    includes: [
      'Pre-shoot concept meeting',
      '3–4 looks with different lighting setups',
      'Both studio and outdoor setups',
      'Print-ready and web-optimised exports',
    ],
    howToPrepare: [
      'Bring 3–4 wardrobe options across different aesthetics (casual, editorial, formal)',
      'Come with natural makeup — we can layer up from there',
      'Have your current comp card if you have one',
    ],
    packages: [
      { durationMinutes: 120, photos: { min: 20, max: 30 },  delivery: { days: 3 }, priceUzs: 200000 },
      { durationMinutes: 240, photos: { min: 40, max: 60 },  delivery: { days: 4 }, priceUzs: 380000, highlight: true },
      { durationMinutes: 360, photos: { min: 80, max: 100 }, delivery: { days: 5 }, priceUzs: 580000 },
    ],
    faqs: [
      { question: 'Do you work with beginner models?', answer: 'Yes. I work with models at all levels and provide full direction throughout.' },
      { question: 'Can a makeup artist be arranged?', answer: 'Yes — a hair and makeup artist can be added to any package.' },
      { question: 'Will the photos help me get signed?', answer: 'A well-executed book significantly improves your chances. I can advise on what agencies in the region look for.' },
    ],
    accentColor: '#1500FF',
  },
  {
    slug: 'fashion-streetstyle',
    category: 'fashion',
    title: 'Fashion & Street Style',
    tagline: 'Clothes that move. Photos that stop traffic.',
    description:
      "Editorial and street-style shoots for brands, designers, boutiques, or individuals with something to say through what they wear. Shot on location in Tashkent's most visually interesting districts.",
    iconName: 'Shirt',
    coverPath: 'WIUT-Fashion-Show/3M0A2669.png',
    galleryCategory: 'WIUT-Fashion-Show',
    includes: [
      "Location scouting in Tashkent's key visual districts",
      'Dynamic movement and action shots alongside static editorial',
      'Mix of tight and environmental frames',
      'Colour grading matched to your brand aesthetic',
    ],
    howToPrepare: [
      'Bring a rack — more options is always better on a fashion shoot',
      'Think about the feeling the clothes should communicate',
      "If you're a brand, bring lookbook context (season, campaign direction)",
    ],
    packages: [
      { durationMinutes: 120, photos: { min: 30, max: 50 },   delivery: { days: 2 }, priceUzs: 220000 },
      { durationMinutes: 240, photos: { min: 60, max: 100 },  delivery: { days: 3 }, priceUzs: 400000, highlight: true },
      { durationMinutes: 480, photos: { min: 120, max: 180 }, delivery: { days: 5 }, priceUzs: 700000 },
    ],
    faqs: [
      { question: 'Do you work with brands or just individuals?', answer: 'Both — I have experience with brand lookbooks and personal style shoots.' },
      { question: 'Can you match a specific editorial reference?', answer: 'Yes. Share references beforehand and we will nail the aesthetic.' },
      { question: 'Do you shoot video content too?', answer: 'Short-form video content can be added — ask when booking.' },
    ],
    accentColor: '#2a6045',
  },
  {
    slug: 'uzb-national',
    category: 'fashion',
    title: 'Uzbek National Photography',
    tagline: 'Traditional dress. Contemporary vision.',
    description:
      'Portraits and editorial shoots celebrating Uzbek national dress and cultural identity — chapan, atlas, ikat, surkh-kiyim. Shot with pride, with an eye for detail that honours the craftsmanship.',
    iconName: 'Globe',
    coverPath: 'Nature/fountainalayskiy.jpg',
    includes: [
      'Cultural context consultation — making sure the styling tells the right story',
      'Location options: Old City Tashkent, Chorsu, or studio',
      'Detail shots of embroidery, jewellery, and fabric texture',
      'Both portrait and environmental compositions',
    ],
    howToPrepare: [
      'Bring the outfit freshly pressed and lint-free',
      'Jewellery and accessories make a huge difference — bring options',
      'Share any occasion context (Navruz, wedding, family portrait)',
    ],
    packages: [
      { durationMinutes: 60,  photos: { min: 20, max: 30 },  delivery: { days: 2 }, priceUzs: 140000 },
      { durationMinutes: 120, photos: { min: 40, max: 60 },  delivery: { days: 3 }, priceUzs: 250000, highlight: true },
      { durationMinutes: 180, photos: { min: 70, max: 100 }, delivery: { days: 4 }, priceUzs: 360000 },
    ],
    faqs: [
      { question: 'Can I bring multiple outfits?', answer: 'Yes — changing between looks is common and encouraged.' },
      { question: 'Do you shoot in Old City Tashkent?', answer: 'Yes — it is one of my favourite locations for this genre.' },
      { question: 'Can this be a group or family session?', answer: 'Absolutely. Multi-generational national dress portraits are beautiful.' },
    ],
    accentColor: '#c8b400',
  },
  {
    slug: 'creative-photography',
    category: 'fashion',
    title: 'Creative Photography',
    tagline: 'No rules. Great photos.',
    description:
      'Conceptual, experimental, and artistic shoots for people who have an idea they want to realise. Double exposures, dramatic lighting, set builds, and surreal concepts — bring your vision and we will make it work.',
    iconName: 'Wand2',
    coverPath: 'Nature/frozenbutnotreally.jpg',
    includes: [
      'Full pre-shoot concept development session',
      'Prop and set styling support',
      'Experimental lighting setups',
      'Post-production compositing and retouching (where needed)',
    ],
    howToPrepare: [
      'Build a mood board — the more specific, the better',
      'Think about colour palette, mood, and the feeling the image should leave',
      'Be ready to experiment — creative shoots evolve in the moment',
    ],
    packages: [
      { durationMinutes: 120, photos: { min: 10, max: 20 }, delivery: { days: 4 }, priceUzs: 250000 },
      { durationMinutes: 240, photos: { min: 20, max: 35 }, delivery: { days: 5 }, priceUzs: 450000, highlight: true },
      { durationMinutes: 480, photos: { min: 40, max: 60 }, delivery: { days: 7 }, priceUzs: 800000 },
    ],
    faqs: [
      { question: "What if I don't know exactly what I want?", answer: 'That is fine — we can start with a mood and develop the concept together.' },
      { question: 'Can you source props?', answer: 'Basic props are included. Specialised items may have an additional cost.' },
      { question: 'How many edited images do I get?', answer: 'Creative shoots produce fewer but more polished images — quality over quantity.' },
    ],
    accentColor: '#1500FF',
  },
];

export function getServiceBySlug(slug: string): ServiceData | undefined {
  return servicesData.find((s) => s.slug === slug);
}

export function getAllServiceSlugs(): string[] {
  return servicesData.map((s) => s.slug);
}