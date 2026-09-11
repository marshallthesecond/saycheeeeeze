// src/lib/bookings.ts
//
// The booking ledger, now in Postgres. SERVER ONLY.
//
// Replaces the Bunny file store, where every booking was a JSON file whose
// date/time/status lived in the FILENAME. That design listed cheaply but could
// not express a uniqueness constraint, so "one session per day" was
// unenforceable: listBookingSlotsFresh() -> canBook() -> createBooking() let
// two requests in the same second both pass and both write. Postgres closes
// that window with a partial unique index, and the INSERT itself becomes the
// lock.
//
// It also could not be queried. "How much did I earn in July" meant downloading
// every file and parsing "800,000 so'm" back into a number.

import "server-only";

import { supabaseAdmin } from "./supabase";
import type { BookingStatus, TakenDay } from "./availability";
import type { Localised } from "./packages";

export type BookingAddon = {
  id: string;
  qty: number;
  unitPriceUzs: number | null;
  people: number;
};

export interface BookingInput {
  ref: string;
  sessionDate: string;        // YYYY-MM-DD
  startTime: string;          // HH:MM
  durationMinutes: number;
  packageId: string;
  packageName: Localised;
  priceUzs: number;
  basePriceUzs: number;
  peopleCount: number | null;
  addons: BookingAddon[]; 
  serviceSlug: string | null;
  locationId: string | null;
  locationCustom: string | null;
  clientName: string;
  telegramUsername: string | null;
  phone: string | null;
  notes: string | null;
  locale: string;
  source: string | null;
  ipHash: string | null;
}

export interface BookingRecord extends BookingInput {
  id: string;
  status: BookingStatus;
  telegramChatId: number | null;
  createdAt: string;
}

export type CreateResult =
  | { ok: true; booking: BookingRecord }
  | { ok: false; code: "conflict" | "error"; message: string };

const PG_UNIQUE_VIOLATION = "23505";

// ─── Reads ────────────────────────────────────────────────

/**
 * Which days are taken, and nothing else.
 *
 * This is the ONLY booking data that reaches the browser: an array of dates and
 * a status. No names, no phone numbers, no prices. The bookings table has RLS
 * enabled with zero policies, so anon cannot read it at all — this runs
 * server-side during render and hands the client the minimum it needs to grey
 * out cells.
 */
export async function listTakenDays(fromISO: string): Promise<TakenDay[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .select("session_date, status")
      .in("status", ["pending", "confirmed"])
      .gte("session_date", fromISO);

    if (error || !data) return [];
    return data.map((r) => ({
      date: r.session_date as string,
      status: r.status as "pending" | "confirmed",
    }));
  } catch {
    // Fail OPEN. A Supabase blip should render a calendar with everything
    // available rather than one where nothing is bookable — the INSERT is the
    // real guard, so the worst case is a 409 on submit.
    return [];
  }
}

export async function listBlackoutDates(fromISO: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("blackout_dates")
      .select("day")
      .gte("day", fromISO);
    if (error || !data) return [];
    return data.map((r) => r.day as string);
  } catch {
    return [];
  }
}

export async function getBookingByRef(ref: string): Promise<BookingRecord | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .select("*")
      .eq("ref", ref)
      .maybeSingle();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

// ─── Writes ───────────────────────────────────────────────

/**
 * Inserts a booking. The partial unique index on (session_date) WHERE status IN
 * ('pending','confirmed') means a second booking for the same day raises 23505,
 * which we surface as a conflict for the route to turn into HTTP 409.
 */
export async function createBooking(input: BookingInput): Promise<CreateResult> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .insert({
        ref: input.ref,
        session_date: input.sessionDate,
        start_time: input.startTime,
        duration_minutes: input.durationMinutes,
        package_id: input.packageId,
        package_name: input.packageName,
        price_uzs: input.priceUzs,
        base_price_uzs: input.basePriceUzs,
        people_count: input.peopleCount,
        addons: input.addons,
        service_slug: input.serviceSlug,
        location_id: input.locationId,
        location_custom: input.locationCustom,
        client_name: input.clientName,
        telegram_username: input.telegramUsername,
        phone: input.phone,
        notes: input.notes,
        locale: input.locale,
        source: input.source,
        ip_hash: input.ipHash,
      })
      .select()
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        // Could be the day index or the ref index. The ref is random per
        // request, so retrying once on a ref collision is worthwhile; a day
        // collision is genuine and must surface.
        const isRef = error.message.includes("ref");
        return {
          ok: false,
          code: isRef ? "error" : "conflict",
          message: isRef ? "Reference collision" : "That day was just taken",
        };
      }
      return { ok: false, code: "error", message: error.message };
    }

    return { ok: true, booking: fromRow(data) };
  } catch (e) {
    return { ok: false, code: "error", message: String(e) };
  }
}

export async function setBookingStatus(
  ref: string,
  status: BookingStatus
): Promise<BookingRecord | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("ref", ref)
      .select()
      .single();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

/**
 * Binds a Telegram chat to a booking after the client presses Start.
 *
 * Only binds when telegram_chat_id IS NULL and the booking is recent —
 * otherwise a leaked reference would let someone redirect another person's
 * notifications to their own chat.
 */
export async function bindTelegramChat(
  ref: string,
  chatId: number
): Promise<BookingRecord | null> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .update({
        telegram_chat_id: chatId,
        telegram_bound_at: new Date().toISOString(),
        notify_channel: "telegram",
      })
      .eq("ref", ref)
      .is("telegram_chat_id", null)
      .gte("created_at", cutoff)
      .select()
      .single();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export async function markSheetSynced(ref: string): Promise<void> {
  try {
    await supabaseAdmin().from("bookings").update({ synced_to_sheet: true }).eq("ref", ref);
  } catch {
    /* the cron sweep will retry */
  }
}

// ─── Rate limiting ────────────────────────────────────────

const MAX_PER_DAY = 3;

/**
 * Replaces the module-scope Map, which on serverless reset on every cold start
 * and counted per instance — so it stopped nothing at all.
 */
export async function rateLimited(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    const db = supabaseAdmin();
    const { count } = await db
      .from("booking_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("attempted_at", since);

    await db.from("booking_attempts").insert({ ip_hash: ipHash });
    return (count ?? 0) >= MAX_PER_DAY;
  } catch {
    // Fail open — a logging outage must not block a real customer.
    return false;
  }
}

// ─── Mapping ──────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(r: any): BookingRecord {
  return {
    id: r.id,
    ref: r.ref,
    sessionDate: r.session_date,
    startTime: String(r.start_time).slice(0, 5), // Postgres returns "14:00:00"
    durationMinutes: r.duration_minutes,
    status: r.status,
    packageId: r.package_id,
    packageName: r.package_name,
    priceUzs: Number(r.price_uzs),
    basePriceUzs: Number(r.base_price_uzs),
    peopleCount: r.people_count,
    addons: (r.addons ?? []) as BookingAddon[], 
    serviceSlug: r.service_slug,
    locationId: r.location_id,
    locationCustom: r.location_custom,
    clientName: r.client_name,
    telegramUsername: r.telegram_username,
    phone: r.phone,
    notes: r.notes,
    locale: r.locale,
    source: r.source,
    ipHash: r.ip_hash,
    telegramChatId: r.telegram_chat_id == null ? null : Number(r.telegram_chat_id),
    createdAt: r.created_at,
  };
}