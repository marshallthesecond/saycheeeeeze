// Small formatting shared by the Studio's server and client components.

type T = (key: string, vars?: Record<string, string | number>) => string;

/** "840 KB", "61.2 MB", "12.4 GB", with the locale's decimal sign and units. */
export function formatBytes(bytes: number, locale: string, t: T): string {
  const n = Math.max(0, Number(bytes) || 0);
  const fmt = (v: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v);
  if (n < 1024 * 1024) return t("units.kb", { n: fmt(Math.max(1, Math.round(n / 1024)), 0) });
  if (n < 1024 * 1024 * 1024) return t("units.mb", { n: fmt(n / 1024 / 1024, 1) });
  return t("units.gb", { n: fmt(n / 1024 / 1024 / 1024, 1) });
}

/** "16 Nov 2026, 14:05" in the studio's time zone (Tashkent). */
export function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn" : locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(d);
}
