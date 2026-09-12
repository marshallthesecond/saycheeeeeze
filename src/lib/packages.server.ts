// The packages table read, kept apart from packages.ts so client components
// can import the types and the maths without pulling in server-only.

import "server-only";

import { supabaseRead } from "./supabase";
import {
  FALLBACK_PACKAGES,
  type PackageId,
  type SessionPackage,
} from "./packages";

interface PackageRow {
  id: string;
  sort_order: number;
  is_active: boolean;
  is_bookable: boolean;
  name: Record<string, string>;
  tagline: Record<string, string>;
  includes: Record<string, string[]>;
  price_uzs: number;
  duration_minutes: number;
  duration_label: Record<string, string>;
  edited_min: number;
  edited_max: number;
  delivery_hours: number;
  max_people: number | null;
  extra_people_block: number | null;
  extra_people_price_uzs: number | null;
  max_people_hard: number | null;
  accent_color: string;
  cover_path: string | null;
}

function toPackage(r: PackageRow): SessionPackage {
  return {
    id: r.id as PackageId,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    isBookable: r.is_bookable,
    name: r.name as SessionPackage["name"],
    tagline: r.tagline as SessionPackage["tagline"],
    includes: r.includes as SessionPackage["includes"],
    priceUzs: Number(r.price_uzs),
    durationMinutes: r.duration_minutes,
    durationLabel: r.duration_label as SessionPackage["durationLabel"],
    editedMin: r.edited_min,
    editedMax: r.edited_max,
    deliveryHours: r.delivery_hours,
    maxPeople: r.max_people,
    extraPeopleBlock: r.extra_people_block,
    extraPeoplePriceUzs:
      r.extra_people_price_uzs == null ? null : Number(r.extra_people_price_uzs),
    maxPeopleHard: r.max_people_hard,
    accentColor: r.accent_color,
    coverPath: r.cover_path,
  };
}

/**
 * Every active package, cheapest sort_order first.
 *
 * Falls back to the compiled-in list on any failure. The INSERT re-reads the
 * price from the database anyway, so stale display prices can only cause a
 * "price changed, re-confirm" 409, never a mispriced sale.
 */
export async function getPackages(): Promise<SessionPackage[]> {
  try {
    const { data, error } = await supabaseRead()
      .from("packages")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data?.length) return FALLBACK_PACKAGES;
    return (data as unknown as PackageRow[]).map(toPackage);
  } catch {
    return FALLBACK_PACKAGES;
  }
}

/** Bookable ones only — what the form may offer. */
export async function getBookablePackages(): Promise<SessionPackage[]> {
  return (await getPackages()).filter((p) => p.isBookable);
}
