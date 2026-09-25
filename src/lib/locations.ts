// Where a session happens and what that adds to the bill.
//
// Not server-only: the booking form displays these prices and the API route
// re-checks them, and both reading the same list is what stops a surcharge
// being shown but not charged.
//
// Labels live in the dictionaries under `book.loc.<id>.*`. Only ids and money
// here, so renaming a place never touches pricing.

/** A studio is hired by the hour, so its cost follows the session length. */
export interface BookingLocation {
  id: string;
  /** Per hour, rounded up. Zero for anywhere outdoors or on a campus. */
  surchargePerHourUzs: number;
  /**
   * Quoted by hand, so the form shows no number and the total stays the
   * package price. The client is told to ask rather than shown a figure that
   * would be wrong.
   *
   * This is NOT "free". It is "we don't know yet" — different thing, and the
   * dictionary line `book.loc.<id>.consult` is what says so.
   */
  consultFirst?: boolean;
  /**
   * Only offered when the chosen package names it, or when it is already
   * selected. Keeps a venue that belongs to exactly one product out of
   * everybody else's list — Panorama is the graduation ceremony's hall, and a
   * portrait client had no business being offered it.
   *
   * Still priceable and still labelled, so historical bookings read correctly.
   */
  restricted?: boolean;
}

export const BOOKING_LOCATIONS: BookingLocation[] = [
  { id: "wiut", surchargePerHourUzs: 0 },
  // The WIUT ceremony is held here, not on campus. Ceremony packages only.
  { id: "panorama", surchargePerHourUzs: 0, restricted: true },
  // The CCA mini-sessions happen here and nothing else does.
  { id: "cca", surchargePerHourUzs: 0, restricted: true },
  // Hire is arranged per studio and per hour and Marshall does not have one
  // rate. The 100 000/hr that used to sit here was a placeholder being charged
  // to real clients on the total line, which is worse than no number at all.
  { id: "studio", surchargePerHourUzs: 0, consultFirst: true },
  { id: "botanical", surchargePerHourUzs: 0 },
  { id: "lokomotiv", surchargePerHourUzs: 0 },
  { id: "city", surchargePerHourUzs: 0 },
];

/** Places a client may pick without being sent there by their package. */
export function openLocations(): BookingLocation[] {
  return BOOKING_LOCATIONS.filter((l) => !l.restricted);
}

/** Does this location need a word with the photographer before it has a price? */
export function needsConsult(id: string | null | undefined): boolean {
  return getLocation(id)?.consultFirst === true;
}

export function getLocation(id: string | null | undefined): BookingLocation | undefined {
  if (!id) return undefined;
  return BOOKING_LOCATIONS.find((l) => l.id === id);
}

/**
 * What a location adds for a session of this length.
 *
 * Rounded up: a studio bills the hour you are in, not the 90 minutes you
 * booked. A typed-in custom location has no id, so no surcharge.
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

/** Locations covered before moving between them starts costing anything. */
export const INCLUDED_LOCATIONS = 2;

/** Past this it is not one session, it is two bookings. */
export const MAX_LOCATIONS = 3;

// TODO(marshall): 50 000 for the third location is a placeholder too.
export const EXTRA_LOCATION_FEE_UZS = 50_000;

export interface LocationCost {
  /** Studio hire and anything else the venue itself charges. */
  venueUzs: number;
  extraLocationUzs: number;
  extraLocationCount: number;
  totalUzs: number;
}

/**
 * Cost of shooting in these places for a session this long.
 *
 * Venue fees are per location and additive. Duplicates are ignored rather than
 * charged twice — a repeated id is a UI bug, not a client's intention.
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

/**
 * True when this location costs extra, so the UI can say so.
 *
 * Takes a location ID. The booking route also calls it on the free-text box to
 * stop someone typing their way out of the studio fee, which catches the exact
 * string "studio" and nothing else — not "Studio 21", not "студия". That is
 * deliberate rather than thorough: nothing here charges a card, every booking
 * is confirmed by hand, and the price is corrected then. Do not read the call
 * site as a guarantee.
 */
export function hasSurcharge(locationId: string | null | undefined): boolean {
  const location = getLocation(locationId);
  return !!location && location.surchargePerHourUzs > 0;
}
