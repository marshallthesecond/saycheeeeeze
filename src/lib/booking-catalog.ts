// src/lib/booking-catalog.ts
//
// The bridge between what a service page advertises and what the booking form
// sells. No Supabase, no "server-only" — the API route and a client component
// both import this, and that is the entire point.
//
// ── The bug this exists to close ─────────────────────────────
// There were two independent price lists. `services.ts` showed a graduation
// visitor "1 hour · 250 000 so'm"; `packages.ts` offered the booking form one
// graduation package at 400 000 for two hours. A click on the first arrived at
// the second, and the price a client had just read was not the price they were
// asked to confirm. Nothing errored. It simply quoted the wrong number.
//
// ── Why this reads services.ts rather than the database ──────
// I originally proposed seeding these packages into the `packages` table so the
// server could look their prices up. Having read packages.server.ts, that is
// the worse option HERE, and the reason is the bug above: a database copy of a
// price that also lives in code is a second source of truth, and a second
// source of truth is what we are removing. The seed step would be one forgotten
// command away from reintroducing exactly this class of mismatch.
//
// Importing services.ts on both sides makes drift impossible instead of
// unlikely: the module that renders the price is the module that validates it,
// compiled into the same deployment.
//
// What this costs is live price editing — changing 400 000 now means an edit
// and a deploy rather than a row update. For a solo photographer already
// editing services.ts by hand that is not a real loss, and the `packages` table
// still backs the four generic session packages for every service whose tiers
// are not individually bookable. If live editing ever matters more than
// guaranteed consistency, this file is the one place that has to change.

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
  /** ServicePackage.id — stable, and what the client sends to the server. */
  id: string;
  serviceSlug: string;
  serviceTitle: Localized;
  /** Which group it came from ("At campus"), when the service uses groups. */
  groupKey: string | null;
  groupTitle: Localized | null;
  /**
   * Only where the WORD matters ("Full day"). Everything else renders from
   * durationMinutes — see service-format. The form and the API route both call
   * packageDuration(), so neither carries a stale English copy of the length.
   */
  duration?: Localized;
  durationMinutes: number;
  photos: PhotoCount;
  delivery: DeliverySpec;
  priceUzs: number;
  highlight: boolean;
  perks: Localized[];
  note: Localized | null;
  /**
   * The locations this kind of session happens in, in order. The first is
   * preselected; the rest are the short list the form offers. Empty means the
   * form shows everything, which is the right default for a service that has
   * not said where it works.
   */
  locationIds: string[];
  /** Head count question, when the package wants one. Never a price input. */
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
 * Every individually bookable tier a service offers, in display order.
 *
 * Empty for a service whose packages have no `id` — those are marketing tiers,
 * and their pages still route through SERVICE_TO_PACKAGE to the generic session
 * packages exactly as before. Adding an id is what makes a tier real.
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
