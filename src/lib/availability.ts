// When a session can be booked.
//
// Hours are per weekday, because Thursday runs to 23:00 and nothing else does.
// One session per day, so a day has two states and there is no interval
// arithmetic. Price comes from the package, not from the hour.
//
// Every date is pinned to Tashkent INCLUDING on the server. Defaulting to
// new Date() there means UTC on Vercel, which between 00:00 and 05:00 Tashkent
// puts the server a calendar day behind the browser and silently shortens lead
// time by a day.

// Config

export interface DayHours {
  /** "HH:MM", 24h. */
  open: string;
  close: string;
}

/** 0 = Sunday … 6 = Saturday. null = closed that weekday. */
export type WeeklyHours = Record<number, DayHours | null>;

export interface AvailabilityConfig {
  weeklyHours: WeeklyHours;
  /** Spacing of suggested start times, in minutes. */
  slotStepMinutes: number;
  /** Earliest bookable date, in days from today. 1 = no same-day. */
  leadTimeDays: number;
  maxAdvanceDays: number;
  /** How long an unapproved booking holds its day before it auto-releases. */
  pendingHoldHours: number;
}

// 09:00, not 07:00. Seven days a week is real — a Sunday graduation shoot is
// normal here — but nobody was ever going to book a 7am start, and every one of
// those two dead rows pushed the first real slot further down the list.
const OPEN_EARLY: DayHours = { open: "09:00", close: "18:00" };
const OPEN_LATE: DayHours = { open: "09:00", close: "23:00" };

export const DEFAULT_AVAILABILITY: AvailabilityConfig = {
  weeklyHours: {
    0: OPEN_EARLY, // Sun
    1: OPEN_EARLY, // Mon
    2: OPEN_EARLY, // Tue
    3: OPEN_EARLY, // Wed
    4: OPEN_LATE,  // Thu — the long day
    5: OPEN_EARLY, // Fri
    6: OPEN_EARLY, // Sat
  },
  slotStepMinutes: 60,
  leadTimeDays: 1,
  maxAdvanceDays: 120,
  pendingHoldHours: 48,
};

export type BookingStatus =
  | "pending" | "confirmed" | "declined" | "cancelled" | "expired" | "completed";

/** One taken day, as the calendar needs to see it. No customer data. */
export interface TakenDay {
  /** YYYY-MM-DD */
  date: string;
  status: "pending" | "confirmed";
}

export type DayStatus =
  | "open"     // free
  | "pending"  // held by an unapproved booking
  | "booked"   // confirmed
  | "closed";  // day off, blacked out, or outside the lead/advance window

// Tashkent time
//
// Everything about this business happens in one timezone, but the code runs in
// two others: the server in UTC, the browser in whatever the visitor's device
// says. Both helpers return a Date whose LOCAL fields carry Tashkent wall time,
// so getFullYear()/getMonth()/getDate() and toISODate() agree everywhere.

const TZ = "Asia/Tashkent";

export function todayInTashkent(): Date {
  // en-CA formats as YYYY-MM-DD, which parses unambiguously.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Same idea, but keeps the clock — needed for same-day start-time cutoffs. */
export function nowInTashkent(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl can emit hour "24" for midnight in some runtimes.
  const hour = get("hour") % 24;
  return new Date(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

// Date helpers

/** Formats a Date as YYYY-MM-DD from its LOCAL fields (not UTC). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "2026-08-14" -> Date. Parsed by hand: new Date(iso) parses as UTC and can
 *  land on the previous day once rendered in a western timezone. */
export function fromISODate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function earliestBookableDate(cfg: AvailabilityConfig, today = todayInTashkent()): Date {
  const d = startOfDay(today);
  d.setDate(d.getDate() + cfg.leadTimeDays);
  return d;
}

export function latestBookableDate(cfg: AvailabilityConfig, today = todayInTashkent()): Date {
  const d = startOfDay(today);
  d.setDate(d.getDate() + cfg.maxAdvanceDays);
  return d;
}

// Time helpers

/** "14:30" -> 870. NaN for anything unparseable. */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return NaN;
  return h * 60 + min;
}

/** 870 -> "14:30" */
export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "14:00" + 180 -> "14:00–17:00" */
export function describeSlot(start: string, durationMinutes: number): string {
  const s = toMinutes(start);
  if (Number.isNaN(s)) return start;
  return `${start}–${toHHMM(s + durationMinutes)}`;
}

export function hoursForDate(date: Date, cfg: AvailabilityConfig): DayHours | null {
  return cfg.weeklyHours[date.getDay()] ?? null;
}

// Day status

export interface DayInfo {
  status: DayStatus;
  hours: DayHours | null;
}

export function getDayInfo(
  date: Date,
  cfg: AvailabilityConfig,
  taken: Map<string, "pending" | "confirmed">,
  blackouts: Set<string>,
  today = todayInTashkent()
): DayInfo {
  const iso = toISODate(date);
  const hours = hoursForDate(date, cfg);
  const day = startOfDay(date).getTime();

  if (day < earliestBookableDate(cfg, today).getTime()) return { status: "closed", hours };
  if (day > latestBookableDate(cfg, today).getTime()) return { status: "closed", hours };
  if (blackouts.has(iso)) return { status: "closed", hours };
  if (!hours) return { status: "closed", hours: null };

  const held = taken.get(iso);
  if (held === "confirmed") return { status: "booked", hours };
  if (held === "pending") return { status: "pending", hours };

  return { status: "open", hours };
}

/** Convenience for the server, which reads the ledger as a flat list. */
export function toTakenMap(days: TakenDay[]): Map<string, "pending" | "confirmed"> {
  const m = new Map<string, "pending" | "confirmed">();
  for (const d of days) {
    // Confirmed outranks pending if both somehow exist for one date.
    if (d.status === "confirmed" || !m.has(d.date)) m.set(d.date, d.status);
  }
  return m;
}

// Start times

export interface StartTime {
  time: string;                     // "HH:MM"
  endsAt: string;                   // "HH:MM"
  goldenHour: boolean;              // first or last slot of the day
  band: "morning" | "afternoon" | "evening";
}

const NOON = 12 * 60;
const EVENING = 16 * 60;

/** A session ending after this is not golden hour, whatever the clock says. */
const GOLDEN_LATEST_END = 19 * 60;

/**
 * Legal start times for a package on a given day.
 *
 * The last one is bounded by the package's duration: a 3h portrait on a day
 * that closes at 18:00 can start no later than 15:00, while a 2h graduation
 * can start at 16:00. That is why duration has to be chosen BEFORE the date —
 * the old form asked for the date first and the duration afterwards, which
 * could offer a start time that no longer fit once a duration was picked.
 */
export function getStartTimes(
  date: Date,
  durationMinutes: number,
  cfg: AvailabilityConfig,
  now = nowInTashkent()
): StartTime[] {
  const hours = hoursForDate(date, cfg);
  if (!hours) return [];

  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  if (Number.isNaN(open) || Number.isNaN(close) || close <= open) return [];

  const step = Math.max(15, cfg.slotStepMinutes || 60);
  const isToday = toISODate(date) === toISODate(now);
  // Guards leadTimeDays: 0. Without it, "today at 07:00" stays clickable at 4pm.
  const floor = isToday ? now.getHours() * 60 + now.getMinutes() : -1;

  const out: StartTime[] = [];
  for (let t = open; t + durationMinutes <= close; t += step) {
    if (t <= floor) continue;
    out.push({
      time: toHHMM(t),
      endsAt: toHHMM(t + durationMinutes),
      goldenHour: false,
      band: t < NOON ? "morning" : t < EVENING ? "afternoon" : "evening",
    });
  }

  // Best light is at either end of the DAYLIGHT day, which is not the same as
  // either end of the booking window. Thursday runs to 23:00, and the old
  // version put a golden-hour sun on a 20:00 start — in Tashkent in November
  // the sun is down by half five. A badge that is wrong on the one subject the
  // client is trusting you about is worse than no badge.
  if (out.length > 0) {
    out[0].goldenHour = true;
    const last = out[out.length - 1];
    if (toMinutes(last.endsAt) <= GOLDEN_LATEST_END) last.goldenHour = true;
  }
  return out;
}

/** Groups start times for a UI that would otherwise render 15+ loose buttons. */
export function groupStartTimes(slots: StartTime[]) {
  return {
    morning: slots.filter((s) => s.band === "morning"),
    afternoon: slots.filter((s) => s.band === "afternoon"),
    evening: slots.filter((s) => s.band === "evening"),
  };
}

// Validation

export type BookCheck = { ok: true } | { ok: false; reason: string; code: BookErrorCode };

export type BookErrorCode =
  | "badTime" | "dayClosed" | "outsideWindow" | "runsPastClose" | "inThePast" | "dayTaken";

/**
 * The server-side gate. Everything the client believes is re-derived here from
 * the package and the config — nothing about timing is taken on trust.
 *
 * Note this deliberately does NOT decide the day-taken case on its own: that is
 * the database's job via the partial unique index. Checking here as well would
 * reintroduce the check-then-write race the index exists to close. The taken
 * map is consulted only to give a nicer message when we already know.
 */
export function canBook(
  date: Date,
  start: string,
  durationMinutes: number,
  cfg: AvailabilityConfig,
  taken: Map<string, "pending" | "confirmed">,
  blackouts: Set<string>,
  now = nowInTashkent()
): BookCheck {
  const startMin = toMinutes(start);
  if (Number.isNaN(startMin)) {
    return { ok: false, code: "badTime", reason: "Invalid time format" };
  }

  const today = startOfDay(now);
  const info = getDayInfo(date, cfg, taken, blackouts, today);

  if (info.status === "booked" || info.status === "pending") {
    return { ok: false, code: "dayTaken", reason: "That day is already taken" };
  }
  if (info.status === "closed" || !info.hours) {
    return { ok: false, code: "dayClosed", reason: "That date isn't open for bookings" };
  }

  const open = toMinutes(info.hours.open);
  const close = toMinutes(info.hours.close);
  if (startMin < open) {
    return { ok: false, code: "outsideWindow", reason: `Sessions start from ${info.hours.open}` };
  }
  if (startMin + durationMinutes > close) {
    return {
      ok: false, code: "runsPastClose",
      reason: `That session would run past ${info.hours.close}`,
    };
  }
  if (startMin % Math.max(15, cfg.slotStepMinutes) !== open % Math.max(15, cfg.slotStepMinutes)) {
    return { ok: false, code: "badTime", reason: "Pick one of the offered start times" };
  }
  if (toISODate(date) === toISODate(now) && startMin <= now.getHours() * 60 + now.getMinutes()) {
    return { ok: false, code: "inThePast", reason: "That time has already passed" };
  }

  return { ok: true };
}