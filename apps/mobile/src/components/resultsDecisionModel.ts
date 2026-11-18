import type { HotelSummary, Money, SearchCriteria } from '../types';

export type ResultSort = 'recommended' | 'lowPrice' | 'highPrice';
export interface ResultFilters { name: string; maxBudget: string; stars: number[]; sort: ResultSort }
export const emptyResultFilters = (): ResultFilters => ({ name: '', maxBudget: '', stars: [], sort: 'recommended' });
export const copyResultFilters = (value: ResultFilters): ResultFilters => ({ ...value, stars: [...value.stars] });

function decimal(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  const tail = fraction.replace(/0+$/, '');
  return `${integer.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`;
}
export function compareDecimalAmounts(left: string, right: string): number {
  const a = decimal(left), b = decimal(right);
  if (a === null || b === null) throw new Error('invalid_decimal');
  const [aw, af = ''] = a.split('.'), [bw, bf = ''] = b.split('.');
  if (aw.length !== bw.length) return aw.length < bw.length ? -1 : 1;
  if (aw !== bw) return aw < bw ? -1 : 1;
  const length = Math.max(af.length, bf.length), ap = af.padEnd(length, '0'), bp = bf.padEnd(length, '0');
  return ap === bp ? 0 : ap < bp ? -1 : 1;
}
export function priceInCurrency(price: Money | null | undefined, currency: string): Money | null {
  return price && /^[A-Z]{3}$/.test(currency) && price.currency === currency && typeof price.amount === 'string'
    && price.amount.length <= 128 && Number.isFinite(Number(price.amount)) && decimal(price.amount) !== null ? price : null;
}
export function parseStayBudget(input: string): { valid: boolean; amount: string | null } {
  const value = input.trim().replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => {
    const code = digit.charCodeAt(0); return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  }).replace(/\u066b/g, '.').replace(/\u066c/g, ',');
  if (!value) return { valid: true, amount: null };
  if (!/^(?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,6})?$/.test(value)) return { valid: false, amount: null };
  const amount = decimal(value.replace(/,/g, ''));
  return amount !== null && amount !== '0' ? { valid: true, amount } : { valid: false, amount: null };
}
const searchable = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
export const starFacet = (hotel: HotelSummary) => Number.isInteger(hotel.stars) && Number(hotel.stars) >= 1 && Number(hotel.stars) <= 5 ? Number(hotel.stars) : 0;
export function activeResultFilters(filters: ResultFilters): number {
  return Number(Boolean(filters.name.trim())) + Number(Boolean(filters.maxBudget.trim())) + Number(filters.stars.length > 0);
}
export function decideResults(hotels: readonly HotelSummary[], filters: ResultFilters, currency: string) {
  const budget = parseStayBudget(filters.maxBudget), query = searchable(filters.name);
  const selected = new Set(filters.stars.filter(value => Number.isInteger(value) && value >= 0 && value <= 5));
  const matchesName = (hotel: HotelSummary) => !query || searchable(hotel.name).includes(query);
  const nameAndBudget = hotels.filter(hotel => {
    if (!budget.valid || !matchesName(hotel)) return false;
    const price = priceInCurrency(hotel.price, currency);
    return budget.amount === null || price !== null && compareDecimalAmounts(price.amount, budget.amount) <= 0;
  });
  const facetCounts = [0, 0, 0, 0, 0, 0];
  nameAndBudget.forEach(hotel => { facetCounts[starFacet(hotel)]++; });
  const ranked = nameAndBudget.map((hotel, index) => ({ hotel, index })).filter(({ hotel }) => !selected.size || selected.has(starFacet(hotel)));
  if (filters.sort !== 'recommended') ranked.sort((left, right) => {
    const a = priceInCurrency(left.hotel.price, currency), b = priceInCurrency(right.hotel.price, currency);
    if (!a || !b) return a ? -1 : b ? 1 : left.index - right.index;
    const order = compareDecimalAmounts(a.amount, b.amount);
    return (filters.sort === 'highPrice' ? -order : order) || left.index - right.index;
  });
  return { hotels: ranked.map(item => item.hotel), facetCounts, budget,
    unknownPriceCount: hotels.filter(hotel => matchesName(hotel) && (!selected.size || selected.has(starFacet(hotel))) && !priceInCurrency(hotel.price, currency)).length };
}
export function stayNights(criteria: Pick<SearchCriteria, 'checkin' | 'checkout'> | null): number | null {
  const day = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
  };
  if (!criteria) return null;
  const start = day(criteria.checkin), end = day(criteria.checkout);
  return start !== null && end !== null && end > start ? (end - start) / 86400000 : null;
}
export function resultContextKey(plan: string | undefined, language: string, status: string, revision: number): string {
  return JSON.stringify([plan ?? null, language, status, revision]);
}
export interface ResultSnapshot { context: string; hotels: HotelSummary[]; pending: boolean; error: unknown }
export function beginResultRefresh(previous: ResultSnapshot, context: string): ResultSnapshot {
  return { context, hotels: previous.context === context ? previous.hotels : [], pending: true, error: null };
}
