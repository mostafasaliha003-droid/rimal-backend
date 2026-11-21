import { APP_ENV, endpoints } from './config';
import { ApiError, invalidResponse } from './errors';
import { validToken } from './transport';
import type { BookingHistoryItem } from './bookings';
import type { Language } from '../types';

export const canDownloadVoucher = (booking: BookingHistoryItem) =>
  booking.recordedStatus?.trim().toLowerCase() === 'active' && booking.supplierStatus?.trim().toUpperCase() === 'CONFIRMED';

export async function fetchVoucher(booking: BookingHistoryItem, language: Language, token: string, signal: AbortSignal) {
  if (!validToken(token) || !canDownloadVoucher(booking)) throw new ApiError('auth', 'voucher_unavailable');
  const reference = booking.reference;
  if (!reference || reference.length > 200 || /[\x00-\x1f\x7f/\\]/.test(reference) || reference === '.' || reference === '..') throw invalidResponse();
  const url = new URL(endpoints(APP_ENV).api + '/owned/bookings/pdf/' + encodeURIComponent(reference));
  url.searchParams.set('language', language === 'ar' ? 'ar' : 'en');
  const response = await fetch(url.href, { method: 'GET', signal, credentials: 'omit', redirect: 'error',
    headers: { Accept: 'application/pdf', Authorization: 'Bearer ' + token } });
  if (!response.ok || response.redirected || (response.url && response.url !== url.href) ||
      response.headers.get('content-type')?.split(';')[0].toLowerCase() !== 'application/pdf' ||
      Number(response.headers.get('content-length') || 0) > 12 * 1024 * 1024) throw invalidResponse();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 12 * 1024 * 1024 || bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw invalidResponse();
  return bytes;
}

/** The cancellation receipt for an owned booking (PDF). */
export async function fetchCancellationReceipt(reference: string, token: string, signal: AbortSignal) {
  if (!validToken(token)) throw new ApiError('auth', 'receipt_unavailable');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) throw invalidResponse();
  const url = new URL(endpoints(APP_ENV).api + '/owned/bookings/' + reference + '/cancellation/receipt');
  const response = await fetch(url.href, { method: 'GET', signal, credentials: 'omit', redirect: 'error',
    headers: { Accept: 'application/pdf', Authorization: 'Bearer ' + token } });
  if (!response.ok || response.redirected || (response.url && response.url !== url.href) ||
      response.headers.get('content-type')?.split(';')[0].toLowerCase() !== 'application/pdf' ||
      Number(response.headers.get('content-length') || 0) > 12 * 1024 * 1024) throw invalidResponse();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 12 * 1024 * 1024 || bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw invalidResponse();
  return bytes;
}
