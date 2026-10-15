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
//   2. A ONE-OFF EVENT — the mini-sessions. One date, fixed slots, one
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
// ONE PRODUCT NOW, NOT TWO. Ceremony-day coverage was withdrawn on 2026-10-15
// — Marshall is not taking bookings for the day itself — so the "ceremony"
// group in services.ts is marked `retired` and everything that used to fork on
// it is gone: the "During the ceremony?" switch in the form, the pinned date,
// the placeholder start time, and the group constant that named the fork.
//
// The ceremony DATE did not go anywhere; it just has one home now. It lives on
// the graduation service's `event` block, which the page renders as a deadline
// for booking a campus session. The CEREMONY_DATE_ISO constant that used to
// sit here had no second reader once the form stopped pinning to it, and two
// copies of a date are two chances to disagree.

export const GRAD_CAMPUS_GROUP = "session";

/**
 * Is this a withdrawn ceremony-day tier?
 *
 * Kept — and kept narrow — because /api/booking still reads it to print "time
 * to be confirmed" instead of an hour range for any booking that carries one
 * of these ids. Those rows exist; `grad-ceremony-2h` and `grad-ceremony-4h`
 * were live from September to 15 October. Nothing NEW can be created with one:
 * the route refuses a retired tier before it gets this far.
 */
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
    // "or on the day itself" came out with the product it advertised.
    blurb: {
      en: "Cap and gown on campus, on a day that suits you.",
      ru: "Мантия и шапочка на кампусе, в удобный для вас день.",
      uz: "Kampusda mantiya va shapka — o‘zingizga qulay kunda.",
    },
  },
  {
    id: MINI_EVENT.id,
    // Written here rather than read off MINI_EVENT, so the venue and the date
    // read naturally in three languages. They are the two things that change
    // every event, so they are the two things to check on the way past.
    title: {
      en: "Mini-sessions · Anxor Park",
      ru: "Мини-съёмки · парк «Анхор»",
      uz: "Mini-suratga olish · «Anxor» parki",
    },
    blurb: {
      en: "One afternoon only, Sunday 11 October. Six slots.",
      ru: "Только один день — воскресенье, 11 октября. Шесть слотов.",
      uz: "Faqat bir kun — 11-oktabr, yakshanba. Oltita slot.",
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
 * Graduation USED TO fork here — the campus group by default, the ceremony
 * group once "During the ceremony?" was on. With ceremony-day coverage
 * withdrawn there is one group left, and the filter below is what makes that
 * true rather than assumed: catalogForService() already drops retired groups,
 * so this narrows to the campus key and falls back to everything if that key
 * is ever renamed.
 *
 * Falling back to everything rather than to nothing is deliberate: a renamed
 * group key should make the form show too much, not leave a client staring at
 * a step with no options and no explanation.
 */
export function catalogForBooking(serviceId: string | null): CatalogItem[] {
  if (!serviceId) return [];
  if (serviceId === MINI_EVENT.id) return miniCatalog();

  if (serviceId === GRADUATION_SLUG) {
    const all = catalogForService(GRADUATION_SLUG);
    const group = all.filter((i) => i.groupKey === GRAD_CAMPUS_GROUP);
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
