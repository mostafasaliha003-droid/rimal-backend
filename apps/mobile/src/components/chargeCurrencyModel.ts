import type { Money } from '../types';

/**
 * The booking server's payment rate table (GET /payment/rates). Checkout quotes are
 * signed from the same table and rounding, so a converted price here is the amount
 * the payment gateway is asked to charge while the table is current.
 */
export interface ChargeRates {
  rates: Readonly<Record<string, string>>;
  currencies: Readonly<Record<string, { decimals: number; step: number }>>;
  validUntil: number;
}

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,12}))?$/;
const MAX_STALE_MS = 30 * 60_000; // keep showing a table briefly while a refresh is in flight

export function readChargeRates(payload: unknown, now = Date.now()): ChargeRates | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  if (row.success !== true || row.base !== 'USD' || !row.rates || typeof row.rates !== 'object'
    || !row.currencies || typeof row.currencies !== 'object' || typeof row.valid_until !== 'number') return null;
  const rates: Record<string, string> = {}, currencies: Record<string, { decimals: number; step: number }> = {};
  for (const [code, value] of Object.entries(row.rates as Record<string, unknown>)) {
    const unit = (row.currencies as Record<string, unknown>)[code] as { decimals?: unknown; step?: unknown } | undefined;
    if (!/^[A-Z]{3}$/.test(code) || typeof value !== 'string' || !DECIMAL.test(value) || !/[1-9]/.test(value)
      || !unit || !Number.isInteger(unit.decimals) || (unit.decimals as number) < 0 || (unit.decimals as number) > 3
      || !Number.isInteger(unit.step) || (unit.step as number) < 1) continue;
    rates[code] = value;
    currencies[code] = { decimals: unit.decimals as number, step: unit.step as number };
  }
  if (rates.USD !== '1' || !Number.isFinite(row.valid_until) || (row.valid_until as number) + MAX_STALE_MS < now) return null;
  return { rates, currencies, validUntil: row.valid_until as number };
}

function rational(value: string) {
  const match = value.match(DECIMAL);
  if (!match) return null;
  return { n: BigInt(match[1] + (match[2] || '')), d: BigInt(10) ** BigInt((match[2] || '').length) };
}

/** Same arithmetic as convertMinor on the booking server: exact rationals, half-up to the currency step. */
export function convertMoney(money: Money | null | undefined, target: string, table: ChargeRates | null, now = Date.now()): Money | null {
  if (!money || !table || money.currency === target) return null;
  if (table.validUntil + MAX_STALE_MS < now) return null;
  const amount = rational(money.amount), from = table.rates[money.currency], to = table.rates[target];
  const unit = table.currencies[target];
  if (!amount || amount.n <= BigInt(0) || !from || !to || !unit) return null;
  const fromRate = rational(from), toRate = rational(to);
  if (!fromRate || !toRate) return null;
  const step = BigInt(unit.step);
  const numerator = amount.n * toRate.n * fromRate.d * BigInt(10) ** BigInt(unit.decimals);
  const denominator = amount.d * toRate.d * fromRate.n * step;
  const minor = ((numerator * BigInt(2) + denominator) / (denominator * BigInt(2))) * step;
  const digits = minor.toString().padStart(unit.decimals + 1, '0');
  const whole = unit.decimals ? digits.slice(0, -unit.decimals) : digits;
  return { amount: unit.decimals ? `${whole}.${digits.slice(-unit.decimals)}` : whole, currency: target };
}
