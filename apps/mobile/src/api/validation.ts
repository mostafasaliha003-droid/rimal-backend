import type { SearchCriteria } from '../types';
import residencies from './residencies.json';
import { ApiError } from './errors';

export const COUNTRY_CODES: readonly string[] = Object.freeze([...residencies]);
const countries = new Set(COUNTRY_CODES);
export function hotelId(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 9999999999 ? id : null;
}
export function calendarDay(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value ? day : null;
}
export function validateSearchCriteria(value: SearchCriteria, now = new Date()) {
  const errors: string[] = [];
  const start = calendarDay(value?.checkin), end = calendarDay(value?.checkout);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (start === null || start < today || start > today + 730 * 86400000) errors.push('invalid_checkin');
  if (end === null || start === null || end <= start || end - start > 30 * 86400000) errors.push('invalid_checkout');
  if (!countries.has(value?.residency)) errors.push('invalid_residency');
  if (!Array.isArray(value?.guests) || !value.guests.length || value.guests.length > 9 || value.guests.some(room =>
    !Number.isInteger(room?.adults) || room.adults < 1 || room.adults > 6 || !Array.isArray(room.children)
    || room.children.length > 4 || room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17))) errors.push('invalid_guests');
  if (typeof value?.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) errors.push('invalid_currency');
  const region = hotelId(value?.regionId);
  const hotels = Array.isArray(value?.hids) && value.hids.length > 0 && value.hids.length <= 100
    && value.hids.every(id => hotelId(id) !== null);
  if (!region && !hotels || region && value?.hids !== undefined) errors.push('invalid_destination');
  if (value?.language !== undefined && !['ar', 'en', 'es'].includes(value.language)) errors.push('invalid_language');
  return { valid: errors.length === 0, errors };
}
export function assertCriteria(value: SearchCriteria) {
  const result = validateSearchCriteria(value);
  if (!result.valid) throw new ApiError('validation', result.errors[0]);
}
export function searchBody(criteria: SearchCriteria) {
  assertCriteria(criteria);
  return { checkin: criteria.checkin, checkout: criteria.checkout, residency: criteria.residency,
    guests: criteria.guests.map(room => ({ adults: room.adults, children: [...room.children] })),
    currency: criteria.currency, language: 'en', display_language: criteria.language || 'en' };
}
