// Types, pure helpers and the offline fallback. NO Supabase import — this file
// is safe to pull into a client component. The database read lives next door in
// packages.server.ts, which is server-only.
//
// One rule governs everything here: the CLIENT NEVER SENDS A PRICE. It sends a
// package id and a head count; the server looks up what that costs. The old
// route wrote whatever `price` string arrived in the request body straight into
// your Telegram message, so a modified request could book a 1.6M commercial
// shoot for 1 so'm and the notification would confidently say 1 so'm.

import type { Locale } from "./i18n/config";

export type PackageId = "graduation" | "portrait" | "fashion" | "commercial";

/** Localised string. `en` is required so there is always a fallback. */
export type Localised = Partial<Record<Locale, string>> & { en: string };
export type LocalisedList = Partial<Record<Locale, string[]>> & { en: string[] };

export interface SessionPackage {
  id: PackageId;
  sortOrder: number;
  isActive: boolean;
  /** false = shown on the site, but the CTA is "enquire" rather than "book". */
  isBookable: boolean;

  name: Localised;
  tagline: Localised;
  includes: LocalisedList;

  priceUzs: number;

  /**
   * The block the calendar reserves, used to compute the last legal start
   * time. Always the generous end of the range — one session per day means
   * over-reserving is free, and rounding to the hour keeps every start on :00.
   */
  durationMinutes: number;
  /** What the client reads: "2–3 hours". */
  durationLabel: Localised;

  editedMin: number;
  editedMax: number;
  deliveryHours: number;

  /** Head count the base price covers. null = not applicable. */
  maxPeople: number | null;
  /** Extra people are charged per block of this many, rounded up. */
  extraPeopleBlock: number | null;
  extraPeoplePriceUzs: number | null;
  /** Hard ceiling. Above this the form refuses and points at Telegram. */
  maxPeopleHard: number | null;

  accentColor: string;
  coverPath: string | null;
}

// Fallback
// Used only when Supabase is unreachable at render time, so /book never shows
// an empty price list. Keep in sync with sql/0001_booking_system.sql — the
// database is the source of truth, this is the parachute.
export const FALLBACK_PACKAGES: SessionPackage[] = [
  {
    id: "graduation", sortOrder: 1, isActive: true, isBookable: true,
    name: { en: "Graduation", ru: "Выпускной", uz: "Bitiruv" },
    tagline: { en: "Solo or small group — creative, not a lineup." },
    includes: { en: ["Up to 10 people included", "50 edited images", "Delivered in 48 hours"] },
    priceUzs: 400_000, durationMinutes: 120,
    durationLabel: { en: "2 hours", ru: "2 часа", uz: "2 soat" },
    editedMin: 50, editedMax: 50, deliveryHours: 48,
    maxPeople: 10, extraPeopleBlock: 5, extraPeoplePriceUzs: 150_000, maxPeopleHard: 25,
    accentColor: "#506477", coverPath: null,
  },
  {
    id: "portrait", sortOrder: 2, isActive: true, isBookable: true,
    name: { en: "Portrait / Model", ru: "Портрет / Модель", uz: "Portret / Model" },
    tagline: { en: "Unhurried, one subject, real direction." },
    includes: { en: ["20 edited images", "Posing guidance", "Delivered in 48 hours"] },
    priceUzs: 800_000, durationMinutes: 180,
    durationLabel: { en: "2–3 hours", ru: "2–3 часа", uz: "2–3 soat" },
    editedMin: 20, editedMax: 20, deliveryHours: 48,
    maxPeople: 2, extraPeopleBlock: null, extraPeoplePriceUzs: null, maxPeopleHard: 2,
    accentColor: "#506477", coverPath: null,
  },
  {
    id: "fashion", sortOrder: 3, isActive: true, isBookable: true,
    name: { en: "Fashion / Creative", ru: "Fashion / Креатив", uz: "Fashion / Ijodiy" },
    tagline: { en: "Editorial. Concept-led, styled, built with you." },
    includes: { en: ["Concept built together", "25 edited images", "Multiple looks"] },
    priceUzs: 1_200_000, durationMinutes: 180,
    durationLabel: { en: "3 hours", ru: "3 часа", uz: "3 soat" },
    editedMin: 25, editedMax: 25, deliveryHours: 48,
    maxPeople: 2, extraPeopleBlock: null, extraPeoplePriceUzs: null, maxPeopleHard: 4,
    accentColor: "#506477", coverPath: null,
  },
  {
    id: "commercial", sortOrder: 4, isActive: true, isBookable: true,
    name: { en: "Commercial", ru: "Коммерческая съёмка", uz: "Tijorat suratga olish" },
    tagline: { en: "Product, brand and business, shot to sell." },
    includes: { en: ["25–30 edited images", "Professional lighting", "Web and print exports"] },
    priceUzs: 1_600_000, durationMinutes: 120,
    durationLabel: { en: "2 hours", ru: "2 часа", uz: "2 soat" },
    editedMin: 25, editedMax: 30, deliveryHours: 48,
    maxPeople: null, extraPeopleBlock: null, extraPeoplePriceUzs: null, maxPeopleHard: null,
    accentColor: "#506477", coverPath: null,
  },
];

// Localisation

export function pick(field: Localised | null | undefined, locale: Locale): string {
  if (!field) return "";
  return field[locale] ?? field.en ?? "";
}

export function pickList(field: LocalisedList | null | undefined, locale: Locale): string[] {
  if (!field) return [];
  return field[locale] ?? field.en ?? [];
}

// Money

const CURRENCY_SUFFIX: Record<Locale, string> = { en: "so'm", ru: "сум", uz: "so'm" };

/**
 * 800000 -> "800 000 so'm".
 *
 * Space-separated, not comma-separated: both Uzbek and Russian group thousands
 * with a space, and "800,000" reads as eight hundred to a local eye in a way
 * that matters when the number is a price. Regular space, not the non-breaking
 * one toLocaleString emits, so it copies cleanly into Telegram and Sheets.
 */
export function formatSom(amount: number, locale: Locale = "en"): string {
  const grouped = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} ${CURRENCY_SUFFIX[locale] ?? CURRENCY_SUFFIX.en}`;
}

// Pricing

export interface PriceBreakdown {
  basePriceUzs: number;
  extraPeople: number;
  extraBlocks: number;
  extraPriceUzs: number;
  totalUzs: number;
}

/**
 * The one function that turns a package + head count into money. Called on the
 * server to write the booking, and on the client only to DISPLAY a quote — if
 * the two disagree the server wins and the client is asked to re-confirm.
 */
export function priceFor(pkg: SessionPackage, peopleCount?: number | null): PriceBreakdown {
  const base = pkg.priceUzs;
  const people = peopleCount ?? 0;

  const chargeable =
    pkg.maxPeople != null && pkg.extraPeopleBlock && pkg.extraPeoplePriceUzs != null
      ? Math.max(0, people - pkg.maxPeople)
      : 0;

  const blocks = chargeable > 0 ? Math.ceil(chargeable / (pkg.extraPeopleBlock as number)) : 0;
  const extra = blocks * (pkg.extraPeoplePriceUzs ?? 0);

  return {
    basePriceUzs: base,
    extraPeople: chargeable,
    extraBlocks: blocks,
    extraPriceUzs: extra,
    totalUzs: base + extra,
  };
}

/** Validates a head count against the package. Returns null when fine. */
export function peopleError(
  pkg: SessionPackage,
  peopleCount: number | null | undefined
): "required" | "tooMany" | null {
  if (pkg.maxPeople == null) return null;
  if (peopleCount == null || peopleCount < 1) return "required";
  if (pkg.maxPeopleHard != null && peopleCount > pkg.maxPeopleHard) return "tooMany";
  return null;
}

export function getPackage(list: SessionPackage[], id: string): SessionPackage | undefined {
  return list.find((p) => p.id === id && p.isActive);
}

// Service → package mapping
// The 17 service pages stay as marketing and SEO surfaces. Four packages are
// what you can actually buy. A service with `null` is not bookable through the
// form: its page swaps "Book this" for "Ask about this" → Telegram.
//
// This lives here rather than in services.ts so that adding a service can never
// silently produce a page with no price attached to it.
export const SERVICE_TO_PACKAGE: Record<string, PackageId | null> = {
  graduation: "graduation",

  portraits: "portrait",
  "individual-portraits": "portrait",
  "pair-group": "portrait",
  "family-portraits": "portrait",
  "photowalk-tashkent": "portrait",
  "newborn-maternity": "portrait",
  models: "portrait",

  "fashion-streetstyle": "fashion",
  "creative-photography": "fashion",
  "uzb-national": "fashion",

  "brand-product": "commercial",
  "business-portraits": "commercial",
  "social-media-content": "commercial",

  // Neither fits a fixed 2h block at a fixed price. Enquire.
  "wedding-love-story": null,
  "events-corporate": null,
};