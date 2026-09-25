// WHAT /book OFFERS. Three things, not sixteen.
//
// The form used to ask "which of these three durations?" — 1 hour, 1.5, 2.5 —
// which is not a product. It is a dimension of one. And the client answered it
// again in step 2 anyway, because duration bounds the start times. So step one
// now asks the question a client actually arrives with: what are we shooting?
//
// Deliberately not server-only: the form renders these and /api/booking
// re-checks them, and both reading the same list is what stops the two
// disagreeing about what exists.
//
// THREE KINDS OF THING LIVE HERE:
//
//   1. A slug from services.ts — "portraits", "graduation". Its tiers, prices
//      and locations all come from that file; nothing is copied.
//   2. A ONE-OFF EVENT — the CCA mini-sessions. One date, fixed slots, one
//      price, no landing page. It has no business in services.ts, which is a
//      catalogue of things offered indefinitely.
//   3. Whatever service a client arrived from. A "Book this" link on any of
//      the other fourteen pages still works: the form adds that service as a
//      fourth option rather than losing the tier they just tapped.

import { catalogForService, type CatalogItem } from "./booking-catalog";
import { MINI_EVENT, miniCatalog } from "./mini-sessions";
import { servicesData, type Localized } from "./services";

export interface BookingServiceOption {
  /** A services.ts slug, or a one-off event id. */
  id: string;
  title: Localized;
  blurb: Localized;
  /** An event: gone from the form after this date, Tashkent time. */
  untilISO?: string;
  /** An event: the only date it can be booked, and a date nothing else can. */
  onlyDateISO?: string;
}

// Graduation
//
// The two groups already exist in services.ts. Nothing about the prices is
// decided here — this only names the groups so the form can show one or the
// other, and says which date the ceremony falls on.

export const GRAD_CAMPUS_GROUP = "session";
export const GRAD_CEREMONY_GROUP = "ceremony";

/**
 * WIUT graduation day.
 *
 * ONE LINE TO CHANGE when the university confirms. Marshall gave 22 October
 * 2026, a Thursday. Worth knowing: the project notes record the 2023 and 2024
 * ceremonies as being in NOVEMBER (18 Nov 2023, 22 Nov 2024), and registration
 * closed about nine days beforehand. If the date moves, this constant and the
 * `event` block on the graduation service page are the two places that say it.
 */
export const CEREMONY_DATE_ISO = "2026-10-22";

export function isCeremonyPackage(id: string | null | undefined): boolean {
  return !!id && id.startsWith("grad-ceremony-");
}

// The offered list

const PORTRAITS_SLUG = "portraits";
const GRADUATION_SLUG = "graduation";

/**
 * Titles written here rather than read from `service.title`, because two of
 * those are bare English strings — `Localized` allows it, and it means a
 * Russian visitor reads "Portrait Sessions" in the one place the form asks its
 * first question. Display labels only; every price still comes from
 * services.ts.
 */
const CORE: BookingServiceOption[] = [
  {
    id: PORTRAITS_SLUG,
    title: { en: "Portrait", ru: "Портрет", uz: "Portret" },
    blurb: {
      en: "Solo, pair or a group — studio or out in the city.",
      ru: "Соло, вдвоём или компанией — в студии или в городе.",
      uz: "Yakka, juft yoki guruh — studiyada yoki shaharda.",
    },
  },
  {
    id: GRADUATION_SLUG,
    title: { en: "Graduation", ru: "Выпускной", uz: "Bitiruv" },
    blurb: {
      en: "Cap and gown, on campus or on the day itself.",
      ru: "Мантия и шапочка — на кампусе или в день церемонии.",
      uz: "Mantiya va shapka — kampusda yoki marosim kuni.",
    },
  },
  {
    id: MINI_EVENT.id,
    title: {
      en: "Mini-sessions · CCA",
      ru: "Мини-съёмки · CCA",
      uz: "Mini-suratga olish · CCA",
    },
    blurb: {
      en: "One afternoon only, Sunday 27 September. Eight slots.",
      ru: "Только один день — воскресенье, 27 сентября. Восемь слотов.",
      uz: "Faqat bir kun — 27-sentabr, yakshanba. Sakkizta slot.",
    },
    untilISO: MINI_EVENT.dateISO,
    onlyDateISO: MINI_EVENT.dateISO,
  },
];

/**
 * What to show in step 1.
 *
 * `arrivedFrom` is the `?service=` slug. When it is one of the three the list
 * is unchanged; when it is any of the other fourteen services it is APPENDED,
 * so every "Book this" button on the site keeps working and a cold visitor
 * still sees three options rather than sixteen.
 *
 * Model and brand photography are deliberately absent — Marshall's call, and
 * the way back is to add a line to CORE, not to touch the form.
 */
export function offeredServices(
  todayISO: string,
  arrivedFrom?: string | null,
): BookingServiceOption[] {
  const live = CORE.filter((s) => !s.untilISO || s.untilISO >= todayISO);

  if (!arrivedFrom || live.some((s) => s.id === arrivedFrom)) return live;

  const service = servicesData.find((s) => s.slug === arrivedFrom);
  if (!service || catalogForService(arrivedFrom).length === 0) return live;

  return [
    ...live,
    { id: service.slug, title: service.title, blurb: service.tagline },
  ];
}

/**
 * The tiers for one service.
 *
 * Graduation is the only one with a fork: the campus group by default, the
 * ceremony group once "During the ceremony?" is on. They are different
 * products at different prices — 250/400/700 against 500/900 — so switching
 * has to switch the price list, not just the date.
 */
export function catalogForBooking(
  serviceId: string | null,
  opts: { atCeremony?: boolean } = {},
): CatalogItem[] {
  if (!serviceId) return [];
  if (serviceId === MINI_EVENT.id) return miniCatalog();

  if (serviceId === GRADUATION_SLUG) {
    const want = opts.atCeremony ? GRAD_CEREMONY_GROUP : GRAD_CAMPUS_GROUP;
    const all = catalogForService(GRADUATION_SLUG);
    const group = all.filter((i) => i.groupKey === want);
    // Falling back to everything rather than to nothing: a renamed group key
    // should make the form show too much, not leave a client staring at a step
    // with no options and no explanation.
    return group.length > 0 ? group : all;
  }

  return catalogForService(serviceId);
}

/**
 * Dates this service may NOT be booked on.
 *
 * Returned as plain ISO strings so the caller can merge them into the blackout
 * set that `canBook()` and the calendar already take — no new concept, no
 * change to availability.ts. An event's own date is excluded from its own list,
 * which is the whole point: 27 September is closed to portraits precisely
 * because it is open to mini-sessions.
 */
export function reservedDatesFor(serviceId: string | null): string[] {
  return CORE.filter((s) => s.onlyDateISO && s.id !== serviceId).map(
    (s) => s.onlyDateISO as string,
  );
}

/** The event a service id refers to, when it is one. */
export function eventFor(serviceId: string | null) {
  return serviceId === MINI_EVENT.id ? MINI_EVENT : null;
}


/**
 * What a ceremony-day booking records as its start time.
 *
 * `bookings.start_time` is NOT NULL, and an all-day booking has no hour yet —
 * the university publishes two blocks (11:00–14:00 and 15:00–18:00) and the
 * client usually does not know which one they are in when they book. Rather
 * than making the column nullable and teaching every reader of it about the
 * exception, the row carries the ceremony's own published start and everything
 * Marshall reads says "time to be confirmed" instead of a range.
 *
 * A PLACEHOLDER, NOT A PROMISE. Anything that starts treating this as the real
 * call time is a bug.
 */
export const CEREMONY_PLACEHOLDER_START = "11:00";
