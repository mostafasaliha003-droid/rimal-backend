import type { AppEnvironment, RoomOffer, SearchCriteria } from '../types';
import { APP_ENV, appScheme, resolveEnvironment } from './config';
import { ApiError, invalidResponse } from './errors';
import { assertCriteria, hotelId } from './validation';
import { chargeCurrency, paymentCurrencyUnits as units } from './paymentCurrencies';
import type { createTransport } from './transport';
import { getOwnedBookings } from './bookings';
import { AFTER_GUEST_CANCELLATION } from './checkoutStatuses';
import { TABBY_REJECTIONS, type TabbyRejection } from '../components/tabbyModel';

export type PaymentMode = 'sandbox' | 'production' | 'unconfigured';
export interface PaymentAvailability { enabled: boolean; mode: PaymentMode; reason?: 'checkout_unavailable'; /** Tabby pay-in-4 is offered (AED only). */ tabby: boolean;
  /** Public settings for Tabby's standard promo and its "Learn more" pop-up. */ tabbyPromo?: { merchantCode: string; publicKey: string } }
export type CheckoutPaymentMethod = 'card' | 'tabby';
export interface TabbyEligibility { available: boolean; checked: boolean; reason?: TabbyRejection }
export interface CheckoutReview {
  hid: number; hotelName: string; criteria: SearchCriteria; offer: RoomOffer; prebookContext: string;
  /** The currency the guest chose to pay in; the supplier price is converted to it by the signed quote. */
  paymentCurrency?: string;
  /** Card and wallets (Ziina) or Tabby pay-in-4; Tabby always charges AED. */
  paymentMethod?: CheckoutPaymentMethod;
  /** The language Tabby's checkout opens in. */
  paymentLanguage?: 'ar' | 'en';
}
export { chargeCurrency } from './paymentCurrencies';
export interface CheckoutTraveler { firstName: string; lastName: string; is_child: boolean; age?: number; gender?: 'male' | 'female' }
export interface CheckoutGuestData {
  guest: { firstName: string; lastName: string; email: string; phone: string; specialRequests?: string };
  rooms: { guests: CheckoutTraveler[] }[];
}
export interface CheckoutQuote { currency: string; amount: string; amountFormatted: string; expiresAt: number; token: string }
export type CheckoutStatus = 'preparing' | 'preflight_failed' | 'intent_creating' | 'intent_unknown' | 'awaiting_payment'
  | 'payment_failed' | 'payment_verified' | 'booking_pending' | 'booking_confirmed' | 'booking_cancelled' | 'booking_failed'
  | 'refund_creating' | 'refund_unknown' | 'refund_pending' | 'refund_completed' | 'refund_review' | 'manual_review';
export interface CheckoutAttemptView {
  reference: string; status: CheckoutStatus; confirmed: boolean; paymentVerified: boolean;
  voucherDelivery?: 'sent' | 'pending' | 'review'; supplierReference?: string; actionRequired?: string;
  /** Set when the attempt is paid with Tabby. */
  paymentMethod?: 'tabby';
  /** Why a Tabby payment did not go through (tabby_expired, tabby_not_available ...). */
  paymentError?: string;
  /** The hotel confirmed this booking and the guest later cancelled it; its refund is followed in My trips. */
  guestCancelled?: true;
}

export interface CheckoutCapability { reference: string; accessToken: string }
export interface CheckoutCreateResult { attempt: CheckoutAttemptView; capability: CheckoutCapability; paymentUrl?: string }
export type CheckoutRecoveryResult = { found: false } | ({ found: true } & CheckoutCreateResult);

type Request = ReturnType<typeof createTransport>;
const statuses = new Set<CheckoutStatus>(['preparing', 'preflight_failed', 'intent_creating', 'intent_unknown', 'awaiting_payment',
  'payment_failed', 'payment_verified', 'booking_pending', 'booking_confirmed', 'booking_cancelled', 'booking_failed',
  'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed', 'refund_review', 'manual_review']);
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const token = /^[a-f\d]{64}$/i;
export const validCheckoutKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const row = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  return value as Record<string, unknown>;
};
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw invalidResponse();
  return value.trim();
}
function minor(value: unknown, currency: string): bigint {
  const unit = units[currency];
  if (!unit || (typeof value !== 'number' && typeof value !== 'string')) throw invalidResponse();
  const amount = String(value), match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  const fraction = (match?.[2] || '').replace(/0+$/, '');
  if (!match || amount.length > 64 || fraction.length > unit.decimals) throw invalidResponse();
  const result = BigInt(match[1]) * 10n ** BigInt(unit.decimals) + BigInt(fraction.padEnd(unit.decimals, '0') || '0');
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER) || result % BigInt(unit.step) !== 0n) throw invalidResponse();
  return result;
}

export function normalizePaymentAvailability(value: unknown): PaymentAvailability {
  const data = row(value);
  if (typeof data.enabled !== 'boolean' || !['sandbox', 'production', 'unconfigured'].includes(String(data.mode))
    || data.enabled && data.mode === 'unconfigured'
    || data.reason !== undefined && data.reason !== 'checkout_unavailable') throw invalidResponse();
  const promo: Record<string, unknown> = data.tabby_promo && typeof data.tabby_promo === 'object' && !Array.isArray(data.tabby_promo) ? data.tabby_promo as Record<string, unknown> : {};
  const tabbyPromo = typeof promo.merchant_code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(promo.merchant_code)
    && typeof promo.public_key === 'string' && /^pk_(?:test_)?[A-Za-z0-9-]{10,100}$/.test(promo.public_key)
    ? { merchantCode: promo.merchant_code, publicKey: promo.public_key } : undefined;
  return { enabled: data.enabled, mode: data.mode as PaymentMode, tabby: data.enabled === true && data.tabby === true,
    ...(tabbyPromo && data.tabby === true ? { tabbyPromo } : {}),
    ...(data.enabled ? {} : { reason: 'checkout_unavailable' as const }) };
}
export function normalizeCheckoutAttempt(value: unknown, expectedReference?: string): CheckoutAttemptView {
  const data = row(value);
  if (typeof data.reference !== 'string' || !uuid.test(data.reference)
    || expectedReference && data.reference !== expectedReference
    || !statuses.has(data.status as CheckoutStatus) || typeof data.confirmed !== 'boolean'
    || data.confirmed !== (data.status === 'booking_confirmed')
    || data.confirmed && (data.payment_verified !== true || typeof data.supplier_reference !== 'string' || !data.supplier_reference.trim())
    || data.payment_verified !== undefined && data.payment_verified !== true) throw invalidResponse();
  const view: CheckoutAttemptView = { reference: data.reference, status: data.status as CheckoutStatus,
    confirmed: data.confirmed, paymentVerified: data.payment_verified === true };
  if (data.voucher_delivery !== undefined) {
    if (!data.confirmed || !['sent', 'pending', 'review'].includes(String(data.voucher_delivery))) throw invalidResponse();
    view.voucherDelivery = data.voucher_delivery as 'sent' | 'pending' | 'review';
  }
  if (data.supplier_reference !== undefined) {
    if (!data.confirmed) throw invalidResponse();
    view.supplierReference = text(data.supplier_reference, 256);
  }
  if (data.action_required !== undefined) {
    if (typeof data.action_required !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(data.action_required)) throw invalidResponse();
    view.actionRequired = data.action_required;
  }
  if (data.guest_cancelled !== undefined) {
    if (data.guest_cancelled !== true || data.payment_verified !== true || !AFTER_GUEST_CANCELLATION.has(data.status as CheckoutStatus)) throw invalidResponse();
    view.guestCancelled = true;
  }
  if (data.payment_method === 'tabby') view.paymentMethod = 'tabby';
  if (data.payment_error !== undefined) {
    if (typeof data.payment_error !== 'string' || !/^tabby_[a-z_]{1,60}$/.test(data.payment_error) || data.status !== 'payment_failed') throw invalidResponse();
    view.paymentError = data.payment_error;
  }
  return view;
}
export function checkoutPaymentUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) throw invalidResponse();
  let url: URL;
  try { url = new URL(value); } catch { throw invalidResponse(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !/^(?:[a-z0-9-]+\.)*(?:ziina\.com|tabby\.ai)$/i.test(url.hostname)) throw invalidResponse();
  return url.href;
}
export function normalizeCheckoutCreate(value: unknown): CheckoutCreateResult {
  const data = row(value), attempt = normalizeCheckoutAttempt(data);
  if (typeof data.access_token !== 'string' || !token.test(data.access_token)) throw invalidResponse();
  const result: CheckoutCreateResult = { attempt, capability: { reference: attempt.reference, accessToken: data.access_token } };
  if (data.payment_url !== undefined) {
    if (attempt.status !== 'awaiting_payment') throw invalidResponse();
    result.paymentUrl = checkoutPaymentUrl(data.payment_url);
  }
  return result;
}
export function normalizeCheckoutRecovery(value: unknown): CheckoutRecoveryResult {
  const data = row(value);
  if (data.found === false) {
    if (Object.keys(data).some(key => key !== 'found' && key !== 'success') || data.success === false) throw invalidResponse();
    return { found: false };
  }
  if (data.found !== true) throw invalidResponse();
  return { found: true, ...normalizeCheckoutCreate(data) };
}
function source(review: CheckoutReview) {
  try {
    if (!review || hotelId(review.hid) === null) throw invalidResponse();
    assertCriteria({ ...review.criteria, regionId: undefined, hids: [review.hid] });
    const offer = review.offer;
    if (!offer || !offer.price || typeof offer.bookHash !== 'string' || !offer.bookHash.startsWith('p-')
      || offer.bookHash.length > 1024 || /[\u0000-\u0020\u007f]/.test(offer.bookHash)
      || typeof review.prebookContext !== 'string' || !review.prebookContext || review.prebookContext.length > 131072
      || /[\u0000-\u0020\u007f]/.test(review.prebookContext)) throw invalidResponse();
    minor(offer.price.amount, offer.price.currency);
    return { hid: review.hid, hotelName: text(review.hotelName, 256), roomName: text(offer.name, 256),
      book_hash: offer.bookHash, prebook_context: review.prebookContext,
      checkin: review.criteria.checkin, checkout: review.criteria.checkout,
      guests: review.criteria.guests.map(group => ({ adults: group.adults, children: [...group.children] })),
      currency: offer.price.currency, total: offer.price.amount };
  } catch { throw new ApiError('validation', 'fresh_checkout_review_required'); }
}
function guestPayload(value: CheckoutGuestData, criteria: SearchCriteria): CheckoutGuestData {
  try {
    const firstName = text(value.guest.firstName, 100), lastName = text(value.guest.lastName, 100);
    const email = text(value.guest.email, 254), phone = text(value.guest.phone, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+[1-9]\d{6,19}$/.test(phone)
      || !Array.isArray(value.rooms) || value.rooms.length !== criteria.guests.length
      || value.rooms[0]?.guests?.[0]?.is_child !== false) throw invalidResponse();
    const rooms = value.rooms.map((room, roomIndex) => {
      const occupancy = criteria.guests[roomIndex];
      if (!Array.isArray(room.guests) || room.guests.length !== occupancy.adults + occupancy.children.length) throw invalidResponse();
      const guests = room.guests.map((person, personIndex) => {
        if (typeof person.is_child !== 'boolean' || person.gender !== undefined && !['male', 'female'].includes(person.gender)
          || person.is_child && (!Number.isInteger(person.age) || person.age! < 0 || person.age! > 17)) throw invalidResponse();
        return { firstName: roomIndex === 0 && personIndex === 0 ? firstName : text(person.firstName, 100),
          lastName: roomIndex === 0 && personIndex === 0 ? lastName : text(person.lastName, 100), is_child: person.is_child,
          ...(person.is_child ? { age: person.age } : {}), ...(person.gender ? { gender: person.gender } : {}) };
      });
      const children = guests.filter(person => person.is_child).map(person => person.age).sort((a, b) => a! - b!);
      if (guests.filter(person => !person.is_child).length !== occupancy.adults
        || JSON.stringify(children) !== JSON.stringify([...occupancy.children].sort((a, b) => a - b))) throw invalidResponse();
      return { guests };
    });
    const comment = value.guest.specialRequests;
    if (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(comment))) throw invalidResponse();
    return { guest: { firstName, lastName, email, phone,
      ...(comment?.trim() ? { specialRequests: comment.trim() } : {}) }, rooms };
  } catch { throw new ApiError('validation', 'invalid_checkout_guests'); }
}
export function normalizeCheckoutQuote(value: unknown, review: CheckoutReview, now = Date.now()): CheckoutQuote {
  const data = row(value), input = source(review), currency = chargeCurrency(review);
  // The server converts at its signed rate; only a same-currency quote can be checked against the offer total.
  const sameCurrency = currency === input.currency;
  if (data.currency !== currency || typeof data.expires_at !== 'number' || !Number.isSafeInteger(data.expires_at)
    || data.expires_at <= now || data.expires_at > now + 20 * 60_000
    || typeof data.token !== 'string' || data.token.length > 8192 || !/^[A-Za-z0-9_-]+\.[a-f\d]{64}$/.test(data.token)
    || typeof data.amount_formatted !== 'string' || minor(data.amount, currency) !== minor(data.amount_formatted, currency)
    || sameCurrency && minor(data.amount, currency) !== minor(input.total, input.currency)) throw invalidResponse();
  return { currency, amount: String(data.amount), amountFormatted: data.amount_formatted,
    expiresAt: data.expires_at, token: data.token };
}
export function createCheckoutApi(request: Request, {
  environment = APP_ENV, financialWritesEnabled = process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED === 'true', now = Date.now
}: { environment?: AppEnvironment; financialWritesEnabled?: boolean; now?: () => number } = {}) {
  const expectedMode: PaymentMode = resolveEnvironment(environment) === 'production' ? 'production' : 'sandbox';
  async function availability(signal?: AbortSignal) {
    return normalizePaymentAvailability(await request('GET', '/payment/availability', { anonymous: true, signal, timeoutMs: 15000 }));
  }
  async function mode(signal: AbortSignal | undefined, requireEnabled = false) {
    const current = await availability(signal);
    if (current.mode !== expectedMode) throw new ApiError('configuration', 'checkout_environment_mismatch');
    if (requireEnabled && !current.enabled) throw new ApiError('configuration', 'checkout_unavailable');
  }
  return {
    creationEnabled: financialWritesEnabled === true,
    availability,
    async quote(review: CheckoutReview, signal?: AbortSignal): Promise<CheckoutQuote> {
      const input = source(review), credential = await request.captureSessionToken(signal); await mode(signal, true);
      return normalizeCheckoutQuote(await request('POST', '/payment/quote', { signal, timeoutMs: 45000,
        token: credential, body: { ...input, payment_currency: chargeCurrency(review) } }), review, now());
    },
    async create(input: { review: CheckoutReview; guests: CheckoutGuestData; quote: CheckoutQuote }, idempotencyKey: string, signal?: AbortSignal): Promise<CheckoutCreateResult> {
      // This is independent from server readiness. Shipping the preparation
      // screen must never silently enable financial creation on a later deploy.
      if (financialWritesEnabled !== true) throw new ApiError('configuration', 'native_checkout_disabled');
      if (!validCheckoutKey(idempotencyKey)) throw new ApiError('validation', 'invalid_idempotency_key');
      const selected = source(input.review), guests = guestPayload(input.guests, input.review.criteria);
      const lockedQuote = normalizeCheckoutQuote({ currency: input.quote.currency, amount: input.quote.amount,
        amount_formatted: input.quote.amountFormatted, expires_at: input.quote.expiresAt, token: input.quote.token }, input.review, now());
      const credential = await request.captureSessionToken(signal); await mode(signal, true);
      return normalizeCheckoutCreate(await request('POST', '/payment/ziina/intent', { signal, timeoutMs: 90000, idempotencyKey,
        token: credential, body: { ...selected, ...guests, payment_quote: lockedQuote.token, app_return: appScheme(environment),
          ...(input.review.paymentMethod === 'tabby' ? { payment_method: 'tabby', language: input.review.paymentLanguage === 'en' ? 'en' : 'ar' } : {}) } }));
    },
    /**
     * Whether the guest cancelled this booking after the hotel confirmed it. Only a confirmed booking has
     * a record in the account, so a cancelled record under this exact reference answers it.
     */
    async bookingCancelled(reference: string, signal?: AbortSignal): Promise<boolean> {
      if (!uuid.test(reference)) return false;
      return (await getOwnedBookings(request, signal)).some(booking => booking.reference === reference && booking.statusKind === 'cancelled');
    },
    /** Tabby pre-scoring for this buyer and AED amount. A failed check never hides Tabby. */
    async tabbyEligibility(input: { amount: string; email: string; phone: string; language: string }, signal?: AbortSignal): Promise<TabbyEligibility> {
      if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(input.amount) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || !/^\+[1-9]\d{6,19}$/.test(input.phone)) {
        throw new ApiError('validation', 'invalid_tabby_eligibility');
      }
      const data = row(await request('POST', '/payment/tabby/eligibility', { signal, timeoutMs: 20000,
        body: { amount: input.amount, currency: 'AED', email: input.email.trim(), phone: input.phone, language: input.language === 'en' ? 'en' : 'ar' } }));
      if (typeof data.available !== 'boolean') throw invalidResponse();
      const reason = TABBY_REJECTIONS.find(item => item === data.reason);
      return { available: data.available, checked: data.checked === true, ...(!data.available && reason ? { reason } : {}) };
    },
    async status(capability: CheckoutCapability, signal?: AbortSignal): Promise<CheckoutAttemptView> {
      if (!capability || !uuid.test(capability.reference) || !token.test(capability.accessToken)) throw new ApiError('validation', 'invalid_checkout_capability');
      await mode(signal);
      return normalizeCheckoutAttempt(await request('GET', `/payment/ziina/${capability.reference}/status`, {
        signal, token: capability.accessToken, timeoutMs: 20000 }), capability.reference);
    },
    async recover(idempotencyKey: string, signal?: AbortSignal): Promise<CheckoutRecoveryResult> {
      if (!validCheckoutKey(idempotencyKey)) throw new ApiError('validation', 'invalid_idempotency_key');
      const credential = await request.captureSessionToken(signal); await mode(signal);
      return normalizeCheckoutRecovery(await request('POST', '/payment/ziina/recover', { signal, token: credential, idempotencyKey, body: {}, timeoutMs: 20000 }));
    }
  };
}
export type CheckoutApi = ReturnType<typeof createCheckoutApi>;
