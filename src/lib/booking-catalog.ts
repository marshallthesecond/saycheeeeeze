// What a service page advertises, in the shape the booking form needs.
//
// Deliberately not server-only: the API route and the form both import it, so
// there is one price list instead of two that disagree.
//
// Prices are in services.ts, and since the Studio's Services tab
// (2026-11-20) also in what was published there. createCatalog() builds a
// catalogue from a list of services: the route builds one from
// getLiveServices(), the form from the same overlay handed down by its page.
// The functions exported at the bottom are the code-only catalogue, for what
// does not need the Studio's prices.

// One-off events. mini-sessions.ts takes only the CatalogItem TYPE back from
// here, with `import type`, so this pair is not a runtime cycle.
import { miniPriceableItems } from "./mini-sessions";
import {
  allPackages,
  offeredGroups,
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
  /** The Studio's name for it, when it has one. See ServicePackage.name. */
  name?: Localized;
  /** The Studio's sentence about it. */
  description?: Localized;
  /** First is preselected, rest are the short list; empty means offer all. */
  locationIds: string[];
  /**
   * The head counts this tier accepts. On its own it is NOT a price input —
   * the graduation group tier is one price whether three or five people turn
   * up, and the stepper is there so the shoot can be planned.
   *
   * It becomes a price input only when `pricePerPeople` is set beside it.
   */
  asksPeople: { min: number; max: number } | null;
  /**
   * TOTAL price for a given head count, when the head count IS the price.
   *
   * The mini-sessions sell 170 000 solo, 250 000 for two and 330 000 for
   * three — not a base plus a per-head extra, which is why this is a table of
   * totals rather than a multiplier. Trying to express "250 000 for two" as
   * base + extra means inventing a per-head figure that appears nowhere on
   * Marshall's price list and rounding it back on the way out.
   *
   * Keys must cover every value `asksPeople` allows; `priceUzs` stays the
   * cheapest of them, so a tier with no head count chosen still quotes.
   * quoteBooking() in booking-price.ts is the only thing that reads this, so
   * the form and the API route cannot disagree about the arithmetic.
   */
  pricePerPeople?: Record<number, number>;
  /**
   * WITHDRAWN. Still priceable, no longer sellable — and the gap between
   * those two words is the whole reason this field exists.
   *
   * findCatalogItem() deliberately resolves a retired tier: `package_id` is
   * written permanently into `bookings` rows, so an existing booking has to
   * stay nameable and an old `/book?package=…` link has to stay priceable.
   * But "the catalogue can price it" was also, until this flag, "the API
   * route will accept it" — so a hand-made POST could still buy a thing that
   * had been taken off the shelf.
   *
   * Two live cases. The ceremony-day graduation tiers, withdrawn on
   * 2026-10-15 while 22 October was still a week in the FUTURE — the date
   * validation that quietly protects a finished mini-session does nothing
   * here. And the retired mini-session tiers, which had the same hole in
   * theory and were only ever saved by their dates having passed.
   *
   * Required, not optional, so the compiler enumerates every place a
   * CatalogItem is built rather than letting one be forgotten.
   */
  retired: boolean;
}

function toItem(
  service: ServiceData,
  pkg: ServicePackage,
  groupKey: string | null,
  groupTitle: Localized | null,
  locationIds: string[],
  retired = false,
): CatalogItem {
  return {
    retired,
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
    ...(pkg.name !== undefined ? { name: pkg.name } : {}),
    ...(pkg.description !== undefined ? { description: pkg.description } : {}),
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
    retired: false,
  }));
  return genericCache;
}

/** A price list built from one set of services. */
export interface Catalog {
  /**
   * Every individually bookable tier of a service, in display order: retired
   * groups and packages left out, and nothing at all for a service turned off
   * in the Studio. Referentially stable per slug, which is what lets `useMemo`
   * and `React.memo` in the form hold.
   */
  catalogForService(slug: string): CatalogItem[];
  /**
   * One tier by id, across every service, the one-off events and the generic
   * ladder, retired or not (`retired` on the item says which).
   */
  findCatalogItem(id: string): CatalogItem | undefined;
  isCatalogPackage(id: string | null | undefined): boolean;
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
 * Every tier of a service, offered or (with includeRetired) withdrawn too.
 *
 * A service turned off in the Studio offers nothing, and every one of its
 * tiers is retired: still priceable, so its bookings keep their name, and
 * refused by the API route as new ones.
 */
function buildForService(service: ServiceData, opts: { includeRetired: boolean }): CatalogItem[] {
  const off = service.off === true;
  if (off && !opts.includeRetired) return [];

  if (service.packageGroups?.length) {
    const groups = opts.includeRetired ? service.packageGroups : offeredGroups(service);
    return groups.flatMap((g) =>
      g.packages
        .filter((p) => p.id && (opts.includeRetired || !p.retired))
        .map((p) =>
          toItem(service, p, g.key, g.title, g.locationIds ?? [], off || g.retired === true || p.retired === true),
        ),
    );
  }
  return allPackages(service)
    .filter((p) => p.id && (opts.includeRetired || !p.retired))
    .map((p) => toItem(service, p, null, null, [], off || p.retired === true));
}

/**
 * A catalogue for these services.
 *
 * Every answer is MEMOISED, and the reason is not micro-optimisation. The
 * booking form calls findCatalogItem() during render, so without it a visitor
 * arriving on `/book?package=portraits-90m` rebuilt the entire catalogue on
 * every keystroke they typed into the name field. A catalogue is built for one
 * list of services and never sees another, so nothing it caches goes stale.
 */
export function createCatalog(services: readonly ServiceData[]): Catalog {
  const bySlug = new Map(services.map((s) => [s.slug, s]));
  const offered = new Map<string, CatalogItem[]>();

  const catalogForService = (slug: string): CatalogItem[] => {
    const hit = offered.get(slug);
    if (hit) return hit;
    const service = bySlug.get(slug);
    const built = service ? buildForService(service, { includeRetired: false }) : [];
    offered.set(slug, built);
    return built;
  };

  /**
   * One id -> tier index, built once.
   *
   * Insertion order is the resolution order: services win over the event, and
   * the event over the generic ladder. Spelt out with an explicit `has` check
   * rather than relying on insertion order, because `set` overwrites and the
   * quiet version of this bug is a generic `session-90m` shadowing a real
   * service tier. The generic ids are checked LAST and by exact match, so a
   * service that ever takes the slug "session" shadows nothing.
   */
  let index: Map<string, CatalogItem> | null = null;
  const buildIndex = (): Map<string, CatalogItem> => {
    const out = new Map<string, CatalogItem>();
    const add = (item: CatalogItem) => {
      if (!out.has(item.id)) out.set(item.id, item);
    };
    // includeRetired: a withdrawn tier must stay resolvable so its bookings
    // can still be named and an old link still prices. `retired` on the item
    // is what stops it being SOLD again.
    for (const service of services) for (const item of buildForService(service, { includeRetired: true })) add(item);
    // miniPriceableItems(), not miniCatalog(): a finished event's tier must stay
    // priceable so its bookings can still be named and an old link still works.
    for (const item of miniPriceableItems()) add(item);
    for (const item of genericCatalog()) add(item);
    return out;
  };
  const findLive = (id: string) => (index ??= buildIndex()).get(id);

  /**
   * This is what the API route prices a booking with, so anything the form
   * can offer MUST be findable here or the booking is rejected with "package".
   * Retired service ids are tried after everything else, so a live tier always
   * wins over a rewritten one.
   */
  const findCatalogItem = (id: string): CatalogItem | undefined => {
    const live = findLive(id);
    if (live) return live;
    // Exactly one hop, by construction rather than by comment: the rewritten
    // id goes to findLive, not back through here, so a retired slug pointing
    // at another retired slug resolves to nothing instead of looping for ever.
    const rewritten = rewriteRetiredId(id);
    return rewritten ? findLive(rewritten) : undefined;
  };

  return {
    catalogForService,
    findCatalogItem,
    isCatalogPackage: (id) => !!id && findCatalogItem(id) !== undefined,
  };
}

/**
 * The catalogue of the code alone, before anything published in the Studio.
 * For callers that only need a tier's identity, not its current price.
 */
export const codeCatalog: Catalog = createCatalog(servicesData);

export function catalogForService(slug: string): CatalogItem[] {
  return codeCatalog.catalogForService(slug);
}

export function findCatalogItem(id: string): CatalogItem | undefined {
  return codeCatalog.findCatalogItem(id);
}

export function isCatalogPackage(id: string | null | undefined): boolean {
  return codeCatalog.isCatalogPackage(id);
}
