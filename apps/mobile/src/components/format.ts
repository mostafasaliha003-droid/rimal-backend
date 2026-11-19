import type { GuestRoom, Money } from '../types';

/*
 * One formatting voice for prices, dates and stay counts.
 * Both languages use Western digits (as supplier prices do) and day-first dates,
 * so a date, a night count and a total never mix digit systems on one line.
 */
export const LOCALES = { ar: 'ar-AE-u-nu-latn', en: 'en-GB' } as const;
export const localeFor = (language: string) => language === 'ar' ? LOCALES.ar : LOCALES.en;

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,6}))?$/;
const LRI = '⁦', PDI = '⁩';

function minorDigits(currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().minimumFractionDigits ?? 2; }
  catch { return 2; }
}

/** Groups thousands and pads to the currency's minor unit. Never rounds or truncates supplier digits. */
export function exactAmount(amount: string, currency: string): string | null {
  const match = DECIMAL.exec(amount.trim());
  if (!match || !/^[A-Z]{3}$/.test(currency)) return null;
  const whole = match[1].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (match[2] ?? '').padEnd(minorDigits(currency), '0');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** "AED 1,234.50", isolated left-to-right so it reads correctly inside Arabic sentences. */
export function formatMoney(money: Readonly<Money> | null | undefined, options: { isolate?: boolean } = {}): string | null {
  if (!money) return null;
  const amount = exactAmount(String(money.amount), money.currency);
  if (amount === null) return null;
  const text = `${money.currency} ${amount}`;
  return options.isolate === false ? text : LRI + text + PDI;
}

function utcDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Calendar date without shifting it into the device's neighbouring day. */
export function formatDay(value: string, language: string, options: { weekday?: boolean; year?: 'auto' | 'always' | 'never' } = {}) {
  const date = utcDay(value);
  if (!date) return value;
  const year = options.year === 'always' || (options.year !== 'never' && date.getUTCFullYear() !== new Date().getFullYear());
  return new Intl.DateTimeFormat(localeFor(language), { day: 'numeric', month: 'short', calendar: 'gregory', timeZone: 'UTC',
    ...(options.weekday ? { weekday: 'short' as const } : {}), ...(year ? { year: 'numeric' as const } : {}) }).format(date);
}

export function formatWeekday(value: string, language: string) {
  const date = utcDay(value);
  return date ? new Intl.DateTimeFormat(localeFor(language), { weekday: 'long', calendar: 'gregory', timeZone: 'UTC' }).format(date) : '';
}

export function nightsBetween(checkin: string, checkout: string): number | null {
  const start = utcDay(checkin), end = utcDay(checkout);
  if (!start || !end) return null;
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return nights >= 1 ? nights : null;
}

/** Arabic counted nouns: 1 and 2 have their own forms, 3-10 use the plural, 11+ the singular. */
function arabicCount(value: number, one: string, two: string, few: string, many: string) {
  return value === 1 ? one : value === 2 ? two : `${value} ${value <= 10 ? few : many}`;
}
const english = (value: number, one: string, other: string) => `${value} ${value === 1 ? one : other}`;

/**
 * Counted stay nouns. Arabic duals change after a preposition (لـ، في، بعد):
 * pass `genitive` there, e.g. "في غرفتين" rather than "في غرفتان".
 */
export function stayWords(language: string, { genitive = false }: { genitive?: boolean } = {}) {
  const ar = language === 'ar';
  const two = (nominative: string, oblique: string) => genitive ? oblique : nominative;
  return {
    nights: (n: number) => ar ? arabicCount(n, 'ليلة واحدة', two('ليلتان', 'ليلتين'), 'ليالٍ', 'ليلة') : english(n, 'night', 'nights'),
    rooms: (n: number) => ar ? arabicCount(n, 'غرفة واحدة', two('غرفتان', 'غرفتين'), 'غرف', 'غرفة') : english(n, 'room', 'rooms'),
    adults: (n: number) => ar ? arabicCount(n, 'بالغ واحد', two('بالغان', 'بالغين'), 'بالغين', 'بالغاً') : english(n, 'adult', 'adults'),
    children: (n: number) => ar ? arabicCount(n, 'طفل واحد', two('طفلان', 'طفلين'), 'أطفال', 'طفلاً') : english(n, 'child', 'children'),
    guests: (n: number) => ar ? arabicCount(n, 'ضيف واحد', two('ضيفان', 'ضيفين'), 'ضيوف', 'ضيفاً') : english(n, 'guest', 'guests'),
  };
}

/** "Tomorrow", "In 2 days"; Arabic uses the genitive after بعد ("بعد يومين"). */
export function untilLabel(days: number, language: string) {
  const ar = language === 'ar';
  if (days <= 0) return ar ? 'إقامتك جارية' : 'Staying now';
  if (days === 1) return ar ? 'غداً' : 'Tomorrow';
  return ar ? `بعد ${arabicCount(days, 'يوم واحد', 'يومين', 'أيام', 'يوماً')}` : `In ${days} days`;
}

export function occupancy(rooms: readonly GuestRoom[]) {
  const adults = rooms.reduce((sum, room) => sum + room.adults, 0);
  const children = rooms.reduce((sum, room) => sum + room.children.length, 0);
  return { rooms: rooms.length, adults, children, guests: adults + children };
}

/** "2 adults · 2 children · 2 rooms" */
export function guestLine(rooms: readonly GuestRoom[], language: string) {
  const words = stayWords(language), count = occupancy(rooms);
  return [words.adults(count.adults), count.children ? words.children(count.children) : '', words.rooms(count.rooms)].filter(Boolean).join(' · ');
}

/** "3 nights · 2 rooms · 4 guests": the context every price is quoted for. */
export function stayLine(nights: number | null, rooms: readonly GuestRoom[], language: string) {
  const words = stayWords(language), count = occupancy(rooms);
  return [nights ? words.nights(nights) : '', words.rooms(count.rooms), words.guests(count.guests)].filter(Boolean).join(' · ');
}

/** "Room 1: 1 adult, 1 child (8)" for each room. */
export function roomLines(rooms: readonly GuestRoom[], language: string) {
  const words = stayWords(language), ar = language === 'ar';
  return rooms.map((room, index) => {
    const ages = room.children.length ? ` (${room.children.join(ar ? '، ' : ', ')})` : '';
    const people = [words.adults(room.adults), room.children.length ? words.children(room.children.length) + ages : ''].filter(Boolean);
    return `${ar ? 'الغرفة' : 'Room'} ${index + 1}: ${people.join(ar ? '، ' : ', ')}`;
  });
}
