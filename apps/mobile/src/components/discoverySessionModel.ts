import type { HotelSummary, Money, SearchCriteria } from '../types';
import { hotelId, validateSearchCriteria } from '../api/validation';
import { images } from '../api/adapters';
import { copyCriteria, criteriaIdentity } from './offerReviewModel';

export const COMPARISON_PRICE_LIFETIME_MS = 5 * 60_000;
export const COMPARISON_LIMIT = 3;
export interface ComparisonHotel {
  hid: number; name: string; address?: string; stars?: number; imageUrl?: string;
  price: Money | null; capturedAt: number; priceExpired?: boolean;
}
export interface ComparisonSelection { contextKey: string; items: ComparisonHotel[] }
export type ComparisonOutcome = 'added' | 'removed' | 'limit' | 'context_changed' | 'unavailable';
export interface RecentSearch { id: string; name: string; criteria: SearchCriteria; createdAt: number }
export interface RecentSearchSelection { ownerKey: string; items: RecentSearch[] }

export const emptyComparison = (): ComparisonSelection => ({ contextKey: '', items: [] });
export const emptyRecentSearches = (): RecentSearchSelection => ({ ownerKey: '', items: [] });
const cleanText = (value: unknown, max: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function snapshot(hotel: HotelSummary, currency: string, now: number): ComparisonHotel | null {
  const hid = hotelId(hotel?.hid), name = cleanText(hotel?.name, 500);
  if (hid === null || !name || !Number.isFinite(now) || !/^[A-Z]{3}$/.test(currency)) return null;
  const raw = hotel.price;
  const price = raw && raw.currency === currency && typeof raw.amount === 'string'
    && /^\d+(?:\.\d+)?$/.test(raw.amount) && raw.amount.length <= 128 && Number.isFinite(Number(raw.amount))
    ? { amount: raw.amount, currency: raw.currency } : null;
  const address = cleanText(hotel.address, 1000), imageUrl = images(hotel.imageUrl)[0];
  return freeze({ hid, name, ...(address ? { address } : {}),
    ...(Number.isInteger(hotel.stars) && Number(hotel.stars) >= 1 && Number(hotel.stars) <= 5 ? { stars: hotel.stars } : {}),
    ...(imageUrl ? { imageUrl } : {}), price, capturedAt: now });
}

// Selection holds presentation fields only: no rates, signed offers, account
// identity, tokens or guest/payment records. Expected context blocks old handlers.
export function toggleComparisonSelection(selection: ComparisonSelection, hotel: HotelSummary,
  currentContextKey: string, expectedContextKey: string, currency: string, now = Date.now()) {
  if (!currentContextKey || currentContextKey !== expectedContextKey) return { selection, outcome: 'context_changed' as ComparisonOutcome };
  const items = selection.contextKey === currentContextKey ? selection.items : [];
  const id = hotelId(hotel?.hid);
  if (id !== null && items.some(item => item.hid === id)) return {
    selection: { contextKey: currentContextKey, items: items.filter(item => item.hid !== id) }, outcome: 'removed' as ComparisonOutcome };
  if (items.length >= COMPARISON_LIMIT) return { selection, outcome: 'limit' as ComparisonOutcome };
  const item = snapshot(hotel, currency, now);
  return item ? { selection: { contextKey: currentContextKey, items: [...items, item] }, outcome: 'added' as ComparisonOutcome }
    : { selection, outcome: 'unavailable' as ComparisonOutcome };
}
export function comparisonItemsFor(selection: ComparisonSelection, currentContextKey: string, now = Date.now()): ComparisonHotel[] {
  if (!currentContextKey || selection.contextKey !== currentContextKey || !Number.isFinite(now)) return [];
  return selection.items.map(item => {
    const expired = now < item.capturedAt || now >= item.capturedAt + COMPARISON_PRICE_LIFETIME_MS;
    return freeze({ ...item, price: expired ? null : item.price, priceExpired: expired && item.price !== null });
  });
}
export function removeComparisonSelection(selection: ComparisonSelection, hid: number, currentContextKey: string,
  expectedContextKey: string): ComparisonSelection {
  if (!currentContextKey || currentContextKey !== expectedContextKey || selection.contextKey !== currentContextKey) return selection;
  return { contextKey: currentContextKey, items: selection.items.filter(item => item.hid !== hid) };
}

// Recent queries are session-only, copied and validated again before display.
// Resuming a query fills the form; this model never performs a request.
export function addRecentSearch(selection: RecentSearchSelection, ownerKey: string, criteria: SearchCriteria,
  name: string, now = Date.now()): RecentSearchSelection {
  const title = cleanText(name, 500);
  if (!ownerKey || !title || !Number.isFinite(now) || !validateSearchCriteria(criteria, new Date(now)).valid) return selection;
  const copied = copyCriteria(criteria), id = criteriaIdentity(copied);
  const previous = selection.ownerKey === ownerKey ? selection.items : [];
  const item = freeze({ id, name: title, criteria: copied, createdAt: now });
  return { ownerKey, items: [item, ...previous.filter(value => value.id !== id)].slice(0, 4) };
}
export function recentSearchesFor(selection: RecentSearchSelection, ownerKey: string, now = Date.now()): RecentSearch[] {
  if (!ownerKey || selection.ownerKey !== ownerKey || !Number.isFinite(now)) return [];
  return selection.items.filter(item => item.createdAt <= now && validateSearchCriteria(item.criteria, new Date(now)).valid);
}
