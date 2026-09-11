// src/lib/booking-price.ts
//
// One function turns a booking into money, and both sides call it.
//
// ── Why one function and not two ─────────────────────────────
// The route's security model is that the CLIENT NEVER SENDS A PRICE: it sends a
// package id, the server looks up what that costs, and a mismatch is a 409. That
// only works while both sides agree on the arithmetic. Two implementations of
// "base plus studio hire" that drift by a rounding rule do not produce a
// security hole — they produce something worse for a small business, which is a
// booking form that rejects real customers with "the price changed" and no way
// for them to get past it.
//
// So: one implementation, imported by the form and by the route. If it is
// wrong, it is wrong in both places and the 409 never fires spuriously.

import { findCatalogItem } from "./booking-catalog";
import { locationsCost } from "./locations";
import { getPackage, priceFor, type SessionPackage } from "./packages";

export interface BookingQuote {
  packageId: string;
  /** Which list the package came from — the catalogue, or the four generics. */
  source: "catalog" | "session";
  durationMinutes: number;
  basePriceUzs: number;
  /** Only the generic session packages charge per head. */
  extraPeopleUzs: number;
  extraPeople: number;
  /** Studio hire and any other venue fee, summed across the locations. */
  locationSurchargeUzs: number;
  /** Locations beyond the two included, at the flat per-location fee. */
  extraLocationUzs: number;
  extraLocationCount: number;
  totalUzs: number;
}

export interface QuoteInput {
  packageId: string | null | undefined;
  /** The DB-backed generic packages, for services with no per-tier ids. */
  sessionPackages: SessionPackage[];
  peopleCount: number | null | undefined;
  /** Every place the session covers. One entry is the ordinary case. */
  locationIds: readonly string[];
}

/**
 * Returns null when the package id resolves to nothing at all — an unknown id
 * must never be priced at zero and quietly booked.
 *
 * The catalogue is consulted FIRST. A service tier and a generic package could
 * in principle share an id; if that ever happens the specific one should win,
 * because it is the one the client was looking at.
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
      // Catalogue tiers price the session, not the heads in it — the graduation
      // group package is one price whether three or five people turn up. Its
      // head count is recorded for planning and never multiplies anything.
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
