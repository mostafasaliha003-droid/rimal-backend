const { resolveHotelName } = require('./hotelPresentationService');
const { createHash } = require('node:crypto');
const PLACE_FIELDS = 'id,displayName,location,types,rating,userRatingCount,reviews,googleMapsUri,googleMapsLinks.reviewsUri,attributions';
const LANGUAGES = new Set(['ar', 'en', 'es']);
const fail = code => Object.assign(new Error(code), { code });

function point(value) {
    const latitude = value?.latitude, longitude = value?.longitude;
    if (latitude === null || latitude === undefined || latitude === '' || longitude === null || longitude === undefined || longitude === '') return null;
    const lat = Number(latitude), lng = Number(longitude);
    return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null;
}
function distance(a, b) {
    const rad = v => v * Math.PI / 180;
    const v = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
        + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
}
function tokens(name) {
    return String(name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ').filter(word => word && !['hotel', 'hotels', 'the', 'and'].includes(word));
}
function nameMatch(a, b) {
    const left = new Set(tokens(a)), right = new Set(tokens(b));
    if (left.size < 2 || right.size < 2) return false;
    const qualifiers = ['residence', 'residences', 'apartment', 'apartments', 'suite', 'suites', 'resort', 'villa', 'villas', 'hostel', 'tower', 'towers'];
    if (qualifiers.some(word => left.has(word) !== right.has(word))) return false;
    const common = [...left].filter(word => right.has(word)).length;
    return common / new Set([...left, ...right]).size >= 0.85;
}
function selectPlace(hotel, places) {
    const location = point(hotel), name = resolveHotelName(hotel.staticData?.name, hotel.name);
    if (!location || !name) return null;
    const matches = (places || []).filter(place => point(place.location) && distance(location, point(place.location)) <= 300
        && place.types?.some(type => ['lodging', 'hotel', 'resort_hotel', 'extended_stay_hotel'].includes(type))
        && /^[\w-]{5,250}$/.test(place.id || '') && nameMatch(name, place.displayName?.text));
    const unique = [...new Map(matches.map(place => [place.id, place])).values()];
    return unique.length === 1 ? unique[0] : null;
}
function googleUrl(value, { image = false } = {}) {
    try {
        const url = new URL(value);
        const allowed = image ? /(^|\.)(googleusercontent\.com|gstatic\.com)$/i
            : /(^|\.)(google\.com|maps\.app\.goo\.gl)$/i;
        return url.protocol === 'https:' && !url.username && !url.password && allowed.test(url.hostname) ? url.href : '';
    } catch { return ''; }
}
function reviewPayload(place) {
    const rating = place.rating, count = place.userRatingCount;
    return {
        source: 'google', placeId: place.id,
        rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null,
        count: Number.isSafeInteger(count) && count >= 0 ? count : null,
        url: googleUrl(place.googleMapsLinks?.reviewsUri) || googleUrl(place.googleMapsUri),
        attributions: (place.attributions || []).map(item => ({ name: item.provider || '', url: googleUrl(item.providerUri) })).filter(item => item.name),
        reviews: (place.reviews || []).slice(0, 5).map(review => ({
            rating: Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5 ? review.rating : null,
            text: typeof review.text?.text === 'string' ? review.text.text : '',
            textLanguage: review.text?.languageCode || '',
            originalText: typeof review.originalText?.text === 'string' ? review.originalText.text : '',
            originalLanguage: review.originalText?.languageCode || '',
            publishedAt: review.publishTime || '', relativeTime: review.relativePublishTimeDescription || '',
            visitDate: review.visitDate && Number.isInteger(review.visitDate.year) && Number.isInteger(review.visitDate.month)
                && review.visitDate.month >= 1 && review.visitDate.month <= 12 ? { year: review.visitDate.year, month: review.visitDate.month } : null,
            url: googleUrl(review.googleMapsUri),
            author: { name: review.authorAttribution?.displayName || '', url: googleUrl(review.authorAttribution?.uri),
                photo: googleUrl(review.authorAttribution?.photoUri, { image: true }) }
        }))
    };
}

function createGoogleHotelReviews({ HotelModel, PlaceModel, UsageModel, env = process.env, fetchImpl = fetch } = {}) {
    const pending = new Map(), cooldown = new Map();
    let active = 0;
    const enabled = () => env.GOOGLE_REVIEWS_ENABLED === 'true' && Boolean(env.GOOGLE_PLACES_API_KEY?.trim());
    async function reserve() {
        const day = new Date().toISOString().slice(0, 10);
        const configured = Number(env.GOOGLE_PLACES_DAILY_REQUEST_LIMIT || 200);
        const limit = Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 10000) : 200;
        try { await UsageModel.updateOne({ _id: day }, { $setOnInsert: { count: 0, expiresAt: new Date(Date.now() + 7 * 86400000) } }, { upsert: true }); }
        catch (error) { if (error.code !== 11000) throw fail('unavailable'); }
        const usage = await UsageModel.findOneAndUpdate({ _id: day, count: { $lt: limit } }, { $inc: { count: 1 } }, { new: true });
        if (!usage) throw fail('limited');
    }
    async function request(path, { body, fields, language = 'en' }) {
        await reserve();
        let response;
        try {
            response = await fetchImpl(`https://places.googleapis.com/v1/${path}${body ? '' : `?languageCode=${language}`}`, {
                method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(8000), redirect: 'error',
                headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': fields },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            if (!response.ok) throw fail(response.status === 429 ? 'limited' : 'unavailable');
            return await response.json();
        } catch (error) { throw fail(error.code === 'limited' ? 'limited' : 'unavailable'); }
    }
    async function load(hid, language) {
        if (!enabled()) return { status: 'unavailable' };
        const key = `${hid}:${language}`;
        if (pending.has(key)) return pending.get(key);
        if ((cooldown.get(key)?.until || 0) > Date.now()) return { status: cooldown.get(key).status };
        if (active >= 4) return { status: 'limited' };
        active++;
        const task = (async () => {
            const hotel = await HotelModel.findOne({ hid }).lean();
            if (!hotel || hotel.staticData?.deleted || hotel.staticData?.is_closed) return { status: 'not_found' };
            const location = point({ latitude: hotel.latitude ?? hotel.staticData?.latitude, longitude: hotel.longitude ?? hotel.staticData?.longitude });
            const name = resolveHotelName(hotel.staticData?.name, hotel.name);
            if (!location || !name) return { status: 'unmatched' };
            const supplierIdentity = createHash('sha256').update(JSON.stringify([name, location])).digest('hex');
            const saved = await PlaceModel.findOne({ hid }).lean();
            let placeId = saved?.supplierIdentity === supplierIdentity ? saved.placeId : null;
            if (!placeId) {
                const data = await request('places:searchText', { fields: 'places.id,places.displayName,places.location,places.types', body: {
                    textQuery: [name, hotel.address || hotel.staticData?.address, hotel.city].filter(Boolean).join(' '),
                    languageCode: 'en', pageSize: 5, locationBias: { circle: { center: location, radius: 500 } }
                } });
                const matched = selectPlace({ ...hotel, ...location }, data.places);
                if (!matched) return { status: 'unmatched' };
                placeId = matched.id;
                await PlaceModel.updateOne({ hid }, { $set: { placeId, supplierIdentity, verifiedAt: new Date() } }, { upsert: true });
            }
            if (!/^[\w-]{5,250}$/.test(placeId)) return { status: 'unmatched' };
            const place = await request(`places/${encodeURIComponent(placeId)}`, { fields: PLACE_FIELDS, language });
            if (place.id !== placeId || !point(place.location) || distance(location, point(place.location)) > 300) return { status: 'unmatched' };
            return { status: 'ready', ...reviewPayload(place) };
        })().catch(error => ({ status: error.code === 'limited' ? 'limited' : 'unavailable' }))
            .then(result => {
                if (result.status !== 'ready') {
                    cooldown.set(key, { status: result.status, until: Date.now() + (result.status === 'unmatched' ? 600000 : 60000) });
                    while (cooldown.size > 1000) cooldown.delete(cooldown.keys().next().value);
                }
                return result;
            }).finally(() => { pending.delete(key); active--; });
        pending.set(key, task);
        return task;
    }
    return { load, enabled };
}

module.exports = { createGoogleHotelReviews, selectPlace, nameMatch, reviewPayload, LANGUAGES };
