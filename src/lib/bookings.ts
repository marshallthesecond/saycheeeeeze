// The booking ledger. Server only.
//
// "One session per day" is enforced by a partial unique index, so the INSERT
// itself is the lock — a check-then-write cannot close the window between two
// requests in the same second.

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

// Reads

/**
 * Which days are taken, and nothing else.
 *
 * This is the ONLY booking data that reaches the browser: an array of dates and
 * a status. No names, no phone numbers, no prices. The bookings table has RLS
 * enabled with zero policies, so anon cannot read it at all — this runs
 * server-side during render and hands the client the minimum it needs to grey
 * out cells.
 */
/**
 * Which start times on ONE date are already sold.
 *
 * For the fixed-slot events only. Every other product is one-a-day and asks
 * listTakenDays() instead — a day is free or it is not, and no caller needs to
 * know which hour of it went.
 *
 * Fails open for the same reason listTakenDays() does: the unique index on
 * (session_date, start_time) is the real lock, so the cost of a Supabase blip
 * is a 409 on submit rather than eight slots that cannot be booked at all.
 */
export async function listTakenSlots(dateISO: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .select("start_time")
      .eq("session_date", dateISO)
      .in("status", ["pending", "confirmed"]);

    if (error || !data) return [];
    // "15:00:00" from Postgres, "15:00" everywhere in the app.
    return data.map((r) => String(r.start_time).slice(0, 5));
  } catch {
    return [];
  }
}

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

// Writes

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

/**
 * Releases the days held by pending bookings older than the hold window.
 *
 * `pendingHoldHours` has been in the config since the beginning and read by
 * nothing, while the admin notification told Marshall "Held 48h, then the day
 * reopens." It did not. And because the partial unique index counts
 * status IN ('pending','confirmed'), a stale hold did not merely grey out a
 * cell in the calendar — it made the INSERT for that date fail with 23505
 * forever. Three abandoned submissions, which the daily rate limit permits from
 * one address, killed three dates permanently with no UI to undo it.
 *
 * Flipping the status is what actually frees the day; filtering the calendar
 * would have left the index blocking a date the client had just been shown as
 * available, which is the worse of the two failures.
 *
 * Called from the booking POST before the insert and from the booking page as
 * it renders, so it is self-healing without a scheduler: the moment anybody
 * touches the booking flow, expired holds go. `decided_at` is left alone — no
 * human decided this.
 *
 * Returns how many were released, for the log. Failure is swallowed: a sweep
 * that cannot run must not stop a booking being taken.
 */
export async function expireStalePending(holdHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - holdHours * 3600_000).toISOString();
  try {
    const { data, error } = await supabaseAdmin()
      .from("bookings")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .select("ref");

    if (error) {
      console.error("expireStalePending:", error.message);
      return 0;
    }
    const n = data?.length ?? 0;
    if (n > 0) console.info(`[bookings] released ${n} expired hold(s)`);
    return n;
  } catch (e) {
    console.error("expireStalePending:", String(e));
    return 0;
  }
}

// Rate limiting

/**
 * Per IP HASH, which on Uzbek mobile means per carrier NAT pool — Beeline and
 * Ucell put thousands of subscribers behind a handful of addresses. At 3 this
 * was capable of refusing a real client because two strangers on the same
 * network had enquired that morning. 10 still stops a script and is a number no
 * honest visitor reaches.
 */
const MAX_PER_DAY = 10;

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

    const over = (count ?? 0) >= MAX_PER_DAY;
    // Only log attempts that were actually allowed through. Recording the
    // refused ones inflates the count that refused them, which turns a rolling
    // 24-hour window into a ban that extends itself every time the client
    // retries.
    if (!over) await db.from("booking_attempts").insert({ ip_hash: ipHash });
    return over;
  } catch {
    // Fail open — a logging outage must not block a real customer.
    return false;
  }
}

// Mapping

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