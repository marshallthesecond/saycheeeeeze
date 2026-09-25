"use client";

// Two pickers. Both take a value and an onChange and know nothing about the
// booking form, so they can be moved freely.
//
// A day is free or it isn't — two states, not five, because there is one
// session per day and the price comes from the package rather than the date.
// Start times are derived from the chosen package's block and grouped into
// morning / afternoon / evening; Thursday runs to 23:00 and would otherwise
// render fifteen loose buttons.

import { useMemo } from "react";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { ChevronLeft, ChevronRight, Sun } from "lucide-react";
import {
  type AvailabilityConfig,
  type DayStatus,
  type StartTime,
  type TakenDay,
  earliestBookableDate,
  getDayInfo,
  getStartTimes,
  groupStartTimes,
  latestBookableDate,
  nowInTashkent,
  toISODate,
  toTakenMap,
  todayInTashkent,
} from "@/src/lib/availability";

// One place for the palette, read from the design tokens — globals.css says
// there is one accent.
const STATUS_STYLE: Record<DayStatus, string> = {
  // An available day now has a FILL. Before this it was the only state drawn
  // with nothing at all — no background, just brighter text — so the calendar
  // read as a grid of disabled cells with a few slightly-less-grey ones in it,
  // and the thing the client came to find was the one thing not marked.
  open:    "bg-white/12 hover:bg-white/20 active:bg-white/25 text-white/90",
  pending: "bg-white/[0.04] text-white/25 cursor-not-allowed",
  booked:  "bg-white/[0.04] text-white/25 cursor-not-allowed line-through",
  closed:  "opacity-20 cursor-not-allowed",
};

/**
 * The legend's swatches, next to the cell styles they claim to explain.
 *
 * They did not match. The first swatch was `bg-accent-warm` under the label
 * "Available", but accent is the SELECTED day — so a client comparing the key
 * to the grid found no available days at all until they had already picked
 * one, and the state actually painted in accent had no entry. Keeping the two
 * maps adjacent is the only thing that stops them drifting again.
 */
const LEGEND_SWATCH = {
  available: "bg-white/12",
  taken: "bg-white/[0.05]",
  closed: "ring-1 ring-white/12",
} as const;

interface CalendarProps {
  selectedISO: string | null;
  viewMonth: number;
  viewYear: number;
  onSelect: (iso: string) => void;
  onViewChange: (month: number, year: number) => void;
  availability: AvailabilityConfig;
  taken: TakenDay[];
  blackouts: string[];
  /**
   * Nothing is selectable and nothing responds — the date has been decided
   * elsewhere. Used by the ceremony option, where 22 October is not a choice.
   * The grid still renders, because hiding it would leave the client with no
   * way to see WHICH date they have been given.
   */
  locked?: boolean;
}

export function CalendarPicker({
  selectedISO, viewMonth, viewYear, onSelect, onViewChange,
  availability, taken, blackouts, locked = false,
}: CalendarProps) {
  const { t, tArray } = useT();
  const MONTHS = tArray("calendar.months");
  const DAYS = tArray("calendar.days");

  // Pinned to Tashkent so server and browser agree on which cell is "today".
  const today = useMemo(() => todayInTashkent(), []);
  const takenMap = useMemo(() => toTakenMap(taken), [taken]);
  const blackoutSet = useMemo(() => new Set(blackouts), [blackouts]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // Monday-first grid: JS getDay() is Sunday-first, so shift by one.
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  const days = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const d = i + 1;
        const dateObj = new Date(viewYear, viewMonth, d);
        return {
          d,
          iso: toISODate(dateObj),
          info: getDayInfo(dateObj, availability, takenMap, blackoutSet, today),
        };
      }),
    [daysInMonth, viewYear, viewMonth, availability, takenMap, blackoutSet, today]
  );

  // Past months and months beyond maxAdvanceDays are unreachable, so the
  // arrows switch off rather than opening a dead grid.
  const first = earliestBookableDate(availability, today);
  const last = latestBookableDate(availability, today);
  const monthIndex = (y: number, m: number) => y * 12 + m;
  const current = monthIndex(viewYear, viewMonth);
  const atFirst = current <= monthIndex(first.getFullYear(), first.getMonth());
  const atLast = current >= monthIndex(last.getFullYear(), last.getMonth());

  const step = (delta: number) => {
    const next = current + delta;
    const min = monthIndex(first.getFullYear(), first.getMonth());
    const max = monthIndex(last.getFullYear(), last.getMonth());
    if (next < min || next > max) return;
    onViewChange(((next % 12) + 12) % 12, Math.floor(next / 12));
  };

  return (
    <div
      className={`bg-white/5 border border-white/10 rounded-2xl p-4 transition
        ${locked ? "opacity-60 pointer-events-none select-none" : ""}`}
      aria-disabled={locked || undefined}
    >
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => step(-1)}
          disabled={atFirst}
          aria-label={t("book.prevMonth")}
          className={`w-11 h-11 flex items-center justify-center rounded-lg transition
            ${atFirst ? "opacity-20 cursor-not-allowed" : "hover:bg-white/10 active:bg-white/15"}`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold">{MONTHS[viewMonth]} {viewYear}</span>
        <button
          onClick={() => step(1)}
          disabled={atLast}
          aria-label={t("book.nextMonth")}
          className={`w-11 h-11 flex items-center justify-center rounded-lg transition
            ${atLast ? "opacity-20 cursor-not-allowed" : "hover:bg-white/10 active:bg-white/15"}`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d, i) => (
          <div key={`${d}-${i}`} className="text-center text-[10px] text-white/30 font-medium py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }).map((_, i) => <div key={`e${i}`} />)}

        {days.map(({ d, iso, info }) => {
          // Full ISO date, not the day number: 14 August is not 14 September.
          const selected = selectedISO === iso;
          const selectable = info.status === "open" && !locked;
          const isToday = iso === toISODate(today);

          return (
            <button
              key={iso}
              disabled={!selectable}
              onClick={() => onSelect(iso)}
              aria-label={`${MONTHS[viewMonth]} ${d} — ${t(`book.aria.${info.status}`)}`}
              aria-pressed={selected}
              className={`relative flex items-center justify-center rounded-lg min-h-11 text-xs font-medium transition active:scale-95
                ${selected ? "bg-accent-warm text-accent-ink font-bold" : STATUS_STYLE[info.status]}
                ${isToday && !selected ? "ring-1 ring-white/40" : ""}`}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-white/10 text-[10px] text-white/40">
        <Legend className={LEGEND_SWATCH.available} label={t("book.available")} />
        {/* One entry for pending and confirmed both: to a client they are the
            same fact — that day is gone. Which of the two it is matters to
            Marshall, not to them. */}
        <Legend className={LEGEND_SWATCH.taken} label={t("book.legendBooked")} />
        <Legend className={LEGEND_SWATCH.closed} label={t("book.legendClosed")} />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

// Start times

interface TimeProps {
  selectedISO: string | null;
  /** From the chosen package. Bounds the last legal start time. */
  durationMinutes: number;
  startTime: string | null;
  onChange: (time: string | null) => void;
  availability: AvailabilityConfig;
}

export function StartTimePicker({
  selectedISO, durationMinutes, startTime, onChange, availability,
}: TimeProps) {
  const { t } = useT();

  const slots = useMemo(() => {
    if (!selectedISO) return [];
    const [y, m, d] = selectedISO.split("-").map(Number);
    return getStartTimes(new Date(y, m - 1, d), durationMinutes, availability, nowInTashkent());
  }, [selectedISO, durationMinutes, availability]);

  const bands = useMemo(() => groupStartTimes(slots), [slots]);

  if (!selectedISO) {
    return <p className="text-xs text-white/30">{t("book.pickDateFirst")}</p>;
  }
  if (slots.length === 0) {
    return <p className="text-xs text-white/50">{t("book.noSlots")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Band label={t("book.morning")}   slots={bands.morning}   startTime={startTime} onChange={onChange} />
      <Band label={t("book.afternoon")} slots={bands.afternoon} startTime={startTime} onChange={onChange} />
      <Band label={t("book.evening")}   slots={bands.evening}   startTime={startTime} onChange={onChange} />

      {slots.some((s) => s.goldenHour) && (
        <p className="flex items-center gap-1.5 text-[11px] text-white/35">
          <Sun className="w-3 h-3 text-accent-warm shrink-0" />
          {t("book.goldenHourHint")}
        </p>
      )}
    </div>
  );
}

function Band({ label, slots, startTime, onChange }: {
  label: string;
  slots: StartTime[];
  startTime: string | null;
  onChange: (time: string | null) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {slots.map((s) => {
          const active = startTime === s.time;
          return (
            <button
              key={s.time}
              onClick={() => onChange(active ? null : s.time)}
              aria-pressed={active}
              title={`${s.time}–${s.endsAt}`}
              className={`relative h-11 px-4 rounded-lg text-xs font-medium transition active:scale-95
                ${active
                  ? "bg-accent-warm text-accent-ink font-bold"
                  : "bg-white/[0.07] text-white/65 hover:bg-white/[0.14] hover:text-white"}`}
            >
              {s.time}
              {s.goldenHour && !active && (
                <Sun className="absolute -top-1 -right-1 w-3 h-3 text-accent-warm" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
// Fixed-slot events

/**
 * The mini-session picker: one date, eight blocks, some already gone.
 *
 * A separate component rather than a mode of StartTimePicker, because almost
 * nothing is shared. StartTimePicker DERIVES its slots from the weekday's
 * opening hours and the package's duration; these are a list somebody wrote
 * down, running past the hour the calendar thinks the day closes. Bending one
 * component around both would mean the hours config quietly deciding whether
 * the last mini-session of the day exists.
 *
 * Taken slots are rendered, not hidden. Eight rows with three struck through
 * says "this is filling up"; five rows says nothing at all.
 */
export function EventSlotPicker({ slots, startTime, onChange }: {
  slots: { time: string; state: "open" | "taken" }[];
  startTime: string | null;
  onChange: (time: string | null) => void;
}) {
  const { t } = useT();
  const openCount = slots.filter((s) => s.state === "open").length;

  if (openCount === 0) {
    return <p className="text-xs text-white/50">{t("book.eventSoldOut")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {slots.map((s) => {
          const active = startTime === s.time;
          const taken = s.state === "taken";
          return (
            <button
              key={s.time}
              disabled={taken}
              onClick={() => onChange(active ? null : s.time)}
              aria-pressed={active}
              aria-label={`${s.time} — ${t(taken ? "book.aria.booked" : "book.aria.open")}`}
              className={`h-11 rounded-lg text-xs font-medium transition active:scale-95
                ${active
                  ? "bg-accent-warm text-accent-ink font-bold"
                  : taken
                    ? "bg-white/[0.04] text-white/25 line-through cursor-not-allowed"
                    : "bg-white/[0.07] text-white/65 hover:bg-white/[0.14] hover:text-white"}`}
            >
              {s.time}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-white/35">
        {t("book.eventSlotsLeft").replace("{n}", String(openCount))}
      </p>
    </div>
  );
}
