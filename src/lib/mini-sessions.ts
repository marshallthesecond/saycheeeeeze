// The CCA mini-sessions — one afternoon, eight slots, one price.
//
// A LEAF MODULE ON PURPOSE. The only thing it takes from booking-catalog.ts is
// the CatalogItem *type*, imported with `import type` so it is erased at
// compile time and no import cycle exists at runtime — booking-catalog.ts
// imports this file back, to teach findCatalogItem() the price.
//
// This is not in services.ts because services.ts is a catalogue of things
// offered indefinitely, each with a landing page. A one-afternoon event is
// neither.

import type { CatalogItem } from "./booking-catalog";

// The CCA mini-sessions — Sunday 27 September 2026
//
// Eight fixed slots 35 minutes apart, 170 000 each, 20–25 minutes of shooting
// and ten minutes to change over. Three were sold before the form existed and
// are listed here because there is no booking row to find them in.
//
// WHEN THE DAY IS OVER: delete nothing. Leave `untilISO` to take the option off
// the form by itself, and leave the rest so the three photographs it sold can
// still be priced and named. Copy the block for the next event.

export const MINI_EVENT = {
  id: "mini-cca",
  /** Sunday. Verified against the date, not the label on the sheet. */
  dateISO: "2026-09-27",
  locationId: "cca",
  /**
   * The sheet says 3:00 to 7:05. Those are afternoon times — an outdoor event
   * finishing at half seven, not one starting at three in the morning.
   */
  slots: ["15:00", "15:35", "16:10", "16:45", "17:20", "17:55", "18:30", "19:05"],
  /**
   * Sold off-site, shaded on Marshall's sheet. The form must refuse them, and
   * nothing in the database knows about them — so they are here.
   *
   * To release one, delete it from this list and redeploy.
   */
  preBooked: ["16:10", "16:45", "17:55"],
  packageId: "mini-cca-25m",
} as const;

/**
 * Every mini-session package id starts with this.
 *
 * NOT cosmetic. The database's two partial unique indexes key on it:
 * `bookings_one_live_per_day` excludes `package_id like 'mini-%'` and
 * `bookings_one_live_per_slot` selects it, which is what allows eight bookings
 * on one date while every other product stays one-a-day. Rename the prefix and
 * you have to rename it in the migration too, or the day index silently starts
 * rejecting the second mini-session of the day.
 *
 * See supabase/migrations/20260925090000_mini_session_slots.sql.
 */
export const MINI_PACKAGE_PREFIX = "mini-";

export function isMiniPackage(id: string | null | undefined): boolean {
  return !!id && id.startsWith(MINI_PACKAGE_PREFIX);
}

const MINI_ITEM: CatalogItem = {
  id: MINI_EVENT.packageId,
  serviceSlug: MINI_EVENT.id,
  serviceTitle: {
    en: "Mini-session at CCA",
    ru: "Мини-съёмка в CCA",
    uz: "CCA’da mini-suratga olish",
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

export function miniCatalog(): CatalogItem[] {
  return [MINI_ITEM];
}

// Slot checking — the mini-session equivalent of canBook()

export type SlotState = "open" | "taken";

/**
 * Which of the event's slots can still be booked.
 *
 * Two sources of "taken", and both matter: `preBooked` above for the three
 * sold off-site, and the live bookings ledger for everything sold through the
 * form. Passing only one of them is how a slot gets sold twice.
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
