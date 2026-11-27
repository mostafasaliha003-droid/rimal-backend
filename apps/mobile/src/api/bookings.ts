import type { Money } from '../types';
import type { createTransport } from './transport';
import { invalidResponse } from './errors';

export type BookingHistoryStatus = 'confirmed' | 'cancelled' | 'pending' | 'failed' | 'unknown';
export interface BookingHistoryItem {
  reference: string;
  hotelName: string | null;
  /** The supplier's approved Arabic name, when the catalogue has one (the English name stays the booking identity). */
  hotelNameAr?: string | null;
  roomName: string | null;
  checkin: string | null;
  checkout: string | null;
  recordedStatus: string | null;
  supplierStatus: string | null;
  statusKind: BookingHistoryStatus;
  price: Money | null;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(result) ? result : null;
}
function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
}
function statusValue(value: string | null): BookingHistoryStatus | null {
  switch (value?.toLowerCase().replace(/[ -]+/g, '_')) {
    case 'confirmed': case 'booking_confirmed': return 'confirmed';
    case 'cancelled': case 'canceled': case 'booking_cancelled': return 'cancelled';
    case 'pending': case 'processing': case 'on_request': case 'booking_pending': return 'pending';
    case 'failed': case 'booking_failed': return 'failed';
    default: return null;
  }
}
function statusKind(recorded: string | null, supplier: string | null): BookingHistoryStatus {
  const local = statusValue(recorded);
  const remote = statusValue(supplier);
  if (local && local !== 'confirmed') return local;
  // "active" is the persisted record state, not proof of supplier confirmation.
  if (recorded && !local && recorded.toLowerCase() !== 'active') return 'unknown';
  if (remote && remote !== 'confirmed') return remote;
  return local || remote || 'unknown';
}
function customerPrice(row: RecordValue): Money | null {
  // These public Booking records persist customer charged/locked sell amounts.
  // Never fall back to a supplier/net amount or guess the currency.
  if (typeof row.provider !== 'string' || !['ratehawk', 'hotelbeds'].includes(row.provider.toLowerCase())) return null;
  const amount = typeof row.price === 'number' && Number.isFinite(row.price) && row.price >= 0
    ? String(row.price) : typeof row.price === 'string' ? row.price : '';
  const currency = typeof row.priceCurrency === 'string' ? row.priceCurrency : '';
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency };
}

function arabicName(value: unknown): string | null {
  const name = text(value, 256);
  return name && /\p{Script=Arabic}/u.test(name) ? name : null;
}

/** The hotel's name in the interface language: the Arabic catalogue name in Arabic, otherwise the booked name. */
export function bookingHotelName(booking: Pick<BookingHistoryItem, 'hotelName' | 'hotelNameAr'>, language: string): string | null {
  return language === 'ar' && booking.hotelNameAr ? booking.hotelNameAr : booking.hotelName;
}

export function normalizeBookingHistory(value: unknown): BookingHistoryItem[] {
  if (!record(value) || value.success !== true || !Array.isArray(value.bookings)) throw invalidResponse();
  const references = new Set<string>();
  return value.bookings.map((item: unknown) => {
    if (!record(item)) throw invalidResponse();
    const reference = text(item.bookingReference, 200);
    if (!reference || references.has(reference)) throw invalidResponse();
    references.add(reference);
    let checkin = calendarDate(item.checkInDate);
    let checkout = calendarDate(item.checkOutDate);
    if (checkin && checkout && checkout <= checkin) { checkin = null; checkout = null; }
    const recordedStatus = text(item.status, 80);
    const supplierStatus = text(item.supplierStatus, 80);
    return {
      reference, hotelName: text(item.hotelName, 256), hotelNameAr: arabicName(item.hotelNameAr), roomName: text(item.roomType, 256),
      checkin, checkout, recordedStatus, supplierStatus,
      statusKind: statusKind(recordedStatus, supplierStatus), price: customerPrice(item),
    };
  });
}

export async function getOwnedBookings(request: ReturnType<typeof createTransport>, signal?: AbortSignal): Promise<BookingHistoryItem[]> {
  // Identity is carried by the existing session transport. No email/owner query
  // or response profile/contact/card data enters the native history model.
  return normalizeBookingHistory(await request('GET', '/user/profile', { signal, timeoutMs: 20000 }));
}
