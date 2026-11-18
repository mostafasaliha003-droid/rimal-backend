import type { CancellationInterval, Money, RoomOffer } from '../types';
import { parseCancellationTimestamp } from '../api/validation';

export { parseCancellationTimestamp };
export type CancellationReason = 'missing' | 'incomplete' | 'invalid_period' | 'overlap' | 'currency_conflict'
  | 'deadline_conflict' | 'gap' | 'invalid_now' | 'invalid_deadline';
export interface CancellationPeriodView {
  index: number;
  startAt: string | null;
  endAt: string | null;
  amount: string | null;
  currency: string | null;
  startTime: number | null;
  endTime: number | null;
  startInvalid: boolean;
  endInvalid: boolean;
  valid: boolean;
  active: boolean | null;
  fee: Readonly<Money> | null;
  issue: 'bounds' | 'range' | 'amount' | 'currency' | null;
}
export interface CancellationPresentation {
  kind: 'free' | 'fee' | 'unknown';
  fee: Readonly<Money> | null;
  freeUntil: string | null;
  deadlineState: 'future' | 'elapsed' | 'none' | 'invalid';
  reason: CancellationReason | null;
  nextTransitionAt: number | null;
  periods: readonly Readonly<CancellationPeriodView>[];
}

function amount(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^\d+(?:\.\d+)?$/.test(value)
    && Number.isFinite(Number(value));
}
const currency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const zero = (value: string) => /^0+(?:\.0+)?$/.test(value);

/** Exact decimal source text, deliberately without currency-minor-unit rounding. */
export function cancellationMoneyText(value: Money | null): string | null {
  return value && amount(value.amount) && currency(value.currency) ? `${value.currency} ${value.amount}` : null;
}

function periodView(source: CancellationInterval, index: number, now: number): Readonly<CancellationPeriodView> {
  const startAt = typeof source?.startAt === 'string' ? source.startAt : null;
  const endAt = typeof source?.endAt === 'string' ? source.endAt : null;
  const startTime = parseCancellationTimestamp(startAt), endTime = parseCancellationTimestamp(endAt);
  const startInvalid = source?.startInvalid === true || source?.startAt !== null && startTime === null;
  const endInvalid = source?.endInvalid === true || source?.endAt !== null && endTime === null;
  const badRange = startTime !== null && endTime !== null && startTime >= endTime;
  const rawAmount = typeof source?.amount === 'string' ? source.amount : null;
  const rawCurrency = typeof source?.currency === 'string' ? source.currency : null;
  const issue = startInvalid || endInvalid ? 'bounds' : badRange ? 'range'
    : !amount(rawAmount) ? 'amount' : !currency(rawCurrency) ? 'currency' : null;
  const fee = amount(rawAmount) && currency(rawCurrency) ? Object.freeze({ amount: rawAmount, currency: rawCurrency }) : null;
  const active = startInvalid || endInvalid || badRange || !Number.isFinite(now) ? null
    : (startTime === null || now >= startTime) && (endTime === null || now < endTime);
  return Object.freeze({ index, startAt, endAt, amount: rawAmount, currency: rawCurrency, startTime, endTime,
    startInvalid, endInvalid, valid: issue === null, active, fee, issue });
}

export function presentCancellation(source: RoomOffer['cancellation'], now = Date.now()): CancellationPresentation {
  const rawPeriods = Array.isArray(source?.policies) ? source.policies : [];
  const periods = Object.freeze(rawPeriods.map((period, index) => periodView(period, index, now)));
  const deadline = parseCancellationTimestamp(source?.freeUntil);
  const invalidDeadline = source?.freeUntilInvalid === true || source?.freeUntil != null && deadline === null;
  const freeUntil = !invalidDeadline && deadline !== null ? source.freeUntil : null;
  const deadlineState = invalidDeadline ? 'invalid' : deadline === null ? 'none' : deadline > now ? 'future' : 'elapsed';
  let nextTransitionAt: number | null = null;
  const boundary = (time: number | null) => {
    if (time !== null && Number.isFinite(now) && time > now && (nextTransitionAt === null || time < nextTransitionAt)) nextTransitionAt = time;
  };
  boundary(deadline);
  periods.forEach(period => { boundary(period.startTime); boundary(period.endTime); });
  const result = (kind: CancellationPresentation['kind'], fee: Readonly<Money> | null, reason: CancellationReason | null): CancellationPresentation =>
    Object.freeze({ kind, fee, freeUntil, deadlineState, reason, nextTransitionAt, periods });
  if (!Number.isFinite(now)) return result('unknown', null, 'invalid_now');
  if (!source || source.incomplete === true || !Array.isArray(source.policies)) return result('unknown', null, 'incomplete');
  if (invalidDeadline) return result('unknown', null, 'invalid_deadline');
  // An unreadable part of the supplied schedule may contradict another part.
  // Keep every row visible, but do not select a reassuring interpretation.
  if (periods.some(period => !period.valid)) return result('unknown', null, 'invalid_period');
  if (new Set(periods.map(period => period.currency)).size > 1) return result('unknown', null, 'currency_conflict');
  const byStart = [...periods].sort((a, b) => (a.startTime ?? -Infinity) - (b.startTime ?? -Infinity));
  let previousEnd = -Infinity;
  for (const period of byStart) {
    if ((period.startTime ?? -Infinity) < previousEnd) return result('unknown', null, 'overlap');
    previousEnd = period.endTime ?? Infinity;
  }
  if (deadline !== null && periods.some(period => period.fee && (zero(period.fee.amount)
    ? (period.endTime ?? Infinity) > deadline : (period.startTime ?? -Infinity) < deadline))) {
    return result('unknown', null, 'deadline_conflict');
  }
  const current = periods.find(period => period.active === true);
  if (current?.fee) return result(zero(current.fee.amount) ? 'free' : 'fee', current.fee, null);
  if (periods.length) return result('unknown', null, 'gap');
  // A free deadline is advisory source information, not an active charge
  // interval. It supplies neither a numeric zero nor a currency.
  return result('unknown', null, 'missing');
}
