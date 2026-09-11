// src/lib/locations.ts
//
// Where a session happens, and what that adds to the bill.
//
// No "server-only": the form displays these and the API route re-prices from
// them, and both reading the same list is what stops a surcharge being shown
// and then not charged, or charged and never shown.
//
// Labels live in the dictionaries under `book.loc.<id>.*` — this file carries
// only ids and money, so renaming a place in three languages never touches
// pricing and never orphans a historical booking.

/** A studio is hired by the hour, so its cost follows the session length. */
export interface BookingLocation {
  id: string;
  /**
   * Added per hour of session, rounded UP to the whole hour — which is how
   * studios actually bill. Zero for anywhere outdoors or on a campus.
   */
  surchargePerHourUzs: number;
}

/**
 * ── The studio figure is Marshall's to set ───────────────────
 * 100 000 so'm/hour is a plausible Tashkent studio rate and nothing more. It is
 * the one number here that leaves a client's pocket, so it should be the real
 * rate you are charged, not a placeholder that survived to production.
 *
 * Everywhere else is genuinely free to shoot, so the surcharge is genuinely
 * zero — not a rounding of something small.
 */
export const BOOKING_LOCATIONS: BookingLocation[] = [
  { id: "wiut", surchargePerHourUzs: 0 },
  // The WIUT ceremony is held here, not on campus. It is a location the form
  // should offer by name rather than leaving to the free-text box, since it is
  // where every ceremony-day booking happens.
  { id: "panorama", surchargePerHourUzs: 0 },
  { id: "studio", surchargePerHourUzs: 100_000 },
  { id: "botanical", surchargePerHourUzs: 0 },
  { id: "lokomotiv", surchargePerHourUzs: 0 },
  { id: "city", surchargePerHourUzs: 0 },
];

export function getLocation(id: string | null | undefined): BookingLocation | undefined {
  if (!id) return undefined;
  return BOOKING_LOCATIONS.find((l) => l.id === id);
}

/**
 * What a location adds for a session of this length.
 *
 * Rounded up to the whole hour because a studio charges for the hour you are
 * in, not the ninety minutes you booked — and because rounding DOWN would
 * quote a client less than the invoice we are about to pay.
 *
 * A custom, typed-in location has no id and therefore no surcharge. That is
 * deliberate: we cannot price a place we have never heard of, and inventing a
 * fee for it would be worse than agreeing it in the messages afterwards.
 */
export function locationSurchargeUzs(
  locationId: string | null | undefined,
  durationMinutes: number,
): number {
  const location = getLocation(locationId);
  if (!location || location.surchargePerHourUzs <= 0) return 0;
  const hours = Math.max(1, Math.ceil(durationMinutes / 60));
  return hours * location.surchargePerHourUzs;
}

// ─── More than one place in a session ─────────────────────

/**
 * How many locations a session covers before moving between them starts
 * costing anything.
 *
 * Two is the honest number: a graduation session that starts on campus and
 * finishes in a studio is one shoot with a walk in the middle. A third means
 * packing up, travelling and setting up again, which is time that comes out of
 * the shoot rather than being added to it.
 */
export const INCLUDED_LOCATIONS = 2;

/** Hard ceiling. Past this it is not one session, it is two bookings. */
export const MAX_LOCATIONS = 3;

/**
 * ── Also Marshall's to set ───────────────────────────────────
 * What each location beyond the second adds. 50 000 so'm is a placeholder for
 * the travel and the setup, and like the studio rate it should be a number you
 * chose rather than one that survived.
 */
export const EXTRA_LOCATION_FEE_UZS = 50_000;

export interface LocationCost {
  /** Studio hire and anything else charged by the venue itself. */
  venueUzs: number;
  /** Locations beyond INCLUDED_LOCATIONS, at EXTRA_LOCATION_FEE_UZS each. */
  extraLocationUzs: number;
  extraLocationCount: number;
  totalUzs: number;
}

/**
 * The full cost of shooting in these places, for a session this long.
 *
 * Venue fees are per location and additive — two studios would be two hires.
 * The extra-location fee is per location past the second, whatever they are.
 * Duplicates are ignored rather than charged twice, because a list that
 * contains the same place twice is a UI bug, not a client's intention.
 */
export function locationsCost(
  locationIds: readonly string[],
  durationMinutes: number,
): LocationCost {
  const unique = [...new Set(locationIds.filter(Boolean))];

  const venueUzs = unique.reduce(
    (sum, id) => sum + locationSurchargeUzs(id, durationMinutes),
    0,
  );
  const extraLocationCount = Math.max(0, unique.length - INCLUDED_LOCATIONS);
  const extraLocationUzs = extraLocationCount * EXTRA_LOCATION_FEE_UZS;

  return {
    venueUzs,
    extraLocationUzs,
    extraLocationCount,
    totalUzs: venueUzs + extraLocationUzs,
  };
}

/** True when this location costs extra — the UI uses it to explain itself. */
export function hasSurcharge(locationId: string | null | undefined): boolean {
  const location = getLocation(locationId);
  return !!location && location.surchargePerHourUzs > 0;
}
