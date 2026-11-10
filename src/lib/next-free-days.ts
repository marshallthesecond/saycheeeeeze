// The next days a session can still be booked, for the "Next free day" line on
// the Home and About pages.
//
// Same rules as the booking calendar, read from the same places, so the two can
// never disagree: DEFAULT_AVAILABILITY for hours, lead time and the 120-day
// window; live pending/confirmed bookings; Marshall's blackout dates; and the
// dates reserved for an event (an event's day is closed to everything else).
//
// Server only — it reads the bookings table through the service-role client,
// and only ISO dates leave this file, never a name, phone or price.

import {
  DEFAULT_AVAILABILITY,
  earliestBookableDate,
  getDayInfo,
  latestBookableDate,
  toISODate,
  toTakenMap,
  todayInTashkent,
} from "@/src/lib/availability";
import { expireStalePending, listBlackoutDates, listTakenDays } from "@/src/lib/bookings";
import { reservedDatesFor } from "@/src/lib/booking-services";

/**
 * Up to `count` open days, earliest first, as "YYYY-MM-DD".
 *
 * Releases expired 48-hour holds first, exactly as the booking page does, so a
 * request nobody answered doesn't keep a day looking taken here after the
 * calendar has already freed it.
 *
 * Never throws. The reads it uses fail open (an unreachable database reads as
 * "nothing taken"), which here would advertise tomorrow even if it is booked —
 * acceptable, because the booking form and the INSERT both re-check, and an
 * empty answer would hide the line entirely on every Supabase blip.
 */
export async function nextFreeDays(count = 3): Promise<string[]> {
  const cfg = DEFAULT_AVAILABILITY;
  const today = todayInTashkent();
  const fromISO = toISODate(today);

  try {
    await expireStalePending(cfg.pendingHoldHours);
    const [taken, blackouts] = await Promise.all([
      listTakenDays(fromISO),
      listBlackoutDates(fromISO),
    ]);

    const takenMap = toTakenMap(taken);
    const closed = new Set([...blackouts, ...reservedDatesFor(null)]);

    const out: string[] = [];
    const day = earliestBookableDate(cfg, today);
    const last = latestBookableDate(cfg, today).getTime();
    while (out.length < count && day.getTime() <= last) {
      if (getDayInfo(day, cfg, takenMap, closed, today).status === "open") {
        out.push(toISODate(day));
      }
      day.setDate(day.getDate() + 1);
    }
    return out;
  } catch (e) {
    console.error("nextFreeDays:", String(e));
    return [];
  }
}
