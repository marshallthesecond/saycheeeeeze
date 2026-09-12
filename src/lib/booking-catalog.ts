// What a service page advertises, in the shape the booking form needs.
//
// Deliberately not server-only: the API route and the form both import it, so
// there is one price list instead of two that disagree. Prices stay in
// services.ts rather than the database for the same reason — the cost is that
// changing one needs a deploy.

import {
  allPackages,
  servicesData,
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

/** One tier by id, across every service. */
export function findCatalogItem(id: string): CatalogItem | undefined {
  for (const service of servicesData) {
    const found = catalogForService(service.slug).find((i) => i.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Is this id something the catalogue can price? */
export function isCatalogPackage(id: string | null | undefined): boolean {
  return !!id && findCatalogItem(id) !== undefined;
}
