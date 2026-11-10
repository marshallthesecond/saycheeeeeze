// "2026-11-11" → { weekday: "Wed", date: "11 Nov" } in the reader's language.
//
// Written-out names rather than Intl.DateTimeFormat, for the same reason as
// formatPickDate in about/best-picks.ts: Node on Vercel and the visitor's
// browser ship different locale data, and a date the server prints one way and
// the browser another is a hydration mismatch.

const WEEKDAYS: Record<"en" | "ru" | "uz", readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  uz: ["Yak", "Du", "Se", "Chor", "Pay", "Ju", "Sha"],
};

const MONTHS: Record<"en" | "ru" | "uz", readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  uz: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"],
};

export interface DayLabel {
  iso: string;
  weekday: string;
  /** "11 Nov" · "11 ноя" · "11-noy" */
  date: string;
}

export function formatDay(iso: string, locale: string): DayLabel | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Local constructor, not new Date(iso): an ISO string parses as UTC and can
  // land on the previous weekday west of Greenwich.
  const day = new Date(y, mo - 1, d);
  const lang = locale === "ru" || locale === "uz" ? locale : "en";
  return {
    iso,
    weekday: WEEKDAYS[lang][day.getDay()],
    date: lang === "uz" ? `${d}-${MONTHS.uz[mo - 1]}` : `${d} ${MONTHS[lang][mo - 1]}`,
  };
}
