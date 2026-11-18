import type { Money, RoomOffer } from '../types';
import { canonicalDecimal, cancellationTermsKey } from './offerReviewModel';
import { compareDecimalAmounts } from './resultsDecisionModel';

export type OfferChangeKind = 'price' | 'room' | 'meal' | 'taxes' | 'cancellation';
const money = (amount: string | null, currency: string | null) => [amount === null ? null : canonicalDecimal(amount), currency];
const priceKey = (offer: RoomOffer) => JSON.stringify(offer.price ? money(offer.price.amount, offer.price.currency) : null);
const taxKey = (offer: RoomOffer) => JSON.stringify(offer.taxes.map(tax =>
  JSON.stringify([tax.name, ...money(tax.amount, tax.currency_code), tax.included_by_supplier])).sort());

export type StayPriceChangeStatus = 'increase' | 'decrease' | 'unchanged' | 'differentCurrency' | 'unavailable';
export interface StayPriceChange {
  status: StayPriceChangeStatus;
  before: Readonly<Money> | null;
  after: Readonly<Money> | null;
  difference: Readonly<Money> | null;
}

export function sourceStayMoney(value: Money | null | undefined): Readonly<Money> | null {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.amount === 'string' && value.amount.length <= 128
    && /^\d+(?:\.\d+)?$/.test(value.amount) && typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
    ? Object.freeze({ amount: value.amount, currency: value.currency }) : null;
}

/** Exact unsigned subtraction. Only individual digits enter numeric arithmetic. */
function subtractAmounts(larger: string, smaller: string): string {
  const [wholeA, fractionA = ''] = canonicalDecimal(larger).split('.');
  const [wholeB, fractionB = ''] = canonicalDecimal(smaller).split('.');
  const scale = Math.max(fractionA.length, fractionB.length);
  const a = wholeA + fractionA.padEnd(scale, '0');
  const b = (wholeB + fractionB.padEnd(scale, '0')).padStart(a.length, '0');
  const digits: string[] = [];
  let borrowed = 0;
  for (let index = a.length - 1; index >= 0; index -= 1) {
    let digit = a.charCodeAt(index) - 48 - borrowed - (b.charCodeAt(index) - 48);
    borrowed = digit < 0 ? 1 : 0;
    if (borrowed) digit += 10;
    digits.push(String(digit));
  }
  const result = digits.reverse().join('');
  return canonicalDecimal(scale ? `${result.slice(0, -scale)}.${result.slice(-scale)}` : result);
}

/** Compare customer totals for the complete stay, without FX or minor-unit rounding. */
export function compareStayPrices(before: Money | null | undefined, after: Money | null | undefined): StayPriceChange {
  const oldPrice = sourceStayMoney(before), newPrice = sourceStayMoney(after);
  const result = (status: StayPriceChangeStatus, difference: Readonly<Money> | null = null): StayPriceChange =>
    Object.freeze({ status, before: oldPrice, after: newPrice, difference });
  if (!oldPrice || !newPrice) return result('unavailable');
  if (oldPrice.currency !== newPrice.currency) return result('differentCurrency');
  const order = compareDecimalAmounts(newPrice.amount, oldPrice.amount);
  const difference = Object.freeze({ amount: order >= 0 ? subtractAmounts(newPrice.amount, oldPrice.amount)
    : subtractAmounts(oldPrice.amount, newPrice.amount), currency: oldPrice.currency });
  return result(order > 0 ? 'increase' : order < 0 ? 'decrease' : 'unchanged', difference);
}


// Explain the same authoritative fields used by the review gate. This does not
// change acceptance, expiry, supplier state, price calculation or booking status.
export function changedOfferSections(before: RoomOffer, after: RoomOffer): OfferChangeKind[] {
  const changes: OfferChangeKind[] = [];
  if (priceKey(before) !== priceKey(after)) changes.push('price');
  if (before.name !== after.name || before.roomIdentity !== after.roomIdentity) changes.push('room');
  if ((before.meal ?? null) !== (after.meal ?? null)) changes.push('meal');
  if (taxKey(before) !== taxKey(after)) changes.push('taxes');
  if (cancellationTermsKey(before.cancellation) !== cancellationTermsKey(after.cancellation)) changes.push('cancellation');
  return changes;
}
