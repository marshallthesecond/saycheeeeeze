// What a service page advertises, in the shape the booking form needs.
//
// Deliberately not server-only: the API route and the form both import it, so
// there is one price list instead of two that disagree. Prices stay in
// services.ts rather than the database for the same reason — the cost is that
// changing one needs a deploy.

import {
  allPackages,
  servicesData,
  standardTiers,
  type DeliverySpec,
  type Localized,
  type PhotoCount,
  type ServiceData,
  type ServicePackage,
} from "./services";

/** One bookable tier, with enough context to describe itself on the form. */
export interface CatalogItem {
  /** ServicePackage.id — what the client sends to the server. */
  id: string;
  serviceSlug: string;
  serviceTitle: Localized;
  /** The group it came from ("At campus"), when the service uses groups. */
  groupKey: string | null;
  groupTitle: Localized | null;
  /** Only where the word matters ("Full day"); else from durationMinutes. */
  duration?: Localized;
  durationMinutes: number;
  photos: PhotoCount;
  delivery: DeliverySpec;
  priceUzs: number;
  highlight: boolean;
  perks: Localized[];
  note: Localized | null;
  /** First is preselected, rest are the short list; empty means offer all. */
  locationIds: string[];
  /** Never a price input — the group tier is one price at any head count. */
  asksPeople: { min: number; max: number } | null;
}

function toItem(
  service: ServiceData,
  pkg: ServicePackage,
  groupKey: string | null,
  groupTitle: Localized | null,
  locationIds: string[],
): CatalogItem {
  return {
    id: pkg.id as string,
    serviceSlug: service.slug,
    serviceTitle: service.title,
    groupKey,
    groupTitle,
    duration: pkg.duration,
    durationMinutes: pkg.durationMinutes,
    photos: pkg.photos,
    delivery: pkg.delivery,
    priceUzs: pkg.priceUzs,
    highlight: pkg.highlight ?? false,
    perks: pkg.perks ?? [],
    note: pkg.note ?? null,
    locationIds,
    asksPeople: pkg.asksPeople ?? null,
  };
}

/**
 * The ladder for a visitor with no service in mind.
 *
 * /book reached from the navigation used to offer the four generic packages
 * out of the `packages` table — 400k, 800k, 1.2M, 1.6M. After every service
 * page moved to one ladder, those were four prices that existed nowhere else
 * on the site, shown to exactly the visitor least equipped to notice. Someone
 * arriving from a service page saw 250/400/700; someone arriving from the menu
 * saw 800 000 for the same ninety minutes.
 *
 * Built by the SAME standardTiers() the fifteen services call, so it is not a
 * copy that agrees today — it is the same three numbers.
 *
 * `session-*` ids are written into bookings rows, so they are permanent. The
 * four DB packages are still PRICEABLE — quoteBooking falls through to them and
 * the route still accepts their ids, so a bookmarked link or an old Telegram
 * message keeps working — they are simply no longer OFFERED.
 */
const GENERIC_TITLE: Localized = {
  en: "Photo session",
  ru: "\u0424\u043e\u0442\u043e\u0441\u0435\u0441\u0441\u0438\u044f",
  uz: "Fotosessiya",
};

let genericCache: CatalogItem[] | null = null;

export function genericCatalog(): CatalogItem[] {
  if (genericCache) return genericCache;
  genericCache = standardTiers("session").map((pkg) => ({
    id: pkg.id as string,
    serviceSlug: "session",
    serviceTitle: GENERIC_TITLE,
    groupKey: null,
    groupTitle: null,
    duration: pkg.duration,
    durationMinutes: pkg.durationMinutes,
    photos: pkg.photos,
    delivery: pkg.delivery,
    priceUzs: pkg.priceUzs,
    highlight: pkg.highlight ?? false,
    perks: pkg.perks ?? [],
    note: pkg.note ?? null,
    // No suggested places: a visitor who has not picked a service has not told
    // us anything about where the shoot happens, so the full list is right.
    locationIds: [],
    asksPeople: pkg.asksPeople ?? null,
  }));
  return genericCache;
}

/**
 * Every individually bookable tier, in display order. Empty when a service's
 * packages have no `id` — those are marketing tiers and still route through
 * SERVICE_TO_PACKAGE. Adding an id is what makes a tier bookable.
 */
export function catalogForService(slug: string): CatalogItem[] {
  const service = servicesData.find((s) => s.slug === slug);
  if (!service) return [];

  if (service.packageGroups?.length) {
    return service.packageGroups.flatMap((g) =>
      g.packages
        .filter((p) => p.id)
        .map((p) => toItem(service, p, g.key, g.title, g.locationIds ?? [])),
    );
  }
  return allPackages(service)
    .filter((p) => p.id)
    .map((p) => toItem(service, p, null, null, []));
}

/**
 * One tier by id, across every service and the generic ladder.
 *
 * The generic ids are checked LAST and by exact match, so a service that ever
 * takes the slug "session" shadows nothing.
 */
export function findCatalogItem(id: string): CatalogItem | undefined {
  for (const service of servicesData) {
    const found = catalogForService(service.slug).find((i) => i.id === id);
    if (found) return found;
  }
  return genericCatalog().find((i) => i.id === id);
}

/** Is this id something the catalogue can price? */
export function isCatalogPackage(id: string | null | undefined): boolean {
  return !!id && findCatalogItem(id) !== undefined;
}
