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
}

// TODO(marshall): 100 000/hr for the studio is a placeholder, not a real rate.
export const BOOKING_LOCATIONS: BookingLocation[] = [
  { id: "wiut", surchargePerHourUzs: 0 },
  // The WIUT ceremony is held here, not on campus.
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

/** True when this location costs extra, so the UI can say so. */
export function hasSurcharge(locationId: string | null | undefined): boolean {
  const location = getLocation(locationId);
  return !!location && location.surchargePerHourUzs > 0;
}
