// One function turns a booking into money, and both sides call it.
//
// The route's security model is that the client never sends a price: it sends
// a package id and the server looks up what that costs. That only works while
// both sides agree on the arithmetic, so the form and the route import this.
// Two implementations differing by a rounding rule would produce a booking
// form that rejects real customers with "the price changed".

import { findCatalogItem } from "./booking-catalog";
import { locationsCost } from "./locations";
import { getPackage, priceFor, type SessionPackage } from "./packages";

export interface BookingQuote {
  packageId: string;
  /** Which list it came from — the catalogue, or the four generics. */
  source: "catalog" | "session";
  durationMinutes: number;
  basePriceUzs: number;
  /** Only the generic session packages charge per head. */
  extraPeopleUzs: number;
  extraPeople: number;
  /** Studio hire and any other venue fee, across all locations. */
  locationSurchargeUzs: number;
  /** Locations beyond the two included, at the flat per-location fee. */
  extraLocationUzs: number;
  extraLocationCount: number;
  totalUzs: number;
}

export interface QuoteInput {
  packageId: string | null | undefined;
  /** DB-backed generics, for services with no per-tier ids. */
  sessionPackages: SessionPackage[];
  peopleCount: number | null | undefined;
  locationIds: readonly string[];
}

/**
 * Null when the id resolves to nothing — an unknown id must never be priced at
 * zero and quietly booked.
 *
 * The catalogue wins over the generics if an id somehow appears in both, since
 * the catalogue is what the client was looking at.
 */
export function quoteBooking(input: QuoteInput): BookingQuote | null {
  const { packageId, sessionPackages, peopleCount, locationIds } = input;
  if (!packageId) return null;

  const item = findCatalogItem(packageId);
  if (item) {
    const places = locationsCost(locationIds, item.durationMinutes);
    return {
      packageId,
      source: "catalog",
      durationMinutes: item.durationMinutes,
      basePriceUzs: item.priceUzs,
      // Catalogue tiers price the session, not the heads in it. The graduation
      // group package is one price whether three or five people turn up; its
      // head count is for planning and multiplies nothing.
      extraPeopleUzs: 0,
      extraPeople: 0,
      locationSurchargeUzs: places.venueUzs,
      extraLocationUzs: places.extraLocationUzs,
      extraLocationCount: places.extraLocationCount,
      totalUzs: item.priceUzs + places.totalUzs,
    };
  }

  const pkg = getPackage(sessionPackages, packageId);
  if (!pkg) return null;

  const breakdown = priceFor(pkg, peopleCount ?? null);
  const places = locationsCost(locationIds, pkg.durationMinutes);
  return {
    packageId,
    source: "session",
    durationMinutes: pkg.durationMinutes,
    basePriceUzs: breakdown.basePriceUzs,
    extraPeopleUzs: breakdown.extraPriceUzs,
    extraPeople: breakdown.extraPeople,
    locationSurchargeUzs: places.venueUzs,
    extraLocationUzs: places.extraLocationUzs,
    extraLocationCount: places.extraLocationCount,
    totalUzs: breakdown.totalUzs + places.totalUzs,
  };
}
