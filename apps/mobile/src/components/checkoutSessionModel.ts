import type { AppEnvironment } from '../types';
import type { CheckoutAttemptView, CheckoutCapability, CheckoutCreateResult, CheckoutGuestData,
  CheckoutQuote, CheckoutRecoveryResult, CheckoutReview } from '../api/checkout';
import { chargeCurrency } from '../api/paymentCurrencies';
import { ApiError, aborted, asApiError, invalidResponse } from '../api/errors';
import { recoveryUuid, validRecoveryOwner, type CheckoutRecoveryOwner, type CheckoutRecoveryRecord,
  type CheckoutRecoveryStorage } from './checkoutRecoveryStorage.types';

export interface CheckoutOwner extends CheckoutRecoveryOwner { revision: number }
export interface CheckoutSelection { review: CheckoutReview; selectionId: string; expiresAt: number; termsAccepted: boolean }
export interface CheckoutAvailability { enabled: boolean; mode: 'sandbox' | 'production' | 'unconfigured'; reason?: string }
export interface CheckoutSessionApi {
  readonly creationEnabled?: boolean;
  availability(signal?: AbortSignal): Promise<CheckoutAvailability>;
  quote(review: CheckoutReview, signal?: AbortSignal): Promise<CheckoutQuote>;
  create(input: { review: CheckoutReview; guests: CheckoutGuestData; quote: CheckoutQuote }, key: string, signal?: AbortSignal): Promise<CheckoutCreateResult>;
  status(capability: CheckoutCapability, signal?: AbortSignal): Promise<CheckoutAttemptView>;
  recover(key: string, signal?: AbortSignal): Promise<CheckoutRecoveryResult>;
}
export type CheckoutPhase = 'idle' | 'quoting' | 'ready' | 'submitting' | 'recovering' | 'active' | 'unknown' | 'error';
export type CheckoutQuoteView = Omit<CheckoutQuote, 'token'>;
export interface CheckoutSnapshot {
  phase: CheckoutPhase; availability: CheckoutAvailability | null; quote: CheckoutQuoteView | null;
  attempt: CheckoutAttemptView | null; error: ApiError | null; hasRecovery: boolean;
}
const empty = (): CheckoutSnapshot => ({ phase: 'idle', availability: null, quote: null, attempt: null, error: null, hasRecovery: false });
const masked = Object.freeze(empty());
const ownerKey = (owner: CheckoutOwner | null) => owner && validRecoveryOwner(owner) && Number.isSafeInteger(owner.revision) && owner.revision >= 0
  ? JSON.stringify([owner.environment, owner.ownerDigest, owner.revision]) : '';
const statuses = new Set(['preparing', 'preflight_failed', 'intent_creating', 'intent_unknown', 'awaiting_payment',
  'payment_failed', 'payment_verified', 'booking_pending', 'booking_confirmed', 'booking_cancelled', 'booking_failed',
  'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed', 'refund_review', 'manual_review']);
function safeAttempt(value: CheckoutAttemptView): CheckoutAttemptView {
  if (!value || !recoveryUuid(value.reference) || !statuses.has(value.status) || typeof value.confirmed !== 'boolean'
    || typeof value.paymentVerified !== 'boolean' || value.confirmed !== (value.status === 'booking_confirmed')) throw invalidResponse();
  const bounded = (text: unknown, max: number) => typeof text === 'string' && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text);
  if (value.confirmed && (!value.paymentVerified || !bounded(value.supplierReference, 256) || !value.supplierReference?.trim())) throw invalidResponse();
  return Object.freeze({ reference: value.reference, status: value.status, confirmed: value.confirmed, paymentVerified: value.paymentVerified,
    ...(['sent', 'pending', 'review'].includes(value.voucherDelivery || '') ? { voucherDelivery: value.voucherDelivery } : {}),
    ...(bounded(value.supplierReference, 256) ? { supplierReference: value.supplierReference } : {}),
    ...(bounded(value.actionRequired, 120) ? { actionRequired: value.actionRequired } : {}) });
}
function safeQuote(value: CheckoutQuote, now: number, review: CheckoutReview): CheckoutQuote {
  const canonical = (amount: string) => {
    const [whole, fraction = ''] = amount.split('.'); const tail = fraction.replace(/0+$/, '');
    return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`;
  };
  if (!value || !/^[A-Z]{3}$/.test(value.currency) || typeof value.amount !== 'string' || value.amount.length > 64
    || !/^\d+(?:\.\d+)?$/.test(value.amount) || !Number.isFinite(Number(value.amount)) || Number(value.amount) <= 0
    || typeof value.amountFormatted !== 'string' || value.amountFormatted.length > 100
    || /[\u0000-\u001f\u007f]/.test(value.amountFormatted) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now
    || typeof value.token !== 'string' || !value.token || value.token.length > 131072 || /[\u0000-\u0020\u007f]/.test(value.token)) throw invalidResponse();
  const price = review.offer.price;
  // A quote in another currency is the server's signed conversion; the same currency must equal the offer total.
  const currency = chargeCurrency(review);
  if (!price || currency !== value.currency || typeof price.amount !== 'string' || price.amount.length > 128
    || !/^\d+(?:\.\d+)?$/.test(price.amount)
    || price.currency === currency && canonical(price.amount) !== canonical(value.amount)) throw invalidResponse();
  return Object.freeze({ currency: value.currency, amount: value.amount, amountFormatted: value.amountFormatted, expiresAt: value.expiresAt, token: value.token });
}
function withoutToken(value: CheckoutQuote): CheckoutQuoteView {
  return Object.freeze({ currency: value.currency, amount: value.amount, amountFormatted: value.amountFormatted, expiresAt: value.expiresAt });
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    if (signal.aborted) { operation.catch(() => {}); cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function completed(attempt: CheckoutAttemptView | null) {
  return Boolean(attempt && (attempt.status === 'booking_confirmed' || attempt.status === 'refund_completed'
    || !attempt.paymentVerified && ['preflight_failed', 'payment_failed', 'booking_cancelled'].includes(attempt.status)));
}

// The store contains only presentation state. Signed offers, quote/status
// capabilities, hosted-payment URLs and traveler payloads stay closure-private.
export function createCheckoutSession({ api, storage, getOwner, getReview, canCreate = () => false, randomUUID, now = Date.now }: {
  api: CheckoutSessionApi; storage: CheckoutRecoveryStorage; getOwner: () => CheckoutOwner | null;
  getReview: () => CheckoutSelection | null; canCreate?: () => boolean; randomUUID: () => string; now?: () => number;
}) {
  let snapshot = empty(), boundOwner = '', revision = 0, loaded = false;
  let observedSelection = '';
  let record: CheckoutRecoveryRecord | null = null, capability: CheckoutCapability | null = null, paymentUrl: string | null = null;
  let quote: CheckoutQuote | null = null, quoteSelection = '';
  let request: AbortController | null = null, availabilityRequest: AbortController | null = null;
  let operation: Promise<void> | null = null, availabilityOperation: Promise<void> | null = null;
  const consumedSelections = new Set<string>();
  const listeners = new Set<() => void>();
  const creationAllowed = () => canCreate() && api.creationEnabled !== false;
  const publish = (patch: Partial<CheckoutSnapshot>) => { snapshot = Object.freeze({ ...snapshot, ...patch }); listeners.forEach(listener => listener()); };
  const owner = () => getOwner();
  function sync() {
    const key = ownerKey(owner());
    let changed = false;
    if (key !== boundOwner) {
      revision++; request?.abort(); availabilityRequest?.abort(); request = null; availabilityRequest = null;
      operation = null; availabilityOperation = null; boundOwner = key; loaded = false;
      record = null; capability = null; paymentUrl = null; quote = null; quoteSelection = '';
      consumedSelections.clear(); observedSelection = '';
      snapshot = empty(); changed = true;
    }
    const selected = key ? selection() : null;
    const selectedKey = selected ? JSON.stringify([selected.selectionId, selected.expiresAt]) : '';
    if (observedSelection !== selectedKey) { observedSelection = selectedKey; changed = true; }
    if (quote && (!freshSelection() || quote.expiresAt <= now())) {
      quote = null; quoteSelection = ''; snapshot = { ...snapshot, quote: null, phase: record ? snapshot.phase : 'idle' }; changed = true;
    }
    if (changed) publish({});
  }
  function selection() {
    const value = getReview();
    return value && value.selectionId && Number.isFinite(value.expiresAt) && value.expiresAt > now() && value.termsAccepted ? value : null;
  }
  function freshSelection() { const value = selection(); return value && value.selectionId === quoteSelection ? value : null; }
  const current = (stamp: number, key: string) => revision === stamp && boundOwner === key && key !== '' && ownerKey(owner()) === key;
  function presentation() {
    const visible = ownerKey(owner()) === boundOwner && boundOwner ? snapshot : masked;
    const selected = selection();
    const ready = visible === snapshot && loaded && Boolean(selected && !consumedSelections.has(selected.selectionId)) && !record;
    const busy = Boolean(operation);
    const fresh = Boolean(quote && quote.expiresAt > now() && freshSelection());
    const enabled = ready && fresh && !busy && creationAllowed() && snapshot.availability?.enabled === true;
    return { ...visible, recoveryChecked: visible === snapshot && boundOwner !== '' && loaded,
      canQuote: ready && !busy, canCollectTravelers: Boolean(enabled), canSubmit: Boolean(enabled),
      canClearCompleted: visible === snapshot && !busy && completed(snapshot.attempt),
      // A finished attempt is in the way of a new room the guest has just chosen. Only finished
      // attempts qualify; anything still open (payment, booking, refund) stays on screen.
      replaceCompleted: visible === snapshot && !busy && completed(snapshot.attempt)
        && Boolean(selected && !consumedSelections.has(selected.selectionId)) };
  }
  function run(phase: CheckoutPhase, action: (controller: AbortController, stamp: number, key: string, owner: CheckoutOwner) => Promise<void>) {
    sync();
    if (operation) return operation;
    const identity = owner(), key = ownerKey(identity);
    if (!identity || !key) return Promise.resolve();
    const controller = new AbortController(), stamp = revision; request = controller;
    const task = Promise.resolve().then(() => current(stamp, key) ? action(controller, stamp, key, identity) : undefined).catch(error => {
      if (current(stamp, key)) {
        if (error instanceof ApiError && error.kind === 'storage') loaded = false;
        publish({ phase: record ? 'unknown' : 'error', error: asApiError(error), hasRecovery: Boolean(record) });
      }
    }).finally(() => {
      if (request === controller) { request = null; operation = null; publish({}); }
    });
    operation = task; publish({ phase, error: null }); return task;
  }
  function applyResult(result: CheckoutCreateResult) {
    const attempt = safeAttempt(result.attempt);
    if (!result.capability || result.capability.reference !== attempt.reference
      || !/^[a-f\d]{64}$/i.test(result.capability.accessToken)) throw invalidResponse();
    capability = { reference: attempt.reference, accessToken: result.capability.accessToken };
    // The adapter validates provider URL scope. No URL enters public snapshots.
    paymentUrl = attempt.status === 'awaiting_payment' && typeof result.paymentUrl === 'string' ? result.paymentUrl : null;
    publish({ phase: 'active', attempt, hasRecovery: true, error: null });
  }
  function loadAvailability() {
    sync(); if (availabilityOperation) return availabilityOperation;
    const key = boundOwner, stamp = revision;
    if (!key) return Promise.resolve();
    const controller = new AbortController(); availabilityRequest = controller;
    const task = Promise.resolve().then(() => abortable(api.availability(controller.signal), controller.signal)).then(value => {
      if (!current(stamp, key)) return;
      if (!value || typeof value.enabled !== 'boolean' || !['sandbox', 'production', 'unconfigured'].includes(value.mode)) throw invalidResponse();
      const expected = owner()?.environment === 'production' ? 'production' : 'sandbox';
      if (value.enabled && value.mode !== expected) throw new ApiError('configuration', 'checkout_environment_mismatch');
      publish({ availability: { enabled: value.enabled, mode: value.mode,
        ...(typeof value.reason === 'string' && /^[a-z_]{1,80}$/.test(value.reason) ? { reason: value.reason } : {}) } });
    }).catch(error => {
      if (current(stamp, key)) publish({ availability: { enabled: false, mode: 'unconfigured', reason: 'checkout_unavailable' }, error: asApiError(error) });
    }).finally(() => { if (availabilityRequest === controller) { availabilityRequest = null; availabilityOperation = null; } });
    availabilityOperation = task; return task;
  }
  function quoteOffer() {
    sync(); if (!presentation().canQuote) return Promise.resolve();
    return run('quoting', async (controller, stamp, key) => {
      const selected = selection(); if (!selected) throw new ApiError('validation', 'checkout_context_changed');
      quote = null; quoteSelection = ''; publish({ quote: null });
      const value = safeQuote(await abortable(api.quote(copy(selected.review), controller.signal), controller.signal), now(), selected.review);
      if (!current(stamp, key)) return;
      if (selection()?.selectionId !== selected.selectionId) throw new ApiError('validation', 'checkout_context_changed');
      quote = value; quoteSelection = selected.selectionId; publish({ phase: 'ready', quote: withoutToken(value) });
    });
  }
  function recover() {
    return run('recovering', async (controller, stamp, key, identity) => {
      const stored = await storage.read(identity);
      if (!current(stamp, key)) return;
      loaded = true; record = stored;
      if (!stored) { capability = null; paymentUrl = null; publish({ phase: quote ? 'ready' : 'idle', attempt: null, hasRecovery: false }); return; }
      publish({ hasRecovery: true });
      const result = await abortable(api.recover(stored.idempotencyKey, controller.signal), controller.signal);
      if (!current(stamp, key)) return;
      if (!result || typeof result.found !== 'boolean') throw invalidResponse();
      // Absence is not proof that a previously dispatched request cannot arrive.
      // Never clear or automatically replay this key after a missing response.
      if (!result.found) { capability = null; paymentUrl = null; publish({ phase: 'unknown', attempt: null }); return; }
      applyResult(result);
    });
  }
  function submit(guests: CheckoutGuestData, termsAccepted: boolean) {
    sync(); if (operation) return operation;
    if (!presentation().canSubmit || termsAccepted !== true) return Promise.resolve();
    // Copy synchronously before yielding, so form edits cannot change a pending
    // request. No traveler payload is stored on this session or persisted.
    let travelers: CheckoutGuestData;
    try { travelers = copy(guests); } catch { publish({ phase: 'error', error: new ApiError('validation', 'invalid_checkout_guests') }); return Promise.resolve(); }
    return run('submitting', async (controller, stamp, key, identity) => {
      const selected = freshSelection(), lockedQuote = quote;
      if (!selected || !lockedQuote || lockedQuote.expiresAt <= now() || !creationAllowed() || !snapshot.availability?.enabled) return;
      const idempotencyKey = randomUUID();
      if (!recoveryUuid(idempotencyKey)) throw new ApiError('configuration', 'invalid_checkout_idempotency_key');
      const pending: CheckoutRecoveryRecord = { version: 1, environment: identity.environment, ownerDigest: identity.ownerDigest, idempotencyKey, createdAt: now() };
      await storage.write(pending);
      if (!current(stamp, key)) return;
      record = pending; loaded = true; publish({ hasRecovery: true });
      if (freshSelection()?.selectionId !== selected.selectionId || lockedQuote.expiresAt <= now() || !creationAllowed() || snapshot.availability?.enabled !== true) {
        // Even a pre-dispatch stop retains its journal. After a restart there
        // is no reliable client proof that an earlier request cannot arrive.
        publish({ phase: 'unknown', error: new ApiError('validation', 'checkout_context_changed') }); return;
      }
      consumedSelections.add(selected.selectionId);
      const result = await abortable(api.create({ review: copy(selected.review), guests: travelers, quote: lockedQuote }, idempotencyKey, controller.signal), controller.signal);
      if (current(stamp, key)) applyResult(result);
    });
  }
  function refreshStatus() {
    sync(); if (!record) return Promise.resolve();
    if (!capability) return recover();
    return run('recovering', async (controller, stamp, key) => {
      const selected = capability; if (!selected) return;
      const attempt = safeAttempt(await abortable(api.status({ ...selected }, controller.signal), controller.signal));
      if (!current(stamp, key)) return;
      if (attempt.reference !== selected.reference) throw invalidResponse();
      if (attempt.status !== 'awaiting_payment') paymentUrl = null;
      publish({ phase: 'active', attempt, hasRecovery: true });
    });
  }
  function getPaymentHandoff() {
    sync();
    return ownerKey(owner()) === boundOwner && snapshot.phase === 'active' && snapshot.attempt?.status === 'awaiting_payment'
      && creationAllowed() && snapshot.availability?.enabled && paymentUrl ? paymentUrl : null;
  }
  function canOpenWebsite() {
    sync();
    return Boolean(boundOwner && ownerKey(owner()) === boundOwner && loaded && !record && !operation && selection());
  }
  function clearCompleted() {
    sync(); if (!presentation().canClearCompleted || !record) return Promise.resolve(false);
    const expectedOwner = boundOwner;
    return run('recovering', async (_controller, stamp, key) => {
      const selected = record; if (!selected) return;
      if (!await storage.remove(selected)) throw new ApiError('storage', 'checkout_recovery_changed');
      if (!current(stamp, key)) return;
      record = null; capability = null; paymentUrl = null;
      quote = null; quoteSelection = '';
      publish({ phase: 'idle', quote: null, attempt: null, hasRecovery: false });
    }).then(() => ownerKey(owner()) === expectedOwner && record === null);
  }
  return {
    getSnapshot: () => ownerKey(owner()) === boundOwner && boundOwner ? snapshot : masked,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    presentation, sync, loadAvailability, quote: quoteOffer, submit, recover, refreshStatus, getPaymentHandoff, canOpenWebsite, clearCompleted,
    getDeadline: () => {
      const selected = boundOwner && ownerKey(owner()) === boundOwner ? selection() : null;
      return selected ? Math.min(selected.expiresAt, quote?.expiresAt ?? Infinity) : null;
    },
    dispose() { revision++; request?.abort(); availabilityRequest?.abort(); capability = null; paymentUrl = null; quote = null; listeners.clear(); }
  };
}
export type CheckoutSession = ReturnType<typeof createCheckoutSession>;
export type { AppEnvironment };
