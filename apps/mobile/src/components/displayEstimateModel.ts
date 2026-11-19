import type { Money } from '../types';

export interface DisplayQuote { date: string; rate: number }
const day = 86_400_000;
export function validQuoteDate(date: string, now = Date.now()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && time <= now + day && now - time <= 5 * day;
}
export function readDisplayQuotes(payload: unknown, now = Date.now()): Record<string, DisplayQuote> {
  if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true
    || !('base' in payload) || payload.base !== 'USD' || !('rates' in payload) || !('dates' in payload)
    || !payload.rates || typeof payload.rates !== 'object' || !payload.dates || typeof payload.dates !== 'object') return {};
  const quotes: Record<string, DisplayQuote> = {};
  const dates = payload.dates as Record<string, string>;
  for (const [code, rate] of Object.entries(payload.rates)) {
    if (/^[A-Z]{3}$/.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && validQuoteDate(dates[code], now)) {
      quotes[code] = { rate, date: dates[code] };
    }
  }
  return quotes;
}
export function displayEstimate(money: Money | null | undefined, code: string, quotes: Record<string, DisplayQuote>, language: string, now = Date.now()) {
  if (money?.currency !== 'USD' || !/^\d+(?:\.\d+)?$/.test(money.amount) || !/^[A-Z]{3}$/.test(code) || code === 'USD') return null;
  const quote = quotes[code];
  if (!quote || !validQuoteDate(quote.date, now)) return null;
  const converted = Number(money.amount) * quote.rate;
  if (!Number.isFinite(converted) || converted > Number.MAX_SAFE_INTEGER / 1000) return null;
  return { date: quote.date, text: new Intl.NumberFormat(language === 'ar' ? 'ar-AE' : 'en-US', {
    style: 'currency', currency: code, currencyDisplay: 'code',
  }).format(converted) };
}
