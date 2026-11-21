import type { Money } from '../types';
import type { createTransport } from './transport';
import { ApiError, invalidResponse } from './errors';

/*
 * Cancelling an owned booking inside the app. The server quotes the current cancellation fee and
 * the refund (signed, valid for a few minutes), cancels with the hotel only for that exact quote,
 * then reports the cancellation and the refund to the card as they progress.
 */
type Request = ReturnType<typeof createTransport>;

export type CancellationState = 'cancelling' | 'cancel_pending' | 'cancelled' | 'cancel_failed';
export type RefundStatus = 'not_processed' | 'pending' | 'completed' | 'review' | 'not_due';
export interface CancellationTracking {
  state: CancellationState; pending: boolean; refundStatus: RefundStatus;
  refund: Money | null; fee: Money | null; cancellationReference: string; receiptReady: boolean; upsells: boolean;
}
export type CancellationOffer =
  | { mode: 'support'; reference: string; policy: string; penalty: Money | null; upsells: boolean }
  | { mode: 'checking'; reference: string; retryAfterMs: number }
  | { mode: 'automatic'; reference: string; policy: string; penalty: Money; fee: Money; refund: Money; expiresAt: number; quoteToken: string }
  | { mode: 'tracking'; reference: string; tracking: CancellationTracking };

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const STATES: readonly CancellationState[] = ['cancelling', 'cancel_pending', 'cancelled', 'cancel_failed'];
const REFUNDS: readonly RefundStatus[] = ['not_processed', 'pending', 'completed', 'review', 'not_due'];

export const validReference = (value: string) => /^[A-Za-z0-9_-]{1,120}$/.test(value);

function money(value: unknown): Money | null {
  const row = object(value);
  return typeof row.amount === 'string' && /^\d+(?:\.\d+)?$/.test(row.amount) && row.amount.length <= 32
    && typeof row.currency_code === 'string' && /^[A-Z]{3}$/.test(row.currency_code) ? { amount: row.amount, currency: row.currency_code } : null;
}

export function normalizeTracking(value: unknown): CancellationTracking {
  const row = object(value);
  const state = STATES.find(item => item === row.status);
  if (!state) throw invalidResponse();
  const refundStatus = REFUNDS.find(item => item === row.customer_refund_status) ?? 'not_processed';
  const reference = typeof row.cancellation_reference === 'string' && /^CAN-[A-Z0-9]{1,24}$/.test(row.cancellation_reference) ? row.cancellation_reference : '';
  return { state, pending: state === 'cancelling' || state === 'cancel_pending', refundStatus,
    refund: money(row.customer_refund), fee: money(row.customer_fee), cancellationReference: reference,
    receiptReady: row.receipt_status === 'ready' || row.receipt_status === 'generated' || (state === 'cancelled' && row.receipt_status !== 'failed'),
    upsells: row.upsells_require_manual_cancellation === true };
}

export function normalizeCancellationOffer(value: unknown, reference: string): CancellationOffer {
  const row = object(value);
  if (row.reference !== reference) throw invalidResponse();
  const policy = typeof row.policy === 'string' ? row.policy.slice(0, 4000) : '';
  if (row.mode === 'tracking') return { mode: 'tracking', reference, tracking: normalizeTracking(row.cancellation) };
  if (row.mode === 'checking') {
    const retry = Number(row.retry_after_ms);
    return { mode: 'checking', reference, retryAfterMs: Number.isFinite(retry) ? Math.min(30000, Math.max(1500, retry)) : 3000 };
  }
  const penalty = money(row.penalty), fee = money(row.fee), refund = money(row.refund);
  const expiresAt = Number(row.expires_at), token = row.quote_token;
  if (row.mode === 'automatic' && penalty && fee && refund && fee.currency === refund.currency && Number.isFinite(expiresAt)
    && typeof token === 'string' && token.length > 0 && token.length <= 4000) {
    return { mode: 'automatic', reference, policy, penalty, fee, refund, expiresAt, quoteToken: token };
  }
  return { mode: 'support', reference, policy, penalty, upsells: row.upsells === true };
}

export function createCancellationApi(request: Request) {
  const path = (reference: string, tail = '') => {
    if (!validReference(reference)) throw new ApiError('validation', 'booking_not_found');
    return '/owned/bookings/' + reference + '/cancellation' + tail;
  };
  return {
    /** The current fee and refund for cancelling now (or the progress of a cancellation already made). */
    async offer(reference: string, signal?: AbortSignal) {
      return normalizeCancellationOffer(await request('GET', path(reference), { signal, timeoutMs: 20000 }), reference);
    },
    /** Cancels for exactly the quoted fee and refund; the server refuses if either has changed. */
    async confirm(reference: string, quoteToken: string, signal?: AbortSignal) {
      return normalizeTracking(await request('POST', path(reference), { signal, timeoutMs: 45000,
        body: { confirm_cancellation: true, quote_token: quoteToken } }));
    },
    async status(reference: string, signal?: AbortSignal) {
      return normalizeTracking(await request('GET', path(reference, '/status'), { signal, timeoutMs: 20000 }));
    },
  };
}
