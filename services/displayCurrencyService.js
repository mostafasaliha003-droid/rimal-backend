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
    for (const { date } of values) {
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        const publishedAt = Date.parse(`${date}T00:00:00Z`);
        if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString().slice(0, 10) !== date
            || now - publishedAt > MAX_RATE_AGE_MS || publishedAt - now > DAY_MS) return null;
    }
    // Each currency is published on its own schedule. Report the oldest
    // validated date so clients never treat older quotes as newly published.
    const date = values.map(row => row.date).sort()[0];

    const rates = Object.fromEntries(values.map(row => [row.quote, Number(row.rate)]));
    if (Object.values(rates).some(rate => !Number.isFinite(rate) || rate <= 0)) return null;
    return { date, rates };
}

function parseWorldRates(rows, now) {
    if (!Array.isArray(rows) || !Number.isFinite(now) || rows.length > 1000) return null;
    const rates = {}, dates = {}, seen = new Set();
    for (const row of rows) {
        if (row?.base !== 'USD' || typeof row.quote !== 'string' || !/^[A-Z]{3}$/.test(row.quote) || row.quote === 'USD') continue;
        const code = row.quote;
        if (seen.has(code)) { delete rates[code]; delete dates[code]; continue; }
        seen.add(code);
        if (typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
        const day = Date.parse(row.date + 'T00:00:00Z');
        if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== row.date || now - day > MAX_RATE_AGE_MS || day - now > DAY_MS) continue;
        rates[code] = row.rate;
        dates[code] = row.date;
    }
    return Object.keys(rates).length ? { base: 'USD', rates, dates } : null;
}

function rateFeed(fetcher, url, parse) {
    let cached = null;
    let pending = null;

    async function getRates({ now = Date.now() } = {}) {
        if (!Number.isFinite(now)) throw new TypeError('now must be a finite timestamp');
        const cachedRates = cached && parse(cached.rows, now);
        if (cachedRates && cached.fetchedAt <= now && now - cached.fetchedAt < CACHE_TTL_MS) {
            return { ...cachedRates, stale: false };
        }

        if (!pending) {
            pending = (async () => {
                try {
                    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
                    if (!response?.ok) throw new Error('Display exchange rates unavailable');
                    const rows = await response.json();
                    const parsed = parse(rows, now);
                    if (!parsed) throw new Error('Invalid display exchange rates');
                    cached = { fetchedAt: now, rows };
                    return { ...parsed, stale: false };
                } catch (error) {
                    const fallback = cached && parse(cached.rows, now);
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

    return getRates;
}

function createDisplayCurrencyService({ fetcher = globalThis.fetch } = {}) {
    return { getRates: rateFeed(fetcher, RATE_URL, parseUsdDisplayRates),
        getWorldRates: rateFeed(fetcher, 'https://api.frankfurter.dev/v2/rates?base=USD', parseWorldRates) };
}

module.exports = { CACHE_TTL_MS, MAX_RATE_AGE_MS, parseUsdDisplayRates, createDisplayCurrencyService };
