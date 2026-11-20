import type { Money, RoomOffer } from '../types';

/*
 * RateHawk prices each rate for the guest's nationality, and a book hash is only valid for the
 * nationality it was searched with. When the guest gives a different nationality at checkout the
 * app searches the hotel again for it and looks for the same rate. Only an equivalent rate counts:
 * the same room classification (rg_ext) or name, meals, payment type and free-cancellation deadline.
 */

const meal = (offer: RoomOffer) => (offer.meal || '').trim().toLowerCase();
const sameTerms = (a: RoomOffer, b: RoomOffer) =>
  (a.roomIdentity && b.roomIdentity ? a.roomIdentity === b.roomIdentity : a.name === b.name)
  && meal(a) === meal(b) && Boolean(a.noChildMeal) === Boolean(b.noChildMeal)
  && a.paymentType === b.paymentType
  && (a.cancellation.freeUntil ?? null) === (b.cancellation.freeUntil ?? null);

const amount = (money: Money | null) => (money ? Number(money.amount) : Number.POSITIVE_INFINITY);

export function samePrice(a: Money | null, b: Money | null) {
  return Boolean(a && b && a.currency === b.currency && Number(a.amount) === Number(b.amount));
}

/** The equivalent rate at the new nationality: the same price if offered, otherwise the cheapest. */
export function matchOfferForNationality(original: RoomOffer, candidates: readonly RoomOffer[]): RoomOffer | null {
  const equivalent = candidates.filter(candidate => candidate.price && candidate.offerContext
    && !candidate.bookHash.startsWith('p-') && sameTerms(original, candidate));
  if (!equivalent.length) return null;
  return equivalent.find(candidate => samePrice(candidate.price, original.price))
    ?? [...equivalent].sort((a, b) => amount(a.price) - amount(b.price))[0];
}
