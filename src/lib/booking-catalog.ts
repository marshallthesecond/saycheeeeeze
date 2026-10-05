// What a service page advertises, in the shape the booking form needs.
//
// Deliberately not server-only: the API route and the form both import it, so
// there is one price list instead of two that disagree. Prices stay in
// services.ts rather than the database for the same reason — the cost is that
// changing one needs a deploy.

// One-off events. mini-sessions.ts takes only the CatalogItem TYPE back from
// here, with `import type`, so this pair is not a runtime cycle.
import { miniCatalog } from "./mini-sessions";
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
 *
 * MEMOISED, and the reason is not micro-optimisation. `servicesData` is a
 * frozen module-level literal, so the answer for a slug can never change
 * within a process — but this used to run a `.find` over every service and
 * rebuild every CatalogItem object on EVERY call, and findCatalogItem() below
 * called it once per service per lookup. The booking form calls
 * findCatalogItem() during render, so a visitor arriving on
 * `/book?package=portraits-90m` rebuilt the entire catalogue of four services
 * on every keystroke they typed into the name field.
 *
 * Returning the cached array also makes the result REFERENTIALLY STABLE, which
 * is what lets `useMemo` and `React.memo` in the form actually hold.
 */
const serviceCache = new Map<string, CatalogItem[]>();

export function catalogForService(slug: string): CatalogItem[] {
  const hit = serviceCache.get(slug);
  if (hit) return hit;

  const built = buildCatalogForService(slug);
  serviceCache.set(slug, built);
  return built;
}

function buildCatalogForService(slug: string): CatalogItem[] {
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
 * Twelve services were removed on 2026-10-06, and their thirty tier ids went
 * with them. The ids did not stop existing — they are written into `bookings`
 * rows, into Telegram messages and into whatever links are still in someone's
 * history.
 *
 * Nothing BREAKS without this map: both the status route and the Telegram
 * webhook read `packageName` off the stored row rather than re-resolving it, so
 * confirming or declining an old booking never touches the catalogue. What the
 * map buys is the live case — a `/book?package=individual-portraits-90m` link
 * lands on the form with the right tier selected instead of silently nothing.
 *
 * The retired services all priced through `standardTiers()`, and so do the ones
 * they map to, so `-1h` / `-90m` / `-150m` are the same duration and the same
 * money either side. That is what makes a rewrite honest rather than a guess;
 * check it before adding a row here.
 *
 * Keep in step with the redirects in next.config.ts, which send the PAGES to
 * the same places.
 */
const RETIRED_SERVICES: Record<string, string> = {
  "individual-portraits": "portraits",
  "pair-group": "portraits",
  "family-portraits": "portraits",
  "business-portraits": "portraits",
  "photowalk-tashkent": "portraits",
  "newborn-maternity": "portraits",
  "uzb-national": "portraits",
  "creative-photography": "portraits",
  "social-media-content": "brand-product",
  "fashion-streetstyle": "brand-product",
  // wedding-love-story and events-corporate had `{ bookable: false }` and
  // therefore no ids at all. They only need the page redirect.
};

/** `individual-portraits-90m` -> `portraits-90m`, or undefined. */
function rewriteRetiredId(id: string): string | undefined {
  for (const [from, to] of Object.entries(RETIRED_SERVICES)) {
    if (id.startsWith(`${from}-`)) return `${to}-${id.slice(from.length + 1)}`;
  }
  return undefined;
}

/**
 * One tier by id, across every service, the one-off events and the generic
 * ladder.
 *
 * This is the function the API route prices a booking with, so anything the
 * form can offer MUST be findable here or the booking is rejected with
 * "package". That is why the mini-sessions are checked too: they have no
 * service page and would otherwise be unpriceable.
 *
 * The generic ids are checked LAST and by exact match, so a service that ever
 * takes the slug "session" shadows nothing. Retired ids are checked after
 * those, so a live tier always wins over a rewritten one.
 */
let liveIndex: Map<string, CatalogItem> | null = null;

/**
 * One id -> tier index, built once.
 *
 * Insertion order is the resolution order the doc comment above promises, and
 * `Map.set` keeps the FIRST writer when guarded — so services win over the
 * event, and the event over the generic ladder, exactly as the sequential
 * version did. Spelt out with an explicit `has` check rather than relying on
 * insertion order, because `set` overwrites and the quiet version of this bug
 * is a generic `session-90m` shadowing a real service tier.
 */
function buildLiveIndex(): Map<string, CatalogItem> {
  const index = new Map<string, CatalogItem>();
  const add = (item: CatalogItem) => {
    if (!index.has(item.id)) index.set(item.id, item);
  };
  for (const service of servicesData) for (const item of catalogForService(service.slug)) add(item);
  for (const item of miniCatalog()) add(item);
  for (const item of genericCatalog()) add(item);
  return index;
}

function findLiveItem(id: string): CatalogItem | undefined {
  liveIndex ??= buildLiveIndex();
  return liveIndex.get(id);
}

export function findCatalogItem(id: string): CatalogItem | undefined {
  const live = findLiveItem(id);
  if (live) return live;

  // Exactly one hop, by construction rather than by comment: the rewritten id
  // goes to findLiveItem, not back through here, so a retired slug pointing at
  // another retired slug resolves to nothing instead of looping for ever.
  const rewritten = rewriteRetiredId(id);
  return rewritten ? findLiveItem(rewritten) : undefined;
}

/** Is this id something the catalogue can price? */
export function isCatalogPackage(id: string | null | undefined): boolean {
  return !!id && findCatalogItem(id) !== undefined;
}
