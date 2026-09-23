import { DISPLAY_CURRENCIES, SEARCH_CURRENCY } from './offers.js';

const RATE_URL = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=AED,SAR,EUR';
const CACHE_KEY = 'remal_usd_display_rates';
const CACHE_LIFETIME_MS = 6 * 60 * 60 * 1000;
const RATE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseUsdDisplayRates(rows, now = Date.now()) {
    if (!Array.isArray(rows) || !Number.isFinite(now)) return null;
    const quotes = DISPLAY_CURRENCIES.filter(currency => currency !== SEARCH_CURRENCY).map(currency =>
        rows.filter(row => row?.base === SEARCH_CURRENCY && row.quote === currency)
    );
    if (quotes.some(matches => matches.length !== 1)) return null;
    const values = quotes.map(([row]) => row);
    const date = values[0].date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || values.some(row => row.date !== date)) return null;
    const publishedAt = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== date
        || now - publishedAt > RATE_MAX_AGE_MS || publishedAt - now > DAY_MS) return null;
    const rates = Object.fromEntries(values.map(row => [row.quote, Number(row.rate)]));
    if (Object.values(rates).some(rate => !Number.isFinite(rate) || rate <= 0)) return null;
    return { date, rates };
}

export async function loadUsdDisplayRates({ storage = globalThis.localStorage, fetcher = globalThis.fetch, signal, now = Date.now() } = {}) {
    try {
        const cached = JSON.parse(storage?.getItem(CACHE_KEY) || 'null');
        if (Number.isFinite(cached?.fetchedAt) && cached.fetchedAt <= now
            && now - cached.fetchedAt < CACHE_LIFETIME_MS) {
            const parsed = parseUsdDisplayRates(cached.rows, now);
            if (parsed) return parsed;
        }
    } catch {}
    const response = await fetcher(RATE_URL, { signal });
    if (!response.ok) throw new Error('Display exchange rates unavailable');
    const rows = await response.json();
    const parsed = parseUsdDisplayRates(rows, now);
    if (!parsed) throw new Error('Invalid display exchange rates');
    try { storage?.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: now, rows })); } catch {}
    return parsed;
}