// src/lib/service-format.ts
//
// Turns the numbers on a package into the sentence a client reads, in their
// language.
//
// ── Why this file exists ─────────────────────────────────────
// Every one of the forty-nine packages carried three hand-written English
// phrases beside the numbers they described: "1 hour" next to durationMinutes:
// 60, "25–40 edited photos", "Delivery in 1 day". They were content in a data
// file, so /ru rendered a Russian page with an English price list in the middle
// of it — and they were a second copy of a number that already existed, free to
// drift from it.
//
// Rendering them from the numbers fixes both at once, for all sixteen services
// rather than the one that got noticed. There is nothing left to translate per
// package, so a new package cannot be added half-translated.
//
// ── Why not the dictionaries ─────────────────────────────────
// These are called from three places — the service page (server, has a
// dictionary), the booking form (client, has a hook) and the booking API route
// (server, has neither and wants English regardless, because the Telegram
// message goes to Marshall). Threading a dictionary through the route to
// produce English would be plumbing in service of nothing. Three languages of
// three phrases, stated here, is the smaller thing.

import type { DeliverySpec, PhotoCount, ServicePackage } from './services';
import { pickLocale } from './services';

type Lang = 'en' | 'ru' | 'uz';

function lang(locale: string): Lang {
  return locale === 'ru' || locale === 'uz' ? locale : 'en';
}

/**
 * Russian numeral agreement: 1 день, 2 дня, 5 дней, 11 дней, 21 день.
 *
 * Getting this wrong is not a cosmetic matter — "3 дней" is the kind of mistake
 * that tells a reader the page was machine-translated and nobody checked, on a
 * page whose entire argument is that somebody is paying attention.
 */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "1,5" in Russian and Uzbek, "1.5" in English. Whole numbers stay whole. */
function decimal(n: number, l: Lang): string {
  if (Number.isInteger(n)) return String(n);
  return l === 'en' ? String(n) : String(n).replace('.', ',');
}

function hours(n: number, l: Lang): string {
  const value = decimal(n, l);
  if (l === 'ru') {
    // A fraction always takes the genitive singular — 1,5 часа, 2,5 часа —
    // so only whole numbers go through the plural rule.
    const word = Number.isInteger(n) ? ruPlural(n, 'час', 'часа', 'часов') : 'часа';
    return `${value} ${word}`;
  }
  if (l === 'uz') return `${value} soat`;
  return `${value} ${n === 1 ? 'hour' : 'hours'}`;
}

function minutes(n: number, l: Lang): string {
  if (l === 'ru') return `${n} мин`;
  if (l === 'uz') return `${n} daqiqa`;
  return `${n} min`;
}

/**
 * How long the session runs: "1.5 hours", "1,5 часа", "1,5 soat".
 *
 * Half-hours read as a fraction because that is how people say them; any other
 * remainder falls back to "2 hours 20 min" rather than inventing "2.33 hours".
 */
export function formatDuration(totalMinutes: number, locale: string): string {
  const l = lang(locale);
  const whole = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;

  if (whole === 0) return minutes(rest, l);
  if (rest === 0) return hours(whole, l);
  if (rest === 30) return hours(whole + 0.5, l);
  return `${hours(whole, l)} ${minutes(rest, l)}`;
}

/** The same, honouring a package's "Full day"-style override. */
export function packageDuration(
  pkg: Pick<ServicePackage, 'duration' | 'durationMinutes'>,
  locale: string,
): string {
  return pkg.duration !== undefined
    ? pickLocale(pkg.duration, locale)
    : formatDuration(pkg.durationMinutes, locale);
}

/** "25–40 edited photos" · "25–40 обработанных фото" · "25–40 ta tayyor surat". */
export function formatPhotoCount(count: PhotoCount, locale: string): string {
  const l = lang(locale);
  // An en dash, not a hyphen: it is a range, and on a page where the type is
  // the product the difference is visible.
  const range = count.max === undefined ? `${count.min}+` : `${count.min}–${count.max}`;
  // Russian agreement follows the LAST number of a range, which is how the
  // phrase is read aloud.
  const governing = count.max ?? count.min;
  const portraits = count.of === 'portraits';

  if (l === 'ru') {
    const noun = portraits
      ? ruPlural(governing, 'портрет', 'портрета', 'портретов')
      : 'фото'; // indeclinable, so it is correct after any number
    const adj = portraits
      ? ruPlural(governing, 'обработанный', 'обработанных', 'обработанных')
      : 'обработанных';
    return `${range} ${adj} ${noun}`;
  }
  if (l === 'uz') {
    return `${range} ta tayyor ${portraits ? 'portret' : 'surat'}`;
  }
  return `${range} edited ${portraits ? 'portraits' : 'photos'}`;
}

/** "Delivery in 3 days", plus the same-evening preview where a package has one. */
export function formatDelivery(spec: DeliverySpec, locale: string): string {
  const l = lang(locale);
  const n = spec.days;

  if (l === 'ru') {
    const day = ruPlural(n, 'день', 'дня', 'дней');
    return spec.sameDayPreview
      ? `Превью в тот же день, полный набор за ${n} ${day}`
      : `Готово за ${n} ${day}`;
  }
  if (l === 'uz') {
    return spec.sameDayPreview
      ? `O‘sha kuni prevyu, to‘liq to‘plam ${n} kunda`
      : `${n} kunda tayyor`;
  }
  const day = n === 1 ? 'day' : 'days';
  return spec.sameDayPreview
    ? `Same-day preview, full set in ${n} ${day}`
    : `Delivery in ${n} ${day}`;
}
