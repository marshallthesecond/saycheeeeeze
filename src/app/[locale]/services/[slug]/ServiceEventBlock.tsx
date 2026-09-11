'use client';

// src/app/[locale]/services/[slug]/ServiceEventBlock.tsx
//
// The dated thing the client is buying for — WIUT's graduation ceremony, in
// practice. Venue, schedule, how far away it is, and how many sessions are left.
//
// ── Why the countdown is a client component ──────────────────
// This page is statically generated (generateStaticParams, no dynamic export),
// so anything computed on the server is computed ONCE at build time and then
// served for weeks. A countdown rendered there would say "63 days" in January.
// Reading the clock in the browser is correct under any caching strategy, which
// is why the one number that changes daily lives here and everything else stays
// in the server component.
//
// The day count is rendered only after mount. The server has no clock the
// client agrees with, so rendering it on both sides guarantees a hydration
// mismatch; showing nothing for one frame is the cheaper trade.
//
// ── Why scarcity is conditional ──────────────────────────────
// "3 of 12 sessions left" only appears when `booked` is a real number that has
// moved. One ceremony, one day, one photographer is genuine scarcity — which is
// exactly why it must not be decorated. In a cohort where everyone knows
// everyone, an invented count is found out in a single Telegram message, and
// then nothing else on the page is believed either.

import { useEffect, useState } from 'react';
import { CalendarDays, MapPin, Info } from 'lucide-react';

interface Props {
  date?: string;
  label: string;
  venue?: string;
  note?: string;
  capacity?: number;
  booked?: number;
  accent: string;
  labels: {
    daysToGo: string;
    today: string;
    passed: string;
    dateTba: string;
    spotsLeft: string;
    fullyBooked: string;
  };
}

function daysUntil(iso: string): number | null {
  const target = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default function ServiceEventBlock({
  date,
  label,
  venue,
  note,
  capacity,
  booked,
  accent,
  labels,
}: Props) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    if (!date) return;
    setDays(daysUntil(date));
  }, [date]);

  const remaining =
    typeof capacity === 'number' && typeof booked === 'number'
      ? Math.max(0, capacity - booked)
      : null;

  // Nothing to say about scarcity until a session has actually been booked.
  const showScarcity = remaining !== null && booked! > 0;

  const dateLine = (() => {
    if (!date) return labels.dateTba;
    if (days === null) return null; // pre-hydration, or an unparseable date
    if (days > 1) return labels.daysToGo.replace('{n}', String(days));
    if (days === 1) return labels.daysToGo.replace('{n}', '1');
    if (days === 0) return labels.today;
    return labels.passed;
  })();

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: `${accent}55`, background: `${accent}12` }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accent }}
        >
          <CalendarDays className="h-4 w-4 text-white" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">{label}</p>

          {dateLine && (
            <p className="mt-0.5 text-sm font-semibold" style={{ color: accent }}>
              {dateLine}
            </p>
          )}

          {venue && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-white/60">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              {venue}
            </p>
          )}

          {note && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-white/50">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {note}
            </p>
          )}

          {showScarcity && (
            <p className="mt-3 text-xs font-semibold text-white/80">
              {remaining === 0
                ? labels.fullyBooked
                : labels.spotsLeft
                    .replace('{n}', String(remaining))
                    .replace('{total}', String(capacity))}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
