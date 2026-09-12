// Renders a package's numbers as the sentence a client reads, in their
// language: "1.5 hours", "40-60 edited photos", "Delivery in 2 days".
//
// These used to be hand-written English strings sitting next to the numbers
// they described, on all 49 packages. Rendering them means nothing is left to
// translate per package, and a new package cannot be added half-translated.
//
// Not in the dictionaries because the booking API route needs them and wants
// English regardless — its output goes to Marshall, not the client.

import type { DeliverySpec, PhotoCount, ServicePackage } from './services';
import { pickLocale } from './services';

type Lang = 'en' | 'ru' | 'uz';

function lang(locale: string): Lang {
  return locale === 'ru' || locale === 'uz' ? locale : 'en';
}

/** Russian numeral agreement: 1 день, 2 дня, 5 дней, 11 дней, 21 день. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "1,5" in Russian and Uzbek, "1.5" in English. */
function decimal(n: number, l: Lang): string {
  if (Number.isInteger(n)) return String(n);
  return l === 'en' ? String(n) : String(n).replace('.', ',');
}

function hours(n: number, l: Lang): string {
  const value = decimal(n, l);
  if (l === 'ru') {
    // A fraction always takes the genitive singular: 1,5 часа, 2,5 часа.
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
 * "1.5 hours" · "1,5 часа" · "1,5 soat".
 *
 * Half-hours read as a fraction; any other remainder falls back to
 * "2 hours 20 min" rather than inventing "2.33 hours".
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
  const range = count.max === undefined ? `${count.min}+` : `${count.min}–${count.max}`;
  // Russian agreement follows the last number of a range.
  const governing = count.max ?? count.min;
  const portraits = count.of === 'portraits';

  if (l === 'ru') {
    const noun = portraits
      ? ruPlural(governing, 'портрет', 'портрета', 'портретов')
      : 'фото'; // indeclinable, correct after any number
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

/** "Delivery in 3 days", plus the same-evening preview where there is one. */
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
