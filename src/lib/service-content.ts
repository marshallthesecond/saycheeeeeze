// What the Studio can change on a service page, and how a change lands on the
// page.
//
// THE CODE IS THE BASE. services.ts still holds every service in full. A
// service edited in the Studio has a row in `service_content` whose
// `published` column is a ServiceContent: the texts, the cover and the
// packages, complete. applyContent() lays it over the code's ServiceData, and
// everything that reads services (the page, Home, the sitemap, the booking
// form and the server that prices a booking) reads the result. No row, or a
// row that fails parseContent(), and the code's version is what shows.
//
// Only what the Studio edits is in here. Icons, accent colours, the graduation
// event and audience switch, keywords and the rest stay in the code.
//
// Client-safe: the booking form applies the same overlay in the browser, so
// the prices it shows are the prices the server charges.

import {
  allPackages,
  offeredGroups,
  type Localized,
  type ServiceData,
  type ServicePackage,
} from "./services";

export const LANGS = ["en", "ru", "uz"] as const;
export type Lang = (typeof LANGS)[number];
/** One text in all three languages. "" is not written yet. */
export type Text = Record<Lang, string>;

export interface ContentPackage {
  /** Stable. Written into bookings: never reused, never changed. */
  id: string;
  /** All empty: no name, and the length is the card's title. */
  name: Text;
  /** All empty: none. */
  description: Text;
  minutes: number;
  photosMin: number;
  /** null: "and up". */
  photosMax: number | null;
  /** Working days until the full set. */
  days: number;
  price: number;
  perks: Text[];
  popular: boolean;
  /** Off the page and not bookable, still in the editor. */
  hidden: boolean;
  /** Deleted after it was on the site: kept so old bookings keep their package. */
  deleted: boolean;
}

export interface ContentGroup {
  /** "default" for a service without groups; else the code's group key. */
  key: string;
  title: Text;
  blurb: Text;
  packages: ContentPackage[];
}

export interface ServiceContent {
  v: 1;
  title: Text;
  tagline: Text;
  description: Text;
  includes: Text[];
  prepare: Text[];
  faqs: { q: Text; a: Text }[];
  /** A photo's storage path, and where its subject sits in percent. */
  cover: { path: string; x: number; y: number };
  groups: ContentGroup[];
}

/** One service's state, as the site needs it. */
export interface ServiceOverlayEntry {
  off: boolean;
  /** null: the code's content. */
  content: ServiceContent | null;
}
export type ServiceOverlay = Record<string, ServiceOverlayEntry>;

export const DEFAULT_GROUP = "default";

export const LIMITS = {
  title: 80,
  tagline: 160,
  description: 600,
  item: 240,
  question: 200,
  answer: 1200,
  name: 40,
  packageDescription: 240,
  perk: 120,
  groupTitle: 40,
  groupBlurb: 240,
  path: 400,
  includes: 12,
  prepare: 12,
  faqs: 20,
  /** Per group, deleted ones not counted. */
  packages: 10,
  perks: 10,
  /** Per group, deleted ones included. */
  allPackages: 60,
  minutes: { min: 15, max: 720 },
  photos: { min: 1, max: 5000 },
  days: { min: 1, max: 60 },
  price: { min: 1000, max: 1_000_000_000 },
} as const;

/** Where Google cuts a description off. Shown as a guide, not enforced. */
export const SEARCH_DESCRIPTION = 160;

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

export const EMPTY_TEXT: Text = { en: "", ru: "", uz: "" };

/** A code text as three strings. A plain string is the same in all three. */
export function textOf(value: Localized | undefined): Text {
  if (value === undefined) return { ...EMPTY_TEXT };
  if (typeof value === "string") return { en: value, ru: value, uz: value };
  return { en: value.en ?? "", ru: value.ru ?? "", uz: value.uz ?? "" };
}

export function isEmptyText(text: Text): boolean {
  return LANGS.every((l) => text[l].trim() === "");
}

/**
 * Back to a code text. Languages not written yet are left out, so a preview of
 * a half-translated draft falls back to English rather than showing nothing.
 * Undefined when nothing is written at all.
 */
export function toLocalized(text: Text): Localized | undefined {
  const t = { en: text.en.trim(), ru: text.ru.trim(), uz: text.uz.trim() };
  const en = t.en || t.ru || t.uz;
  if (!en) return undefined;
  return { en, ...(t.ru ? { ru: t.ru } : {}), ...(t.uz ? { uz: t.uz } : {}) };
}

const required = (text: Text): Localized => toLocalized(text) ?? "";

// ---------------------------------------------------------------------------
// From the code, onto the code
// ---------------------------------------------------------------------------

/** The photo the page opens with: the darkened ground of a stack hero, else the cover. */
function coverPathOf(service: ServiceData): string {
  return service.hero?.groundPath ?? service.coverPath;
}

function packageFromCode(pkg: ServicePackage, deleted = false): ContentPackage {
  return {
    id: pkg.id as string,
    name: textOf(pkg.name),
    description: textOf(pkg.description),
    minutes: pkg.durationMinutes,
    photosMin: pkg.photos.min,
    photosMax: pkg.photos.max ?? null,
    days: pkg.delivery.days,
    price: pkg.priceUzs,
    perks: (pkg.perks ?? []).map(textOf),
    popular: pkg.highlight === true,
    hidden: pkg.retired === true && !deleted,
    deleted,
  };
}

/**
 * The code's version of a service, as content: what the Studio starts from
 * before anything is published. Pass the code's ServiceData, never one with
 * content applied (a hidden package and a deleted one look the same there).
 *
 * Withdrawn groups (graduation's ceremony coverage) are not in it: they are
 * off the site already and stay as the code has them.
 */
export function contentFromCode(service: ServiceData): ServiceContent {
  const groups: ContentGroup[] = service.packageGroups?.length
    ? offeredGroups(service).map((g) => ({
        key: g.key,
        title: textOf(g.title),
        blurb: textOf(g.blurb),
        packages: g.packages.filter((p) => p.id).map((p) => packageFromCode(p)),
      }))
    : [
        {
          key: DEFAULT_GROUP,
          title: { ...EMPTY_TEXT },
          blurb: { ...EMPTY_TEXT },
          packages: (service.packages ?? []).filter((p) => p.id).map((p) => packageFromCode(p)),
        },
      ];

  return {
    v: 1,
    title: textOf(service.title),
    tagline: textOf(service.tagline),
    description: textOf(service.description),
    includes: service.includes.map(textOf),
    prepare: service.howToPrepare.map(textOf),
    faqs: service.faqs.map((f) => ({ q: textOf(f.question), a: textOf(f.answer) })),
    cover: {
      path: coverPathOf(service),
      x: service.coverFocus?.x ?? 50,
      y: service.coverFocus?.y ?? 50,
    },
    groups,
  };
}

/**
 * The content laid over the code's service.
 *
 * A package keeps what only the code knows (the head-count question, the
 * same-evening preview, the short note after the length) by its id. A package
 * the code has and the content does not is kept as retired: it is off the
 * page, and an old booking still finds it.
 */
export function applyContent(service: ServiceData, content: ServiceContent): ServiceData {
  const codePackages = allPackages(service).filter((p) => p.id);
  const codeById = new Map(codePackages.map((p) => [p.id as string, p]));
  const countsOf = codePackages[0]?.photos.of;

  const toPackage = (p: ContentPackage): ServicePackage => {
    const code = codeById.get(p.id);
    const of = code?.photos.of ?? countsOf;
    return {
      id: p.id,
      // The code's "Full day"-style wording only while the length it describes stands.
      ...(code?.duration !== undefined && code.durationMinutes === p.minutes ? { duration: code.duration } : {}),
      durationMinutes: p.minutes,
      photos: { min: p.photosMin, ...(p.photosMax !== null ? { max: p.photosMax } : {}), ...(of ? { of } : {}) },
      delivery: { days: p.days, ...(code?.delivery.sameDayPreview ? { sameDayPreview: true } : {}) },
      priceUzs: p.price,
      ...(p.popular ? { highlight: true } : {}),
      ...(p.perks.length ? { perks: p.perks.map(required) } : {}),
      ...(code?.note !== undefined ? { note: code.note } : {}),
      ...(code?.asksPeople ? { asksPeople: code.asksPeople } : {}),
      ...(code?.groupSize !== undefined ? { groupSize: code.groupSize } : {}),
      ...(toLocalized(p.name) ? { name: toLocalized(p.name) } : {}),
      ...(toLocalized(p.description) ? { description: toLocalized(p.description) } : {}),
      ...(p.hidden || p.deleted ? { retired: true } : {}),
    };
  };

  const seen = new Set(content.groups.flatMap((g) => g.packages.map((p) => p.id)));
  const leftOver = (pkgs: ServicePackage[]) =>
    pkgs.filter((p) => p.id && !seen.has(p.id)).map((p) => ({ ...p, retired: true }));

  const cover = content.cover.path;
  const out: ServiceData = {
    ...service,
    title: required(content.title),
    tagline: required(content.tagline),
    description: required(content.description),
    includes: content.includes.map(required),
    howToPrepare: content.prepare.map(required),
    faqs: content.faqs.map((f) => ({ question: required(f.q), answer: required(f.a) })),
    coverPath: cover,
    coverFocus: { x: content.cover.x, y: content.cover.y },
    ...(service.hero?.groundPath ? { hero: { ...service.hero, groundPath: cover } } : {}),
  };

  if (service.packageGroups?.length) {
    const byKey = new Map(content.groups.map((g) => [g.key, g]));
    out.packageGroups = service.packageGroups.map((g) => {
      const edited = byKey.get(g.key);
      if (!edited) return g;
      return {
        ...g,
        title: required(edited.title),
        blurb: required(edited.blurb),
        packages: [...edited.packages.map(toPackage), ...leftOver(g.packages)],
      };
    });
  } else {
    out.packages = [
      ...content.groups.flatMap((g) => g.packages.map(toPackage)),
      ...leftOver(service.packages ?? []),
    ];
  }
  return out;
}

/** Every service with its published content and its on/off state applied. */
export function applyOverlay(services: ServiceData[], overlay: ServiceOverlay): ServiceData[] {
  return services.map((service) => {
    const entry = overlay[service.slug];
    if (!entry) return service;
    const applied = entry.content ? applyContent(service, entry.content) : service;
    return entry.off ? { ...applied, off: true } : applied;
  });
}

/**
 * What the editor opens: the draft, else what is published, else the code.
 *
 * A package the code has and the content lacks (one added to services.ts after
 * a Publish) comes in as deleted, where the editor can restore it. The site
 * already treats it as retired.
 */
export function editableContent(
  code: ServiceData,
  published: ServiceContent | null,
  draft: ServiceContent | null,
): ServiceContent {
  const base = draft ?? published;
  if (!base) return contentFromCode(code);

  const have = new Set(base.groups.flatMap((g) => g.packages.map((p) => p.id)));
  const groups = base.groups.map((g) => {
    const codeGroup =
      g.key === DEFAULT_GROUP ? (code.packages ?? []) : (code.packageGroups?.find((x) => x.key === g.key)?.packages ?? []);
    const missing = codeGroup.filter((p) => p.id && !have.has(p.id)).map((p) => packageFromCode(p, true));
    return missing.length ? { ...g, packages: [...g.packages, ...missing] } : g;
  });
  return { ...base, groups };
}

// ---------------------------------------------------------------------------
// Reading what the database holds
// ---------------------------------------------------------------------------

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readText(v: unknown, max: number): Text | null {
  if (!isObj(v)) return null;
  const out = { ...EMPTY_TEXT };
  for (const l of LANGS) {
    const s = v[l];
    if (typeof s !== "string" || s.length > max) return null;
    out[l] = s;
  }
  return out;
}

function readTexts(v: unknown, max: number, count: number): Text[] | null {
  if (!Array.isArray(v) || v.length > count) return null;
  const out: Text[] = [];
  for (const item of v) {
    const t = readText(item, max);
    if (!t) return null;
    out.push(t);
  }
  return out;
}

function readInt(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

function readPackage(v: unknown, slug: string, codeIds: ReadonlySet<string>): ContentPackage | null {
  if (!isObj(v)) return null;
  const id = v.id;
  // Its own service's prefix, or one of the code's ids for this service: a
  // package can never take an id another service's bookings use.
  if (typeof id !== "string" || id.length > 80 || !ID.test(id)) return null;
  if (!codeIds.has(id) && !id.startsWith(`${slug}-`)) return null;

  const name = readText(v.name, LIMITS.name);
  const description = readText(v.description, LIMITS.packageDescription);
  const perks = readTexts(v.perks, LIMITS.perk, LIMITS.perks);
  const minutes = readInt(v.minutes, LIMITS.minutes.max);
  const photosMin = readInt(v.photosMin, LIMITS.photos.max);
  const photosMax = v.photosMax === null ? null : readInt(v.photosMax, LIMITS.photos.max);
  const days = readInt(v.days, LIMITS.days.max);
  const price = readInt(v.price, LIMITS.price.max);
  if (!name || !description || !perks || minutes === null || photosMin === null || days === null || price === null) {
    return null;
  }
  if (v.photosMax !== null && photosMax === null) return null;
  if (typeof v.popular !== "boolean" || typeof v.hidden !== "boolean" || typeof v.deleted !== "boolean") return null;

  return {
    id,
    name,
    description,
    minutes,
    photosMin,
    photosMax,
    days,
    price,
    perks,
    popular: v.popular,
    hidden: v.hidden,
    deleted: v.deleted,
  };
}

/**
 * A ServiceContent for this service, or null if the value is not one: wrong
 * shape, too long, a group the service does not have, an id twice.
 *
 * Lenient about what is merely unfinished (an empty text, a price of 0): a
 * draft may be half done. publishProblems() is what refuses those.
 */
export function parseContent(raw: unknown, service: ServiceData): ServiceContent | null {
  if (!isObj(raw) || raw.v !== 1) return null;

  const title = readText(raw.title, LIMITS.title);
  const tagline = readText(raw.tagline, LIMITS.tagline);
  const description = readText(raw.description, LIMITS.description);
  const includes = readTexts(raw.includes, LIMITS.item, LIMITS.includes);
  const prepare = readTexts(raw.prepare, LIMITS.item, LIMITS.prepare);
  if (!title || !tagline || !description || !includes || !prepare) return null;

  if (!Array.isArray(raw.faqs) || raw.faqs.length > LIMITS.faqs) return null;
  const faqs: ServiceContent["faqs"] = [];
  for (const f of raw.faqs) {
    if (!isObj(f)) return null;
    const q = readText(f.q, LIMITS.question);
    const a = readText(f.a, LIMITS.answer);
    if (!q || !a) return null;
    faqs.push({ q, a });
  }

  const c = raw.cover;
  if (!isObj(c) || typeof c.path !== "string" || c.path.length > LIMITS.path) return null;
  if (c.path.startsWith("/") || c.path.includes("..") || /[\u0000-\u001f]/.test(c.path)) return null;
  const x = readInt(c.x, 100);
  const y = readInt(c.y, 100);
  if (x === null || y === null) return null;

  const codeIds = new Set(allPackages(service).flatMap((p) => (p.id ? [p.id] : [])));
  const keys = service.packageGroups?.length ? new Set(offeredGroups(service).map((g) => g.key)) : new Set([DEFAULT_GROUP]);
  if (!Array.isArray(raw.groups) || raw.groups.length !== keys.size) return null;

  const groups: ContentGroup[] = [];
  const ids = new Set<string>();
  for (const g of raw.groups) {
    if (!isObj(g) || typeof g.key !== "string" || !keys.has(g.key)) return null;
    if (groups.some((x) => x.key === g.key)) return null;
    const gTitle = readText(g.title, LIMITS.groupTitle);
    const gBlurb = readText(g.blurb, LIMITS.groupBlurb);
    if (!gTitle || !gBlurb || !Array.isArray(g.packages) || g.packages.length > LIMITS.allPackages) return null;
    const packages: ContentPackage[] = [];
    for (const p of g.packages) {
      const pkg = readPackage(p, service.slug, codeIds);
      if (!pkg || ids.has(pkg.id)) return null;
      ids.add(pkg.id);
      packages.push(pkg);
    }
    if (packages.filter((p) => !p.deleted).length > LIMITS.packages) return null;
    groups.push({ key: g.key, title: gTitle, blurb: gBlurb, packages });
  }

  return {
    v: 1,
    title,
    tagline,
    description,
    includes,
    prepare,
    faqs,
    cover: { path: c.path, x, y },
    groups,
  };
}

// ---------------------------------------------------------------------------
// Ready to publish?
// ---------------------------------------------------------------------------

export type ProblemCode =
  /** Not written in this language. */
  | "missing"
  /** A list that needs at least one entry has none. */
  | "empty"
  /** A group with no package shown on the page. */
  | "noPackages"
  /** A number out of range: a price of 0, a range upside down. */
  | "invalid"
  /** No cover. */
  | "cover";

export interface Problem {
  /**
   * The field, as a path into the content: "title", "includes.2",
   * "groups.0.packages.1.name". The editor puts the same path on the input,
   * so a problem can take you to it.
   */
  where: string;
  code: ProblemCode;
  lang?: Lang;
}

/** All three languages written, or none (for the optional texts). */
function checkText(out: Problem[], where: string, text: Text, optional = false): void {
  if (optional && isEmptyText(text)) return;
  for (const l of LANGS) if (text[l].trim() === "") out.push({ where, code: "missing", lang: l });
}

/** Everything that stops a Publish. Empty: ready. */
export function publishProblems(content: ServiceContent, grouped: boolean): Problem[] {
  const out: Problem[] = [];
  if (!content.cover.path) out.push({ where: "cover", code: "cover" });

  checkText(out, "title", content.title);
  checkText(out, "tagline", content.tagline);
  checkText(out, "description", content.description);

  if (content.includes.length === 0) out.push({ where: "includes", code: "empty" });
  content.includes.forEach((t, i) => checkText(out, `includes.${i}`, t));
  if (content.prepare.length === 0) out.push({ where: "prepare", code: "empty" });
  content.prepare.forEach((t, i) => checkText(out, `prepare.${i}`, t));
  content.faqs.forEach((f, i) => {
    checkText(out, `faqs.${i}.q`, f.q);
    checkText(out, `faqs.${i}.a`, f.a);
  });

  content.groups.forEach((g, gi) => {
    const at = `groups.${gi}`;
    if (grouped) {
      checkText(out, `${at}.title`, g.title);
      checkText(out, `${at}.blurb`, g.blurb);
    }
    if (!g.packages.some((p) => !p.hidden && !p.deleted)) out.push({ where: `${at}.packages`, code: "noPackages" });

    g.packages.forEach((p, pi) => {
      if (p.deleted) return;
      const pAt = `${at}.packages.${pi}`;
      checkText(out, `${pAt}.name`, p.name, true);
      checkText(out, `${pAt}.description`, p.description, true);
      p.perks.forEach((t, k) => checkText(out, `${pAt}.perks.${k}`, t));
      if (p.price < LIMITS.price.min) out.push({ where: `${pAt}.price`, code: "invalid" });
      if (p.minutes < LIMITS.minutes.min) out.push({ where: `${pAt}.minutes`, code: "invalid" });
      if (p.days < LIMITS.days.min) out.push({ where: `${pAt}.days`, code: "invalid" });
      if (p.photosMin < LIMITS.photos.min) out.push({ where: `${pAt}.photosMin`, code: "invalid" });
      if (p.photosMax !== null && p.photosMax < p.photosMin) out.push({ where: `${pAt}.photosMax`, code: "invalid" });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

/** A new package's id: the service's prefix and six random letters and digits. */
export function newPackageId(slug: string, taken: ReadonlySet<string>): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let tail = "";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (const b of bytes) tail += alphabet[b % alphabet.length];
    const id = `${slug}-${tail}`;
    if (!taken.has(id)) return id;
  }
}

/** The same content? Compared as JSON: both sides come from the same builders. */
export function sameContent(a: ServiceContent | null, b: ServiceContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
