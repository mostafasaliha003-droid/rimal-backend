const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RATE_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const DECIMAL_RATE_PATTERN = /^\d+(?:\.\d+)?$/;

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function currencyCode(value) {
    if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
        throw fail('fx_currency_invalid', 400);
    }
    return value.trim().toUpperCase();
}

function rateDateTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
    return timestamp;
}

function parseFrankfurterRate(payload, fromCurrency, toCurrency, now, maxRateAgeMs = MAX_RATE_AGE_MS) {
    if (!Number.isFinite(now)) throw new TypeError('fx_clock_invalid');
    const rows = Array.isArray(payload) ? payload : [payload];
    const matches = rows.filter(row => row?.base === fromCurrency && row?.quote === toCurrency);
    if (matches.length !== 1) throw fail('fx_rate_response_invalid');

    const row = matches[0];
    const dateTimestamp = rateDateTimestamp(row.date);
    const rate = typeof row.rate === 'number' && Number.isFinite(row.rate)
        ? String(row.rate)
        : typeof row.rate === 'string' ? row.rate.trim() : '';
    if (dateTimestamp === null || !DECIMAL_RATE_PATTERN.test(rate)
        || rate.length > 80 || !/[1-9]/.test(rate)) {
        throw fail('fx_rate_response_invalid');
    }
    if (now - dateTimestamp > maxRateAgeMs || dateTimestamp - now > MAX_FUTURE_SKEW_MS) {
        throw fail('fx_rate_expired');
    }

    return {
        baseCurrency: fromCurrency,
        quoteCurrency: toCurrency,
        rate,
        date: row.date,
        provider: 'frankfurter',
        stale: false
    };
}

function createLiveFxService({
    fetcher = globalThis.fetch,
    now = () => Date.now(),
    cacheTtlMs = CACHE_TTL_MS,
    maxRateAgeMs = MAX_RATE_AGE_MS
} = {}) {
    if (typeof fetcher !== 'function' || typeof now !== 'function'
        || !Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 0
        || !Number.isSafeInteger(maxRateAgeMs) || maxRateAgeMs < 0) {
        throw new TypeError('fx_service_configuration_invalid');
    }

    const cache = new Map();
    const pending = new Map();

    async function getRate(from, to) {
        const fromCurrency = currencyCode(from);
        const toCurrency = currencyCode(to);
        const requestedAt = now();
        if (!Number.isFinite(requestedAt)) throw fail('fx_clock_invalid');

        if (fromCurrency === toCurrency) {
            const identityDate = new Date(requestedAt);
            return {
                baseCurrency: fromCurrency,
                quoteCurrency: toCurrency,
                rate: '1',
                date: Number.isNaN(identityDate.getTime()) ? null : identityDate.toISOString().slice(0, 10),
                provider: 'identity',
                stale: false
            };
        }

        const key = `${fromCurrency}:${toCurrency}`;
        const cached = cache.get(key);
        if (cached && requestedAt >= cached.fetchedAt
            && requestedAt - cached.fetchedAt < cacheTtlMs) {
            // Revalidate age as a clock may cross a rate expiry while cache TTL is active.
            return parseFrankfurterRate(cached.payload, fromCurrency, toCurrency, requestedAt, maxRateAgeMs);
        }

        if (pending.has(key)) return pending.get(key);

        const request = (async () => {
            const url = new URL(`/v2/rate/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}`, FRANKFURTER_BASE_URL);
            let response;
            try {
                response = await fetcher(url.toString(), { signal: AbortSignal.timeout(8000) });
            } catch {
                throw fail('fx_provider_unavailable');
            }
            if (!response?.ok) throw fail('fx_provider_unavailable');

            let payload;
            try {
                payload = await response.json();
            } catch {
                throw fail('fx_rate_response_invalid');
            }

            const quote = parseFrankfurterRate(payload, fromCurrency, toCurrency, requestedAt, maxRateAgeMs);
            // Keep cache only after the response passes currency, amount, and date checks.
            cache.set(key, { payload, fetchedAt: requestedAt });
            return quote;
        })();

        pending.set(key, request);
        try {
            return await request;
        } finally {
            if (pending.get(key) === request) pending.delete(key);
        }
    }

    function clearCache() {
        cache.clear();
        pending.clear();
    }

    return { getRate, clearCache };
}

const defaultService = createLiveFxService();

module.exports = {
    FRANKFURTER_BASE_URL,
    CACHE_TTL_MS,
    MAX_RATE_AGE_MS,
    createLiveFxService,
    getRate: defaultService.getRate,
    _test: { currencyCode, rateDateTimestamp, parseFrankfurterRate }
};