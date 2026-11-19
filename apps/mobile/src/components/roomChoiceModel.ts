import type { Money, RoomOffer } from '../types';
import { presentCancellation } from './cancellationPresentationModel';
import { translatedMeal } from './hotelPoliciesData.js';

export type RoomChoiceSort = 'original' | 'price';
export type MealFacet = { kind: 'all' } | { kind: 'value'; value: string } | { kind: 'missing' };
export interface MealPlanOption { value: string | null; count: number; fromPrice: Money | null }
export interface RoomChoiceEntry { key: string; index: number; offer: RoomOffer }
export interface RoomChoiceGroup {
  key: string; identity: string | null; name: string; entries: RoomChoiceEntry[]; totalCount: number; freeNowCount: number; fromPrice: Money | null;
  lowestReviewable: RoomChoiceEntry | null;
}
export interface RoomChoiceOptions { currency: string; query?: string; meal?: MealFacet; roomKey?: string; sort?: RoomChoiceSort; freeOnly?: boolean; now?: number }

const mealValue = (offer: RoomOffer) => typeof offer.meal === 'string' && offer.meal.trim() ? offer.meal : null;
const identityValue = (offer: RoomOffer) => typeof offer.roomIdentity === 'string' && offer.roomIdentity.trim() ? offer.roomIdentity : null;
const searchText = (value: string) => value.normalize('NFKC').toLowerCase();
function decimal(value: string) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return { whole: whole.replace(/^0+(?=\d)/, ''), fraction: fraction.replace(/0+$/, '') };
}
export function compareRoomAmounts(left: string, right: string): number {
  const a = decimal(left), b = decimal(right);
  if (!a || !b) throw new Error('invalid_room_price');
  if (a.whole.length !== b.whole.length) return a.whole.length - b.whole.length;
  if (a.whole !== b.whole) return a.whole < b.whole ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(width, '0'), bf = b.fraction.padEnd(width, '0');
  return af === bf ? 0 : af < bf ? -1 : 1;
}
function comparable(price: Money | null, currency: string): price is Money {
  return Boolean(price && /^[A-Z]{3}$/.test(currency) && price.currency === currency && decimal(price.amount));
}
export function canReviewRoomOffer(offer: RoomOffer, requestedCurrency: string): boolean {
  return comparable(offer.price, requestedCurrency) && Boolean(offer.offerContext && offer.bookHash.startsWith('h-'));
}
export function roomMealLabel(value: string | undefined, roomOnly: string, unavailable: string, language = 'en'): string {
  if (!value?.trim()) return unavailable;
  return value === 'nomeal' ? roomOnly : translatedMeal(value, language) ?? value.replace(/[-_]/g, ' ');
}
function priceOrder(left: RoomChoiceEntry, right: RoomChoiceEntry, currency: string): number {
  const a = comparable(left.offer.price, currency), b = comparable(right.offer.price, currency);
  if (a && b) return compareRoomAmounts(left.offer.price!.amount, right.offer.price!.amount) || left.index - right.index;
  return a ? -1 : b ? 1 : left.index - right.index;
}
export function roomMealFacets(offers: readonly RoomOffer[]): { values: string[]; hasMissing: boolean } {
  const values = new Set<string>(); let hasMissing = false;
  for (const offer of offers) { const meal = mealValue(offer); if (meal === null) hasMissing = true; else values.add(meal); }
  return { values: [...values], hasMissing };
}

// This is a display model, not a supplier-rate normalizer. Entries retain the
// original object and occurrence, including duplicate hashes and rate variants.
export function buildRoomChoices(offers: readonly RoomOffer[], {
  currency, query = '', meal = { kind: 'all' }, roomKey, sort = 'original', freeOnly = false, now = Date.now(),
}: RoomChoiceOptions) {
  const entries = offers.map((offer, index) => ({ offer, index, key: JSON.stringify([offer.id, offer.bookHash, index]) }));
  const groupKey = (entry: RoomChoiceEntry) => {
    const identity = identityValue(entry.offer);
    return identity === null ? `unknown:${entry.key}` : `identity:${identity}`;
  };
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(groupKey(entry), (totals.get(groupKey(entry)) || 0) + 1);
  const needle = searchText(query.trim());
  const matchesMeal = (offer: RoomOffer) => meal.kind === 'all' ? true
    : meal.kind === 'missing' ? mealValue(offer) === null : mealValue(offer) === meal.value;
  const options = entries.filter(({ offer }) => !needle || searchText(offer.name).includes(needle))
    .map(entry => ({ ...entry, freeNow: presentCancellation(entry.offer.cancellation, now).kind === 'free' }))
    .filter(entry => !freeOnly || entry.freeNow);
  const mealPlans = new Map<string | null, MealPlanOption>();
  for (const entry of options) {
    if (roomKey && roomKey !== groupKey(entry)) continue;
    const { offer } = entry;
    const value = mealValue(offer);
    let plan = mealPlans.get(value);
    if (!plan) { plan = { value, count: 0, fromPrice: null }; mealPlans.set(value, plan); }
    plan.count++;
    if (comparable(offer.price, currency) && (!plan.fromPrice || compareRoomAmounts(offer.price.amount, plan.fromPrice.amount) < 0)) {
      plan.fromPrice = offer.price;
    }
  }
  const matching = options.filter(({ offer }) => matchesMeal(offer));
  if (sort === 'price') matching.sort((left, right) => priceOrder(left, right, currency));
  const grouped = new Map<string, RoomChoiceGroup>();
  let fromPrice: Money | null = null;
  for (const entry of matching) {
    const key = groupKey(entry);
    let group = grouped.get(key);
    if (!group) {
      group = { key, identity: identityValue(entry.offer), name: entry.offer.name, entries: [], totalCount: totals.get(key)!, freeNowCount: 0, fromPrice: null, lowestReviewable: null };
      grouped.set(key, group);
    }
    group.entries.push(entry);
    // Keep the exact matching occurrence so its terms and review context travel together.
    if (canReviewRoomOffer(entry.offer, currency) && (!group.lowestReviewable || priceOrder(entry, group.lowestReviewable, currency) < 0)) {
      group.lowestReviewable = entry;
    }
    if (entry.freeNow) group.freeNowCount++;
    const price = entry.offer.price;
    if (comparable(price, currency)) {
      if (!group.fromPrice || compareRoomAmounts(price.amount, group.fromPrice.amount) < 0) group.fromPrice = price;
      if (!fromPrice || compareRoomAmounts(price.amount, fromPrice.amount) < 0) fromPrice = price;
    }
  }
  // Insertion follows sorted entries: each group's first comparable offer is
  // its lowest matching price. Other-currency and unknown prices stay last.
  const roomTypes = [...grouped.values()];
  const chosen = roomKey ? grouped.get(roomKey) : undefined;
  const groups = roomKey ? (chosen ? [chosen] : []) : roomTypes;
  return { roomTypes, groups, matchingOffers: roomKey ? chosen?.entries.length ?? 0 : matching.length,
    totalOffers: offers.length, totalGroups: totals.size, fromPrice: roomKey ? chosen?.fromPrice ?? null : fromPrice,
    meals: roomMealFacets(offers), mealOptions: [...mealPlans.values()] };
}

export function roomHotelId(parameter: unknown): number | null {
  if (typeof parameter !== 'string' || !/^[1-9]\d{0,9}$/.test(parameter)) return null;
  const value = Number(parameter);
  return Number.isSafeInteger(value) ? value : null;
}
