"use client";

// The "next free day" readout, in two forms:
//
//   line   ● NEXT FREE DAY · WED 11 NOV       — the Home profile panel
//   chips  three day buttons, each a link to the booking form — About's card
//
// The dot is the camera's recording light, in the brand red. The days come
// from nextFreeDays() on the server, so they follow the real calendar:
// bookings, holds, blackouts and event dates. Nothing renders when there are
// none, rather than a line that says "no free days".

import Link from "next/link";
import { useT } from "@/src/lib/i18n/LanguageProvider";
import { formatDay, type DayLabel } from "@/src/lib/format-day";

export default function FreeDays({
  days,
  variant,
  className = "",
}: {
  /** ISO dates, earliest first. */
  days: string[];
  variant: "line" | "chips";
  className?: string;
}) {
  const { t, locale } = useT();
  const labels = days.map((d) => formatDay(d, locale)).filter((d): d is DayLabel => d !== null);
  if (labels.length === 0) return null;

  const heading = (
    <p className="flex min-w-0 items-center gap-2 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
      {variant === "line" ? (
        <span className="truncate">
          {t("profile.nextFreeDay")} · {labels[0].weekday} {labels[0].date}
        </span>
      ) : (
        <span>{t("profile.nextFreeDays")}</span>
      )}
    </p>
  );

  if (variant === "line") return <div className={className}>{heading}</div>;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {heading}
      <ul className="grid grid-cols-3 gap-1.5">
        {labels.map((d) => (
          <li key={d.iso}>
            <Link
              href={`/${locale}/book`}
              aria-label={t("profile.bookOn", { day: `${d.weekday} ${d.date}` })}
              className="flex h-12 flex-col items-center justify-center rounded-lg border border-input text-foreground transition hover:bg-foreground/6 active:scale-[0.98]"
            >
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{d.weekday}</span>
              <span className="text-[13px] font-semibold leading-tight whitespace-nowrap">{d.date}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
