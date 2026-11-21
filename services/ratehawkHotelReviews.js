const CATEGORIES = ['cleanness', 'location', 'price', 'services', 'room', 'meal'];
function score(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}
function reviewDate(value) {
    if (typeof value !== 'string') return '';
    let normalized = value.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
    if (/T.*[+-]\d{2}$/.test(normalized)) normalized = normalized.replace(/([+-]\d{2})$/, '$1:00');
    // Do not let the user's local timezone invent a timestamp for an undated review.
    const date = new Date(normalized.length === 10 ? `${normalized}T00:00:00Z` : /(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}
function normalizeReviews(raw = []) {
    const reviews = raw.filter(row => row && typeof row === 'object').map((row, index) => ({
        id: String(row.id ?? index), author: typeof row.author === 'string' ? row.author.slice(0, 160) : '',
        positive: typeof row.review_plus === 'string' ? row.review_plus.slice(0, 4000) : '',
        negative: typeof row.review_minus === 'string' ? row.review_minus.slice(0, 4000) : '',
        excerpt: (row.review_plus?.length || 0) > 4000 || (row.review_minus?.length || 0) > 4000,
        rating: score(row.rating), publishedAt: reviewDate(row.created),
        roomName: typeof row.room_name === 'string' ? row.room_name.slice(0, 1000) : '',
        nights: Number.isSafeInteger(row.nights) && row.nights > 0 ? row.nights : null,
        categories: Object.fromEntries(CATEGORIES.map(key => [key, score(row.detailed_review?.[key])]))
    })).filter(row => row.rating !== null || row.positive || row.negative)
        .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    const selected = reviews.slice(0, 200);
    const average = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
    const rated = selected.map(row => row.rating).filter(value => value !== null);
    return { reviews: selected, total: selected.length, capped: reviews.length > selected.length,
        summary: { count: selected.length, ratedCount: rated.length, score: average(rated),
            categories: CATEGORIES.map(key => {
                const values = selected.map(row => row.categories[key]).filter(value => value !== null);
                return { key, score: average(values), count: values.length };
            }).filter(row => row.score !== null) } };
}

function createRatehawkHotelReviews({ HotelModel, CacheModel, client = require('./ratehawkClient'), env = process.env, budgetMs = 6000 } = {}) {
    const pending = new Map(), memory = new Map();
    const environment = new URL(env.RATEHAWK_BASE_URL || 'https://api-sandbox.ratehawk.com').hostname.includes('sandbox') ? 'sandbox' : 'production';
    async function load(hid, language = 'en', offset = 0) {
        const resolvedLanguage = environment === 'sandbox' ? 'en' : language;
        const key = `${environment}:${hid}:${resolvedLanguage}`;
        const base = { source: 'ratehawk', scale: 10, environment, requestedLanguage: language, resolvedLanguage };
        const page = payload => ({ ...base, ...payload, reviews: payload.reviews.slice(offset, offset + 10),
            hasMore: offset + 10 < payload.total, nextOffset: Math.min(offset + 10, payload.total) });
        try {
            const hotel = await HotelModel.findOne({ hid }).lean();
            if (!hotel || (hotel.provider && hotel.provider !== 'ratehawk') || hotel.deleted || hotel.is_closed || hotel.staticData?.deleted || hotel.staticData?.is_closed) return { ...base, status: 'not_found' };
            const cached = memory.get(key);
            if (cached && cached.until > Date.now()) return page(cached.payload);
            const stored = await CacheModel.findById(key).lean();
            if (stored?.expiresAt && new Date(stored.expiresAt).getTime() > Date.now()) return page(stored.payload);
            if (!pending.has(key)) {
                if (pending.size >= 4) return { ...base, status: 'unavailable' };
                const task = Promise.resolve().then(() => client.fetchHotelReviews([Number(hid)], resolvedLanguage)).then(async rows => {
                    const record = rows.find(row => String(row.hid) === hid);
                    if (rows.length && !record) throw new Error('review_hotel_mismatch');
                    const normalized = normalizeReviews(record?.reviews || []);
                    const payload = { status: normalized.total ? 'ready' : 'empty', ...normalized, updatedAt: new Date().toISOString() };
                    const until = Date.now() + 12 * 3600000;
                    memory.set(key, { payload, until });
                    while (memory.size > 100) memory.delete(memory.keys().next().value);
                    try { await CacheModel.updateOne({ _id: key }, { $set: { payload, expiresAt: new Date(until) } }, { upsert: true }); } catch {}
                    return payload;
                }).finally(() => pending.delete(key));
                pending.set(key, task);
            }
            let timer;
            try {
                const payload = await Promise.race([pending.get(key), new Promise(resolve => { timer = setTimeout(() => resolve(null), budgetMs); })]);
                return payload ? page(payload) : { ...base, status: 'checking', retryAfterMs: 3000 };
            } finally { clearTimeout(timer); }
        } catch { return { ...base, status: 'unavailable' }; }
    }
    // Result cards need only the average score and how many guests rated it. Cached hotels answer at
    // once; the rest are fetched in one supplier request (at most 100 hotels) and cached exactly like
    // load(). A slow supplier never delays the caller beyond the budget; late answers fill the cache.
    const brief = payload => payload?.summary && payload.summary.ratedCount > 0 && payload.summary.score !== null
        ? { score: payload.summary.score, count: payload.summary.ratedCount } : null;
    let batches = 0;
    async function summaries(hids, language = 'en') {
        const resolvedLanguage = environment === 'sandbox' ? 'en' : language;
        const keyOf = hid => `${environment}:${hid}:${resolvedLanguage}`;
        const base = { source: 'ratehawk', scale: 10, environment, requestedLanguage: language, resolvedLanguage };
        const result = {}, missing = [];
        for (const hid of hids) {
            const cached = memory.get(keyOf(hid));
            if (cached && cached.until > Date.now()) result[hid] = brief(cached.payload); else missing.push(hid);
        }
        try {
            if (missing.length && typeof CacheModel.find === 'function') {
                const stored = await CacheModel.find({ _id: { $in: missing.map(keyOf) } }).lean();
                for (const row of stored || []) {
                    if (!row?.expiresAt || new Date(row.expiresAt).getTime() <= Date.now()) continue;
                    const hid = missing.find(id => keyOf(id) === row._id);
                    if (hid === undefined) continue;
                    result[hid] = brief(row.payload);
                    missing.splice(missing.indexOf(hid), 1);
                }
            }
            if (missing.length && batches < 2) {
                batches++;
                const wanted = missing.slice(0, 100);
                const task = Promise.resolve().then(() => client.fetchHotelReviews(wanted.map(Number), resolvedLanguage)).then(async rows => {
                    const until = Date.now() + 12 * 3600000;
                    for (const hid of wanted) {
                        // A hotel absent from the answer has no reviews: an explicit empty summary, never a guess.
                        const record = rows.find(row => String(row.hid) === String(hid));
                        const normalized = normalizeReviews(record?.reviews || []);
                        const payload = { status: normalized.total ? 'ready' : 'empty', ...normalized, updatedAt: new Date().toISOString() };
                        memory.set(keyOf(hid), { payload, until });
                        try { await CacheModel.updateOne({ _id: keyOf(hid) }, { $set: { payload, expiresAt: new Date(until) } }, { upsert: true }); } catch {}
                    }
                    while (memory.size > 300) memory.delete(memory.keys().next().value);
                    return true;
                }).catch(() => false).finally(() => { batches--; });
                let timer;
                const done = await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => resolve(null), budgetMs); })]).finally(() => clearTimeout(timer));
                if (done) for (const hid of wanted) result[hid] = brief(memory.get(keyOf(hid))?.payload);
            }
        } catch { /* a partial answer is still a correct answer */ }
        const pending = hids.filter(hid => !Object.hasOwn(result, hid));
        return { ...base, status: pending.length ? 'partial' : 'ready', summaries: result, pending };
    }
    return { load, summaries };
}
module.exports = { createRatehawkHotelReviews, normalizeReviews, reviewDate };
