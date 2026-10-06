// The mini-sessions — one afternoon, fixed slots, one price.
//
// A LEAF MODULE ON PURPOSE. The only thing it takes from booking-catalog.ts is
// the CatalogItem *type*, imported with `import type` so it is erased at
// compile time and no import cycle exists at runtime — booking-catalog.ts
// imports this file back, to teach findCatalogItem() the price.
//
// This is not in services.ts because services.ts is a catalogue of things
// offered indefinitely, each with a landing page. A one-afternoon event is
// neither.
//
// HOW TO RUN THE NEXT ONE. Change MINI_EVENT below, move the OUTGOING event's
// CatalogItem into RETIRED_ITEMS, and deploy. Nothing else: the booking page
// reads the date, the calendar closes it to every other product, the option
// takes itself off the form the day after, and /mini points at whatever
// MINI_EVENT.id currently is.
//
// Still a module rewrite rather than a data edit, which is the refactor
// Marshall has parked until after the first real run — an array of events with
// the current one picked by date. Worth doing once weekly changes are a habit
// rather than a plan.

import type { CatalogItem } from "./booking-catalog";

// Anxor Park — Sunday 11 October 2026
//
// Six slots, 35 minutes apart, 170 000 each: 20–25 minutes of shooting and ten
// minutes to change over.
//
// SIX, NOT EIGHT, AND THE REASON IS THE LIGHT. The CCA set ran 15:00 to 19:05.
// Sunset in Tashkent is 18:13 on 27 September and 17:50 on 11 October, and
// this venue is a park rather than an arts centre with walls and lamps in it.
// The 18:30 and 19:05 blocks would be sold for 170 000 each and then shot in
// the dark.
//
//   15:00–15:25   daylight
//   15:35–16:00   daylight
//   16:10–16:35   daylight
//   16:45–17:10   the light starts to go
//   17:20–17:45   golden hour, ends five minutes before sunset — the best one
//   17:55–18:20   civil twilight, workable with fast glass
//   ──────────────  sunset 17:50
//   18:30–18:55   dark            ← dropped
//   19:05–19:30   dark            ← dropped
//
// TO PUT THEM BACK, if the park turns out to be lit or lights are coming:
// add "18:30" and "19:05" to `slots`. Nothing else needs touching — the form
// renders whatever is in this array.

export const MINI_EVENT = {
  /** The service id, and what /mini redirects to. New venue, new id. */
  id: "mini-anxor",
  /** Sunday. Verified against the date, not the label on the sheet. */
  dateISO: "2026-10-11",
  locationId: "anxor",
  slots: ["15:00", "15:35", "16:10", "16:45", "17:20", "17:55"],
  /**
   * Sold off-site, so nothing in the database knows about them. The form must
   * refuse them.
   *
   * Empty for this event — everything is going through the form. To block one,
   * add the time here and redeploy; to release it, delete it again.
   */
  preBooked: [] as readonly string[],
  /**
   * NEW VENUE, NEW PACKAGE ID — and it keeps the `mini-` prefix, which is not
   * cosmetic (see MINI_PACKAGE_PREFIX below). Never rename an id that has been
   * live: it is written permanently into `bookings` rows, into Telegram
   * messages and into whatever links are still in someone's history.
   */
  packageId: "mini-anxor-25m",
} as const;

/**
 * Every mini-session package id starts with this.
 *
 * NOT cosmetic. The database's two partial unique indexes key on it:
 * `bookings_one_live_per_day` excludes `package_id like 'mini-%'` and
 * `bookings_one_live_per_slot` selects it, which is what allows several
 * bookings on one date while every other product stays one-a-day. Rename the
 * prefix and you have to rename it in the migration too, or the day index
 * silently starts rejecting the second mini-session of the day.
 *
 * See supabase/migrations/20260925090000_mini_session_slots.sql, and
 * scripts/check-slot-indexes.mjs, which proves the two are in step by trying.
 */
export const MINI_PACKAGE_PREFIX = "mini-";

export function isMiniPackage(id: string | null | undefined): boolean {
  return !!id && id.startsWith(MINI_PACKAGE_PREFIX);
}

const MINI_ITEM: CatalogItem = {
  id: MINI_EVENT.packageId,
  serviceSlug: MINI_EVENT.id,
  serviceTitle: {
    en: "Mini-session at Anxor Park",
    ru: "Мини-съёмка в парке «Анхор»",
    uz: "«Anxor» bog'ida mini-suratga olish",
  },
  groupKey: null,
  groupTitle: null,
  // Spelled out rather than derived from durationMinutes: the block held is 25
  // minutes and the shooting is 20–25, and the honest thing to print is the
  // range the client experiences.
  duration: { en: "20–25 minutes", ru: "20–25 минут", uz: "20–25 daqiqa" },
  durationMinutes: 25,
  photos: { min: 12, max: 15 },
  // 48 hours. `days` is what the formatter speaks, and two days is the same
  // promise in the language the rest of the site already uses.
  delivery: { days: 2 },
  priceUzs: 170_000,
  highlight: false,
  perks: [],
  note: null,
  locationIds: [MINI_EVENT.locationId],
  asksPeople: null,
};

/**
 * EVENTS THAT HAVE HAPPENED. Priceable for ever, offered never.
 *
 * Each past event sold bookings, and those rows carry its package id. Drop the
 * item and `findCatalogItem("mini-cca-25m")` returns undefined, which breaks
 * three things at once: the booking status route can no longer name what was
 * sold, an old `/book?package=…` link lands on a form that cannot price
 * itself, and the API route rejects the id outright.
 *
 * They are deliberately NOT in miniCatalog(), because that is the list the
 * form OFFERS — a client booking Anxor must not be shown a CCA tier. The
 * two lists exist precisely so "what can be sold" and "what can be priced"
 * can diverge, which after the second event they permanently do.
 */
const RETIRED_ITEMS: CatalogItem[] = [
  {
    id: "mini-cca-25m",
    serviceSlug: "mini-cca",
    serviceTitle: {
      en: "Mini-session at CCA",
      ru: "Мини-съёмка в CCA",
      uz: "CCA’da mini-suratga olish",
    },
    groupKey: null,
    groupTitle: null,
    duration: { en: "20–25 minutes", ru: "20–25 минут", uz: "20–25 daqiqa" },
    durationMinutes: 25,
    photos: { min: 12, max: 15 },
    delivery: { days: 2 },
    priceUzs: 170_000,
    highlight: false,
    perks: [],
    note: null,
    locationIds: ["cca"],
    asksPeople: null,
  },
  /**
   * NEVER RAN, and still has to be here.
   *
   * The 11 October event was set up at Lokomotiv on 2026-10-06 and moved to
   * Anxor the same day — but bookings were taken against this id in between,
   * and `package_id` is written into those rows permanently. An id that has
   * been live for five minutes is as unrenameable as one that ran for a month:
   * what makes it permanent is that a row carries it, not how long it was on
   * offer.
   *
   * Delete this entry and those bookings stop being nameable and priceable,
   * which is the same breakage as dropping the CCA tier above — just less
   * obvious, because the event it belongs to is the one still coming up.
   */
  {
    id: "mini-lokomotiv-25m",
    serviceSlug: "mini-lokomotiv",
    serviceTitle: {
      en: "Mini-session at Lokomotiv Park",
      ru: "Мини-съёмка в парке «Локомотив»",
      uz: "«Lokomotiv» parkida mini-suratga olish",
    },
    groupKey: null,
    groupTitle: null,
    duration: { en: "20–25 minutes", ru: "20–25 минут", uz: "20–25 daqiqa" },
    durationMinutes: 25,
    photos: { min: 12, max: 15 },
    delivery: { days: 2 },
    priceUzs: 170_000,
    highlight: false,
    perks: [],
    note: null,
    locationIds: ["lokomotiv"],
    asksPeople: null,
  },
];

/** What the form offers: the current event's tier, and nothing else. */
export function miniCatalog(): CatalogItem[] {
  return [MINI_ITEM];
}

/**
 * What can be PRICED: the current event and every past one.
 *
 * findCatalogItem() in booking-catalog.ts reads this, not miniCatalog(), so an
 * id from a finished event keeps resolving long after the option has gone.
 */
export function miniPriceableItems(): CatalogItem[] {
  return [MINI_ITEM, ...RETIRED_ITEMS];
}

// Slot checking — the mini-session equivalent of canBook()

export type SlotState = "open" | "taken";

/**
 * Which of the event's slots can still be booked.
 *
 * Two sources of "taken", and both matter: `preBooked` above for anything sold
 * off-site, and the live bookings ledger for everything sold through the form.
 * Passing only one of them is how a slot gets sold twice.
 */
export function miniSlotStates(
  bookedTimes: readonly string[],
): { time: string; state: SlotState }[] {
  const gone = new Set<string>([...MINI_EVENT.preBooked, ...bookedTimes]);
  return MINI_EVENT.slots.map((time) => ({
    time,
    state: gone.has(time) ? ("taken" as const) : ("open" as const),
  }));
}

export function miniSlotBookable(
  time: string,
  bookedTimes: readonly string[],
): boolean {
  return miniSlotStates(bookedTimes).some(
    (s) => s.time === time && s.state === "open",
  );
}
