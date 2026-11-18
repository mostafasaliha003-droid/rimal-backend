import type { Language, PrebookResult, RoomOffer, SearchCriteria } from '../types';
import { ApiError } from '../api/errors';
import { assertCriteria, hotelId } from '../api/validation';
import type { CheckoutSelection } from './checkoutSessionModel';

export const REVIEW_SELECTION_LIFETIME_MS = 5 * 60_000;
export const REVIEW_CHECK_LIFETIME_MS = 2 * 60_000;
export interface OfferReviewInput {
  hid: number; hotelName: string; hotelAddress?: string; hotelImage?: string;
  criteria: SearchCriteria; offer: RoomOffer; language: Language;
}
export interface OfferReviewDraft extends OfferReviewInput {
  id: string; ownerKey: string; createdAt: number; searchKey: string;
}
export type ReviewStatus = 'idle' | 'pending' | 'ready' | 'changed' | 'error' | 'expired';
interface Snapshot {
  draftId: string | null; status: ReviewStatus; currentOffer: RoomOffer | null;
  changesAccepted: boolean; expiresAt: number | null; error: unknown; freshHotelRequired: boolean;
}
const initial = (draftId: string | null): Snapshot => ({ draftId, status: 'idle', currentOffer: null,
  changesAccepted: false, expiresAt: null, error: null, freshHotelRequired: false });

export function criteriaIdentity(criteria: SearchCriteria | null): string {
  return criteria ? JSON.stringify([criteria.checkin, criteria.checkout, criteria.residency, criteria.currency,
    criteria.guests.map(room => [room.adults, room.children]), criteria.regionId ?? null, criteria.hids ?? null]) : '';
}
export function copyCriteria(criteria: SearchCriteria): SearchCriteria {
  return { checkin: criteria.checkin, checkout: criteria.checkout, residency: criteria.residency,
    currency: criteria.currency, guests: criteria.guests.map(room => ({ adults: room.adults, children: [...room.children] })),
    ...(criteria.language ? { language: criteria.language } : {}),
    ...(criteria.regionId ? { regionId: criteria.regionId } : {}), ...(criteria.hids ? { hids: [...criteria.hids] } : {}) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
let sequence = 0;
export function createOfferReviewDraft(input: OfferReviewInput, ownerKey: string, now = Date.now()): OfferReviewDraft | null {
  try {
    if (hotelId(input.hid) === null || !input.hotelName.trim() || !['ar', 'en', 'es'].includes(input.language)
      || !ownerKey || !Number.isFinite(now)) return null;
    assertCriteria({ ...input.criteria, regionId: undefined, hids: [input.hid] });
    if (!input.offer.price || input.offer.price.currency !== input.criteria.currency
      || !input.offer.bookHash.startsWith('h-') || !input.offer.offerContext) return null;
    const criteria = copyCriteria(input.criteria);
    // A review is memory-only. Clone before freezing so caller-owned search and
    // hotel objects are never frozen or mutated by this screen.
    const offer = JSON.parse(JSON.stringify(input.offer)) as RoomOffer;
    return freeze({ hid: input.hid, hotelName: input.hotelName,
      ...(input.hotelAddress ? { hotelAddress: input.hotelAddress } : {}), ...(input.hotelImage ? { hotelImage: input.hotelImage } : {}),
      criteria, offer, language: input.language, id: `${now}-${++sequence}`, ownerKey, createdAt: now, searchKey: criteriaIdentity(criteria) });
  } catch { return null; }
}
export function canonicalDecimal(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.');
  const tail = fraction.replace(/0+$/, '');
  return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`;
}
export function cancellationTermsKey(terms: RoomOffer['cancellation']): string {
  const policies = terms.policies.map(policy => JSON.stringify([policy.startAt, policy.endAt,
    policy.startInvalid === true, policy.endInvalid === true,
    policy.amount === null ? null : canonicalDecimal(policy.amount), policy.currency])).sort();
  return JSON.stringify([terms.freeUntil, terms.freeUntilInvalid === true, terms.incomplete === true, policies]);
}
export function taxTermsKey(taxes: RoomOffer['taxes']): string {
  return JSON.stringify(taxes.map(tax => JSON.stringify([tax.name,
    tax.amount === null ? null : canonicalDecimal(tax.amount), tax.currency_code, tax.included_by_supplier])).sort());
}
export function offerTerms(offer: RoomOffer): string {
  const money = (amount: string | null, currency: string | null) => [amount === null ? null : canonicalDecimal(amount), currency];
  return JSON.stringify([offer.name, offer.roomIdentity ?? null, offer.meal ?? null, offer.price ? money(offer.price.amount, offer.price.currency) : null,
    offer.bedding ?? null, offer.paymentType ?? null, taxTermsKey(offer.taxes), cancellationTermsKey(offer.cancellation)]);
}

export function createOfferReviewSession({ getDraft, clearDraft, prebook, now = Date.now }: {
  getDraft: () => OfferReviewDraft | null; clearDraft: () => void;
  prebook: (hid: number, offer: RoomOffer, signal?: AbortSignal) => Promise<PrebookResult>; now?: () => number;
}) {
  let snapshot = initial(null), revision = 0, request: AbortController | null = null;
  let checkoutContext: string | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const cancel = () => { revision++; request?.abort(); request = null; checkoutContext = null; };
  function sync() {
    const draft = getDraft();
    if ((draft?.id ?? null) !== snapshot.draftId) { cancel(); publish(initial(draft?.id ?? null)); }
    if (draft && (now() >= draft.createdAt + REVIEW_SELECTION_LIFETIME_MS
      || snapshot.expiresAt !== null && now() >= snapshot.expiresAt) && snapshot.status !== 'expired') {
      cancel(); publish({ ...initial(draft.id), status: 'expired', freshHotelRequired: now() >= draft.createdAt + REVIEW_SELECTION_LIFETIME_MS });
    }
    return draft;
  }
  function presentation() {
    const draft = getDraft();
    const state = draft?.id === snapshot.draftId ? snapshot : initial(draft?.id ?? null);
    const selectionExpired = Boolean(draft && now() >= draft.createdAt + REVIEW_SELECTION_LIFETIME_MS);
    const checkExpired = state.expiresAt !== null && now() >= state.expiresAt;
    const status = selectionExpired || checkExpired ? 'expired' as const : state.status;
    const currentOffer = ['ready', 'changed'].includes(status) ? state.currentOffer : null;
    return { draft, status, currentOffer, error: state.error, changesAccepted: state.changesAccepted,
      confirmationRevision: status === 'changed' && currentOffer ? revision : null,
      canRecheck: Boolean(draft && status !== 'pending' && !selectionExpired && !state.freshHotelRequired),
      canContinue: Boolean(draft && currentOffer?.price && (status === 'ready' || status === 'changed' && state.changesAccepted)) };
  }
  async function recheck() {
    const draft = sync();
    if (!draft || !presentation().canRecheck) return;
    cancel(); const stamp = revision; const controller = new AbortController(); request = controller;
    publish({ ...initial(draft.id), status: 'pending' });
    try {
      // Always recheck the original signed hotel-page h-offer. A returned p-offer
      // is not a fresh search offer and must never become the next input.
      const result = await prebook(draft.hid, draft.offer, controller.signal);
      if (stamp !== revision || controller.signal.aborted) return;
      if (getDraft()?.id !== draft.id) { sync(); return; }
      const checkedAt = now();
      if (checkedAt >= draft.createdAt + REVIEW_SELECTION_LIFETIME_MS) { sync(); return; }
      const changed = result.priceChanged || offerTerms(draft.offer) !== offerTerms(result.offer);
      checkoutContext = result.prebookContext;
      publish({ ...initial(draft.id), status: changed ? 'changed' : 'ready', currentOffer: result.offer,
        expiresAt: Math.min(draft.createdAt + REVIEW_SELECTION_LIFETIME_MS, checkedAt + REVIEW_CHECK_LIFETIME_MS) });
    } catch (error) {
      if (stamp !== revision || controller.signal.aborted) return;
      if (getDraft()?.id !== draft.id) { sync(); return; }
      const expired = error instanceof ApiError && error.kind === 'validation';
      publish({ ...initial(draft.id), status: expired ? 'expired' : 'error', error, freshHotelRequired: expired });
    } finally { if (stamp === revision) request = null; }
  }
  function acceptChanges(confirmationRevision: number | null) {
    sync();
    const view = presentation();
    if (confirmationRevision !== null && confirmationRevision === view.confirmationRevision && !view.changesAccepted) {
      publish({ ...snapshot, changesAccepted: true });
    }
  }
  function getHandoff() {
    sync(); const view = presentation();
    return view.canContinue && view.draft ? { hid: view.draft.hid, criteria: copyCriteria(view.draft.criteria) } : null;
  }
  function getCheckoutReview(): CheckoutSelection | null {
    const view = presentation();
    if (!view.canContinue || !view.draft || !view.currentOffer?.price || !checkoutContext
      || snapshot.expiresAt === null || !view.currentOffer.bookHash.startsWith('p-')) return null;
    // This private RAM-only authority is separate from the search-only website
    // URL. Every use rechecks the current owner, selection, terms and clock.
    return freeze({ selectionId: `${view.draft.id}:${revision}`, expiresAt: snapshot.expiresAt,
      termsAccepted: true, review: { hid: view.draft.hid, hotelName: view.draft.hotelName,
        criteria: copyCriteria(view.draft.criteria),
        offer: JSON.parse(JSON.stringify(view.currentOffer)) as RoomOffer,
        prebookContext: checkoutContext } });
  }
  function clear() { cancel(); clearDraft(); publish(initial(null)); }
  return { getSnapshot: () => snapshot, presentation, sync, recheck, acceptChanges, getHandoff, getCheckoutReview, clear,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { cancel(); listeners.clear(); } };
}
