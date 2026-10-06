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
  /** Only the generic session packages charge a per-head EXTRA. */
  extraPeopleUzs: number;
  extraPeople: number;
  /**
   * The head count this quote was priced at, when the tier prices by it.
   * Null when the head count buys nothing, which is every other tier.
   */
  pricedForPeople: number | null;
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
 * Which head count a tier is priced at.
 *
 * THE DEFAULT LIVES HERE, not in the booking form. The form will not let a
 * client past step one without answering when the count decides the price, so
 * a real booking always carries a number — but the form still needs a figure
 * for the price bar before they have chosen, and the route re-quotes every
 * booking on submit. One function deciding the fallback is what stops those
 * three readings diverging into a route that answers an ordinary booking with
 * "the price changed".
 *
 * Out-of-range counts are CLAMPED rather than rejected. The route validates
 * head counts only for the generic session packages, so a hand-made request
 * can carry any number at all — and clamping 99 to the three-person price
 * fails in the direction that cannot be used to underpay. A real booking is
 * confirmed by hand anyway, where a wrong number is a conversation.
 */
function headCountFor(
  item: { asksPeople: { min: number; max: number } | null },
  peopleCount: number | null | undefined,
): number | null {
  if (!item.asksPeople) return null;
  const { min, max } = item.asksPeople;
  const n = Number(peopleCount);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
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
    const heads = headCountFor(item, peopleCount);
    // Catalogue tiers price the SESSION, not the heads in it — the graduation
    // group package is one price whether three or five people turn up. The
    // exception is a tier carrying a pricePerPeople table, where the head
    // count is the product: a mini-session for two is not a mini-session for
    // one with someone added, it is a different line on the price list.
    const base =
      (heads !== null ? item.pricePerPeople?.[heads] : undefined) ?? item.priceUzs;
    return {
      packageId,
      source: "catalog",
      durationMinutes: item.durationMinutes,
      basePriceUzs: base,
      // Still zero: this is a per-head EXTRA on top of a base, which is a
      // different thing from a price that varies BY head count. Reporting the
      // difference here would make the summary show "Base 170 000 / Extra
      // people 80 000" for a duo, which is not what was sold.
      extraPeopleUzs: 0,
      extraPeople: 0,
      pricedForPeople: item.pricePerPeople ? heads : null,
      locationSurchargeUzs: places.venueUzs,
      extraLocationUzs: places.extraLocationUzs,
      extraLocationCount: places.extraLocationCount,
      totalUzs: base + places.totalUzs,
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
    pricedForPeople: null,
    locationSurchargeUzs: places.venueUzs,
    extraLocationUzs: places.extraLocationUzs,
    extraLocationCount: places.extraLocationCount,
    totalUzs: breakdown.totalUzs + places.totalUzs,
  };
}
