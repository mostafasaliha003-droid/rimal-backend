const RATE_URL = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=AED,SAR,EUR';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RATE_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUIRED_QUOTES = ['AED', 'SAR', 'EUR'];

function parseUsdDisplayRates(rows, now = Date.now()) {
    if (!Array.isArray(rows) || !Number.isFinite(now)) return null;
    const matches = REQUIRED_QUOTES.map(quote => rows.filter(row =>
        row?.base === 'USD' && row.quote === quote
    ));
    if (matches.some(quoteRows => quoteRows.length !== 1)) return null;

    const values = matches.map(([row]) => row);
    const date = values[0].date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || values.some(row => row.date !== date)) return null;
    const publishedAt = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== date
        || now - publishedAt > MAX_RATE_AGE_MS || publishedAt - now > DAY_MS) return null;

    const rates = Object.fromEntries(values.map(row => [row.quote, Number(row.rate)]));
    if (Object.values(rates).some(rate => !Number.isFinite(rate) || rate <= 0)) return null;
    return { date, rates };
}

function createDisplayCurrencyService({ fetcher = globalThis.fetch } = {}) {
    let cached = null;
    let pending = null;

    async function getRates({ now = Date.now() } = {}) {
        if (!Number.isFinite(now)) throw new TypeError('now must be a finite timestamp');
        const cachedRates = cached && parseUsdDisplayRates(cached.rows, now);
        if (cachedRates && cached.fetchedAt <= now && now - cached.fetchedAt < CACHE_TTL_MS) {
            return { ...cachedRates, stale: false };
        }

        if (!pending) {
            pending = (async () => {
                try {
                    const response = await fetcher(RATE_URL, { signal: AbortSignal.timeout(8000) });
                    if (!response?.ok) throw new Error('Display exchange rates unavailable');
                    const rows = await response.json();
                    const parsed = parseUsdDisplayRates(rows, now);
                    if (!parsed) throw new Error('Invalid display exchange rates');
                    cached = { fetchedAt: now, rows };
                    return { ...parsed, stale: false };
                } catch (error) {
                    const fallback = cached && parseUsdDisplayRates(cached.rows, now);
                    if (fallback && cached.fetchedAt <= now
                        && now - cached.fetchedAt <= MAX_RATE_AGE_MS) {
                        return { ...fallback, stale: true };
                    }
                    throw error;
                } finally {
                    pending = null;
                }
            })();
        }
        return pending;
    }

    return { getRates };
}

module.exports = { CACHE_TTL_MS, MAX_RATE_AGE_MS, parseUsdDisplayRates, createDisplayCurrencyService };