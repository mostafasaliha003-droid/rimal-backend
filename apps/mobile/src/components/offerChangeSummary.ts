import type { RoomOffer } from '../types';
import { canonicalDecimal, cancellationTermsKey } from './offerReviewModel';

export type OfferChangeKind = 'price' | 'room' | 'meal' | 'taxes' | 'cancellation';
const money = (amount: string | null, currency: string | null) => [amount === null ? null : canonicalDecimal(amount), currency];
const priceKey = (offer: RoomOffer) => JSON.stringify(offer.price ? money(offer.price.amount, offer.price.currency) : null);
const taxKey = (offer: RoomOffer) => JSON.stringify(offer.taxes.map(tax =>
  JSON.stringify([tax.name, ...money(tax.amount, tax.currency_code), tax.included_by_supplier])).sort());


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
