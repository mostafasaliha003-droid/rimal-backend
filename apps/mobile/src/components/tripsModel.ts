import type { BookingHistoryItem, BookingHistoryStatus } from '../api/bookings';
import { todayDate, validDate } from './calendarModel';

export type TripBucket = 'current' | 'upcoming' | 'past' | 'unknown';
export type TripFilter = 'all' | TripBucket;
export interface TripDates {
  checkin: string | null;
  checkout: string | null;
  nights: number | null;
  issue: 'missing' | 'invalid' | 'range' | null;
}
export interface TripRow {
  booking: BookingHistoryItem;
  bucket: TripBucket;
  dates: Readonly<TripDates>;
  statusKind: BookingHistoryStatus;
}
export interface TripsModel {
  today: string;
  rows: readonly Readonly<TripRow>[];
  counts: Readonly<Record<TripFilter, number>>;
}

const bucketOrder: Record<TripBucket, number> = { current: 0, upcoming: 1, past: 2, unknown: 3 };
const dayMilliseconds = 24 * 60 * 60 * 1000;

/** Device-local calendar today, independent of the UTC date at this instant. */
export function localTodayKey(now = new Date()): string {
  const value = todayDate(now);
  if (!Number.isFinite(now.getTime()) || !validDate(value)) throw new RangeError('invalid_trip_today');
  return value;
}

function dateKey(value: unknown): string | null {
  return typeof value === 'string' && validDate(value) ? value : null;
}

function tripDates(booking: BookingHistoryItem): Readonly<TripDates> {
  const checkin = dateKey(booking.checkin);
  const checkout = dateKey(booking.checkout);
  const invalid = (booking.checkin != null && !checkin) || (booking.checkout != null && !checkout);
  // Preserve each individually valid supplied date even when the pair is not a
  // usable range. The explicit issue prevents a partial/reversed stay becoming
  // a current, upcoming or past trip or acquiring a fabricated night count.
  const issue: TripDates['issue'] = invalid ? 'invalid' : !checkin || !checkout ? 'missing'
    : checkout <= checkin ? 'range' : null;
  const nights = issue || !checkin || !checkout ? null
    : (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / dayMilliseconds;
  return Object.freeze({ checkin, checkout, nights, issue });
}

function tripBucket(dates: Readonly<TripDates>, today: string): TripBucket {
  if (dates.issue || !dates.checkin || !dates.checkout) return 'unknown';
  // The Today navigation group includes departure day so the reference stays
  // easy to find on checkout morning. This does not claim current occupancy;
  // night counts still use the checkout-exclusive calendar range.
  if (dates.checkout < today) return 'past';
  return dates.checkin > today ? 'upcoming' : 'current';
}

function safeStatus(value: BookingHistoryStatus): BookingHistoryStatus {
  switch (value) {
    case 'confirmed': case 'cancelled': case 'pending': case 'failed': return value;
    default: return 'unknown';
  }
}

/** Date categories describe the supplied stay dates, never booking confirmation. */
export function buildTripsModel(bookings: readonly BookingHistoryItem[], today = localTodayKey()): TripsModel {
  if (!dateKey(today)) throw new RangeError('invalid_trip_today');
  const counts: Record<TripFilter, number> = { all: bookings.length, current: 0, upcoming: 0, past: 0, unknown: 0 };
  const indexed = bookings.map((booking, index) => {
    const dates = tripDates(booking);
    const bucket = tripBucket(dates, today);
    counts[bucket] += 1;
    return { index, row: Object.freeze({ booking, bucket, dates, statusKind: safeStatus(booking.statusKind) }) };
  });
  indexed.sort((a, b) => {
    if (a.row.bucket !== b.row.bucket) return bucketOrder[a.row.bucket] - bucketOrder[b.row.bucket];
    // Current: next checkout. Upcoming: next check-in. Past: most recent
    // checkout. Equal dates and unknown dates preserve the server's order.
    const field = a.row.bucket === 'upcoming' ? 'checkin' : 'checkout';
    const left = a.row.dates[field];
    const right = b.row.dates[field];
    if (a.row.bucket !== 'unknown' && left && right && left !== right) {
      const ascending = left < right ? -1 : 1;
      return a.row.bucket === 'past' ? -ascending : ascending;
    }
    return a.index - b.index;
  });
  return Object.freeze({ today, rows: Object.freeze(indexed.map(item => item.row)), counts: Object.freeze(counts) });
}

function lookupText(value: string): string {
  return value.normalize('NFKD').replace(/[\p{M}\u0640]/gu, '')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - (digit <= '\u0669' ? 0x0660 : 0x06f0)))
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Local presentation-only lookup; source spelling and complete-history counts remain untouched. */
export function filterTrips(model: TripsModel, filter: TripFilter, query = ''): readonly Readonly<TripRow>[] {
  const needle = lookupText(query);
  if (filter === 'all' && !needle) return model.rows;
  return model.rows.filter(row => (filter === 'all' || row.bucket === filter)
    && (!needle || lookupText(row.booking.hotelName || '').includes(needle) || lookupText(row.booking.reference).includes(needle)));
}

const dateFormatters = {
  en: new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory', timeZone: 'UTC' }),
  ar: new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory', timeZone: 'UTC' }),
};

/** Format a date-only value without shifting it into a neighbouring local day. */
export function formatTripDate(value: string | null, language: 'ar' | 'en'): string | null {
  const date = dateKey(value);
  return date ? dateFormatters[language].format(new Date(`${date}T00:00:00Z`)) : null;
}
