// services/ratehawkService.js
// High-level orchestration of the Emerging Travel Group (ETG) / RateHawk B2B API v3,
// following the recommended workflow:
//   Search (serp) -> Hotelpage (hp) -> Prebook -> Booking form -> Booking finish
//   -> Booking finish status (poll) -> Order info / Cancel
//
// Backward-compatible entry points used by server.js are preserved:
//   fetchHotelsInChunks, fetchSingleHotelPage, recheckHotel, bookHotel,
//   fetchOrderDetails, cancelBooking

const crypto = require('crypto');
const { isIP } = require('node:net');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const client = require('./ratehawkClient');
const mappingService = require('./mappingService');
const logger = require('./loggerService');

// Fallback name for hotels not yet present in our local static-content cache.
const FALLBACK_HOTEL_NAME = 'فندق شريك لرمال وفلّها';

// Real hotel used to validate financial responsibilities in RateHawk's "Test
// environment" (a bookable real property) before switching to Production keys.
const RATEHAWK_TEST_HOTEL_ID = '8473727'; // Used for testing real financial bookings in the Test environment.

// Frontend base URL used to build the booking return_path. ETG's security check
// extracts the HTTPS host from return_path and fails the booking if it doesn't
// match the host registered in the ETG account settings.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://remalbookings.com';
const RETURN_SUCCESS_PATH = process.env.RATEHAWK_RETURN_PATH || '/checkout/success';

// Always emit an https:// URL regardless of how FRONTEND_URL was written.
function buildReturnPath() {
    const host = String(FRONTEND_URL).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const path = RETURN_SUCCESS_PATH.startsWith('/') ? RETURN_SUCCESS_PATH : `/${RETURN_SUCCESS_PATH}`;
    return `https://${host}${path}`;
}

// The frontend sends the app's `destinationCode` (e.g. "DXB"), which is NOT an ETG
// region id and does NOT resolve via multicomplete (only city NAMES like "Dubai" do).
// Map codes -> ETG region ids here. Region ids differ between sandbox and production,
// so override via RATEHAWK_DESTINATION_REGION_MAP (JSON) and/or RATEHAWK_DEFAULT_REGION_ID.
const DESTINATION_REGION_MAP = (() => {
    const base = { DXB: 6053839 }; // Dubai (sandbox); set the production id via env
    let merged = { ...base };
    try {
        if (process.env.RATEHAWK_DESTINATION_REGION_MAP) {
            merged = { ...merged, ...JSON.parse(process.env.RATEHAWK_DESTINATION_REGION_MAP) };
        }
    } catch (e) { logger.warn('Invalid RATEHAWK_DESTINATION_REGION_MAP JSON; ignoring'); }
    const out = {};
    for (const k of Object.keys(merged)) out[String(k).toUpperCase()] = Number(merged[k]);
    return out;
})();
const DEFAULT_REGION_ID = Number(process.env.RATEHAWK_DEFAULT_REGION_ID) || null;
const FILTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FILTER_CACHE_FILE = path.join(__dirname, '..', 'data', 'filters.json');
const FILTER_KEYS = ['language', 'country', 'serp_filter', 'star_rating', 'kind'];

// Access the shared Hotel model (registered by server.js / syncRatehawkHotels.js).
// Defined lazily so requiring this module never fails if the model isn't set up yet.
function getHotelModel() {
    if (mongoose.models.Hotel) return mongoose.models.Hotel;
    const hotelSchema = new mongoose.Schema({
        hotelId: { type: String, required: true, unique: true },
        name: String, address: String, city: String, countryCode: String,
        stars: String, latitude: String, longitude: String, image: String,
        provider: { type: String, default: 'dubailink' }
    });
    return mongoose.model('Hotel', hotelSchema);
}

function getBookingModel() {
    if (mongoose.models.Booking) return mongoose.models.Booking;
    const bookingSchema = new mongoose.Schema({
        bookingReference: String,
        supplierReference: String,
        status: String,
        supplierStatus: String,
        provider: String,
        hotelConfirmationNumber: String
    });
    return mongoose.model('Booking', bookingSchema);
}

async function syncBookingByPartnerOrderId(partnerOrderId, update) {
    try {
        const Booking = getBookingModel();
        const booking = await Booking.findOne({
            provider: 'ratehawk',
            $or: [
                { supplierReference: String(partnerOrderId) },
                { bookingReference: String(partnerOrderId) }
            ]
        });
        if (!booking) return false;
        Object.assign(booking, update);
        await booking.save();
        return true;
    } catch (error) {
        logger.error('RateHawk booking database sync failed', { error: error.message, partnerOrderId });
        return false;
    }
}

// How long bookHotel() will poll booking/finish/status before returning "processing".
const BOOK_WAIT_MS = parseInt(process.env.RATEHAWK_BOOK_WAIT_MS || '90000', 10);
const BOOK_POLL_INTERVAL_MS = parseInt(process.env.RATEHAWK_BOOK_POLL_MS || '5000', 10);

// Hotelpage (hp) is used EXCLUSIVELY on hotel selection (getHotelPricing), never
// looped over search results — the ETG-recommended "HP on selection only" pattern.
// hp is strictly rate-limited (~10/min); a short-lived cache lets repeated views of
// the same hotel/dates reuse the result (ETG allows caching hotelpage rates ~1h).
const HP_CACHE_TTL_MS = parseInt(process.env.RATEHAWK_HP_CACHE_TTL_MS || '600000', 10); // 10 min
const hpCache = new Map(); // key -> { rates, id, hid, expires }

function hpCacheKey(hotelKey, p) {
    return `${hotelKey}|${p.checkin}|${p.checkout}|${p.residency}|${p.currency}|${JSON.stringify(p.guests)}`;
}

// Booking status errors that are final (stop polling immediately).
const FINAL_STATUS_ERRORS = new Set([
    '3ds', 'block', 'book_limit', 'booking_finish_did_not_succeed', 'charge', 'decoding_json',
    'endpoint_exceeded_limit', 'endpoint_not_active', 'endpoint_not_found', 'incorrect_credentials',
    'invalid_auth_header', 'invalid_params', 'lock', 'no_auth_header', 'not_allowed',
    'not_allowed_host', 'order_not_found', 'overdue_debt', 'provider', 'soldout', 'unexpected_method'
]);

// ---- Input normalization ----------------------------------------------------
function normalizeSearchParams(p = {}) {
    // children ages: frontend sends `children` as a count and `childrenAges` as ages.
    const ages = Array.isArray(p.childrenAges) ? p.childrenAges
        : (Array.isArray(p.children) ? p.children : []);
    const guests = Array.isArray(p.guests) && p.guests.length
        ? p.guests.map(g => ({ adults: Number(g.adults) || 2, children: Array.isArray(g.children) ? g.children : [] }))
        : [{ adults: Number(p.adults) || 2, children: ages.map(a => Number(a)).filter(n => Number.isFinite(n)) }];

    return {
        checkin: p.checkin || p.checkIn || p.check_in || p.checkInDate,
        checkout: p.checkout || p.checkOut || p.check_out || p.checkOutDate,
        residency: String(p.residency || process.env.RATEHAWK_RESIDENCY || 'ae').toLowerCase().slice(0, 2),
        language: p.language || 'en',
        currency: p.currency || process.env.RATEHAWK_CURRENCY || 'USD',
        upsells: normalizeUpsells(
            p.upsells,
            p.checkin || p.checkIn || p.check_in || p.checkInDate,
            p.checkout || p.checkOut || p.check_out || p.checkOutDate
        ),
        guests
    };
}

// Resolve a free-text destination (e.g. "Dubai") to an ETG region id via multicomplete.
async function resolveRegionId(query, language = 'en') {
    if (!query) return null;
    const res = await client.multicomplete({ query: String(query), language });
    if (!res.ok) return null;
    const regions = (res.data && res.data.regions) || [];
    return regions.length ? regions[0].id : null;
}

// Resolve the ETG region id for a search request from whatever the app sends.
// Order: explicit region_id -> numeric/mapped destinationCode -> name via multicomplete
//        -> configured default region (RATEHAWK_DEFAULT_REGION_ID).
async function resolveRegionForSearch(p = {}, language = 'en') {
    const explicit = Number(p.region_id);
    if (explicit) return explicit;

    const code = String(p.destinationCode || p.destination_code || '').trim();
    if (code) {
        if (/^\d+$/.test(code)) return Number(code);                 // already a region id
        if (DESTINATION_REGION_MAP[code.toUpperCase()]) return DESTINATION_REGION_MAP[code.toUpperCase()];
    }

    // Free-text destination name (avoid wasting a multicomplete on short codes like "DXB").
    const looksLikeCode = /^[A-Za-z0-9]{2,4}$/.test(code);
    const name = p.destination || p.destinationName || p.query || (code && !looksLikeCode ? code : '');
    if (name) {
        const viaName = await resolveRegionId(name, language);
        if (viaName) return viaName;
    }

    return DEFAULT_REGION_ID || null;
}


function rateToAED(rate) {
    const pt = rate && rate.payment_options && rate.payment_options.payment_types && rate.payment_options.payment_types[0];
    const amount = parseFloat((pt && pt.amount) || rate.price || 0);
    const currency = (pt && pt.currency_code) || rate.currency || 'USD';
    const sellPriceLimits = rate && (rate.sell_price_limits || (pt && pt.sell_price_limits));
    const sellPrice = mappingService.calculateSellPrice(
        amount,
        currency,
        sellPriceLimits,
        mappingService.getMarkupPercent(rate)
    );
    return mappingService.convertToAED(sellPrice, currency);
}

function invalidUpsells(message) {
    const error = new Error(`Invalid RateHawk upsells: ${message}`);
    error.code = 'invalid_upsells';
    return error;
}

function validateDatePart(value, field) {
    const date = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw invalidUpsells(`${field} must be YYYY-MM-DD`);
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw invalidUpsells(`${field} is not a valid calendar date`);
    }
    return date;
}

function formatUpsellTime(value, expectedDate, field) {
    const raw = String(value || '').trim();
    const time = raw.match(/^(?:\d{4}-\d{2}-\d{2}T)?(\d{2}):(\d{2})$/);
    if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) {
        throw invalidUpsells(`${field} must be HH:MM or YYYY-MM-DDTHH:MM`);
    }
    if (raw.includes('T') && raw.slice(0, 10) !== expectedDate) {
        throw invalidUpsells(`${field} must use ${expectedDate}`);
    }
    return `${expectedDate}T${time[1]}:${time[2]}`;
}

function normalizeUpsells(upsells, checkin, checkout) {
    if (upsells === undefined || upsells === null || upsells === '') return undefined;
    if (typeof upsells !== 'object' || Array.isArray(upsells)) {
        throw invalidUpsells('upsells must be an object');
    }

    const dates = {
        early_checkin: validateDatePart(checkin, 'checkin'),
        late_checkout: validateDatePart(checkout, 'checkout')
    };
    const normalized = {};

    Object.keys(dates).forEach(key => {
        let value = upsells[key];
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) {
            if (value.length > 1) throw invalidUpsells(`only one ${key} is allowed per order`);
            if (!value.length) return;
            value = value[0];
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw invalidUpsells(`${key} must be an object`);
        }
        normalized[key] = {
            ...value,
            time: formatUpsellTime(value.time, dates[key], `${key}.time`)
        };
    });

    return Object.keys(normalized).length ? normalized : undefined;
}

function toBookingDateTime(time) {
    if (!time || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) {
        throw invalidUpsells('booking upsell times must be YYYY-MM-DDTHH:MM');
    }
    return `${time}:00Z`;
}

function collectUpsellOptions(value, result = []) {
    if (!value || typeof value !== 'object') return result;
    if (Array.isArray(value)) {
        value.forEach(item => collectUpsellOptions(item, result));
        return result;
    }
    if (value.uid !== undefined && (value.name !== undefined || value.rule_id !== undefined)) {
        result.push(value);
    }
    Object.keys(value).forEach(key => {
        if (key === 'upsells' || key === 'upsell_data' || key === 'options') {
            collectUpsellOptions(value[key], result);
        }
    });
    return result;
}

function buildUpsellData(details, bookingFormData) {
    const selected = details.upsells || details.upsell_data;
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
        if (selected) throw invalidUpsells('booking upsells must be an object');
        return undefined;
    }

    const keys = Object.keys(selected).filter(key => ['early_checkin', 'late_checkout'].includes(key));
    if (keys.length > 2) throw invalidUpsells('only one early check-in and one late check-out are allowed per order');
    keys.forEach(key => {
        if (Array.isArray(selected[key]) && selected[key].length > 1) {
            throw invalidUpsells(`only one ${key} is allowed per order`);
        }
    });
    const normalized = normalizeUpsells(selected,
        details.checkin || details.checkIn || details.checkinDate || details.checkInDate,
        details.checkout || details.checkOut || details.checkoutDate || details.checkOutDate);
    const available = collectUpsellOptions(bookingFormData);

    return keys.map(key => {
        const choice = normalized[key];
        const match = available.find(option =>
            (choice.uid !== undefined && String(option.uid) === String(choice.uid))
            || (choice.rule_id !== undefined && String(option.rule_id) === String(choice.rule_id)
                && (choice.name === undefined || String(option.name) === String(choice.name)))
            || (choice.name !== undefined && String(option.name) === String(choice.name))
        );
        if (!match) throw invalidUpsells(`could not resolve ${key} uid from the booking response`);

        const item = {
            uid: match.uid,
            name: choice.name || match.name,
            rule_id: choice.rule_id !== undefined ? choice.rule_id : match.rule_id
        };
        if (!item.name || item.rule_id === undefined || item.rule_id === null) {
            throw invalidUpsells(`${key} is missing name or rule_id`);
        }
        if (key === 'early_checkin') item.checkin_datetime = toBookingDateTime(choice.time);
        if (key === 'late_checkout') item.checkout_datetime = toBookingDateTime(choice.time);
        return item;
    });
}

// ---- Account / monitoring ---------------------------------------------------
// GET /overview/ (via the configured BASE_URL + Basic auth) and parse the response
// into the array of endpoint limits: { endpoint, is_active, is_limited,
// requests_number, seconds_number }. Throws on API failure so callers can 502.
async function getApiOverview() {
    const res = await client.overview();
    if (!res.ok) {
        throw new Error(`RateHawk overview failed: ${res.error || 'HTTP ' + res.httpStatus}`);
    }
    return Array.isArray(res.data) ? res.data : [];
}

// ---- Step 1: Static / content ----------------------------------------------
const getHotelStatic = () => client.hotelStatic();
const getSingleHotelInfo = (hid, language = 'en') => client.getSingleHotelInfo(hid, language);
const fetchFilterValues = () => client.filterValues();
const getHotelIdsByFilter = (data) => client.hotelIdsByFilter(data);

function selectFilterValues(data) {
    const source = data && data.filters && typeof data.filters === 'object' ? data.filters : data;
    const filters = {};
    FILTER_KEYS.forEach(key => {
        if (source && Object.prototype.hasOwnProperty.call(source, key)) filters[key] = source[key];
    });
    return filters;
}

function readFilterCache() {
    try {
        if (!fs.existsSync(FILTER_CACHE_FILE)) return null;
        const cached = JSON.parse(fs.readFileSync(FILTER_CACHE_FILE, 'utf8'));
        if (!cached || !cached.fetchedAt || !cached.filters) return null;
        const fetchedAt = new Date(cached.fetchedAt).getTime();
        if (!Number.isFinite(fetchedAt)) return null;
        return { filters: selectFilterValues(cached.filters), fetchedAt: new Date(fetchedAt).toISOString() };
    } catch (error) {
        logger.warn('RateHawk filter cache could not be read', { error: error.message });
        return null;
    }
}

function writeFilterCache(filters) {
    const directory = path.dirname(FILTER_CACHE_FILE);
    const temporaryFile = `${FILTER_CACHE_FILE}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryFile, JSON.stringify({ fetchedAt: new Date().toISOString(), filters }, null, 2), 'utf8');
    fs.renameSync(temporaryFile, FILTER_CACHE_FILE);
}

async function getFilterValues({ forceRefresh = false } = {}) {
    const cached = readFilterCache();
    const cacheAge = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
    if (!forceRefresh && cached && cacheAge >= 0 && cacheAge < FILTER_CACHE_TTL_MS) {
        logger.info('RateHawk filter values served from cache', { ageMs: cacheAge });
        return { ...cached, source: 'cache', stale: false };
    }

    try {
        const response = await fetchFilterValues();
        if (!response.ok) throw new Error(response.error || 'filter_values request failed');
        const filters = selectFilterValues(response.data);
        writeFilterCache(filters);
        logger.info('RateHawk filter values synchronized', { keys: Object.keys(filters) });
        const fetchedAt = new Date().toISOString();
        return { filters, fetchedAt, source: 'api', stale: false };
    } catch (error) {
        if (cached) {
            logger.warn('RateHawk filter sync failed; serving stale cache', { error: error.message });
            return { ...cached, source: 'stale-cache', stale: true };
        }
        logger.error('RateHawk filter sync failed with no cache available', { error: error.message });
        throw error;
    }
}

async function getHotelsContent(ids = [], hids = [], language = 'en') {
    // ETG expects either hids OR ids, not both (sending both -> invalid_params).
    const body = { language };
    if (hids && hids.length) body.hids = hids;
    else if (ids && ids.length) body.ids = ids;
    else return [];
    const res = await client.hotelContentByIds(body);
    return res.ok ? (res.data || []) : [];
}

// ---- Step 2: Search ---------------------------------------------------------
async function getAutocompleteSuggestions(query, language = 'en') {
    const suggestions = await client.suggestHotelAndRegion(query, language);
    const hasHotels = Array.isArray(suggestions?.hotels) && suggestions.hotels.length > 0;
    const hasRegions = Array.isArray(suggestions?.regions) && suggestions.regions.length > 0;
    if (language !== 'en' && !hasHotels && !hasRegions) {
        return client.suggestHotelAndRegion(query, 'en');
    }
    return suggestions;
}
const searchLiveRates = (searchCriteria = {}) => client.searchHotels(searchCriteria);
const searchLiveRatesByGeo = (searchCriteria = {}) => client.searchHotelsByGeo(searchCriteria);
const searchLiveRatesByRegion = (searchCriteria = {}) => client.searchHotelsByRegion(searchCriteria);
const getRegionHotelSort = (regionId, limit = 250) => {
    const parsedRegionId = parseInt(regionId, 10);
    if (!Number.isInteger(parsedRegionId)) throw new TypeError('regionId must be an integer');
    const parsedLimit = parseInt(limit, 10);
    const hotelsLimit = Number.isInteger(parsedLimit) ? Math.min(250, Math.max(1, parsedLimit)) : 250;
    return client.sortHotelsInRegion({
        region_id: parsedRegionId,
        sort_type: 'b2b',
        hotels_limit: hotelsLimit
    });
};
const getHotelPageRates = (searchCriteria = {}) => client.getHotelPageRates(searchCriteria);
const getRateDetailsByHash = (bookHash, language = 'en') => client.lookupRateInfo(bookHash, language);

/**
 * Search availability by region / hotel ids / geo. Returns an array of hotels
 * shaped for mappingService (id, hid, name, image, rates, provider:'ratehawk').
 */
async function searchAvailability(rawParams = {}) {
    const params = normalizeSearchParams(rawParams);
    if (!params.checkin || !params.checkout) {
        logger.warn('RateHawk search skipped: checkin/checkout are required');
        return [];
    }

    // 2a. SERP step — get the candidate hotels for the destination.
    // NOTE: When the account manager asks us to validate real billing in RateHawk's
    // Test environment, run a search/hp/prebook/book flow against the real test hotel
    // RATEHAWK_TEST_HOTEL_ID ('8473727') (e.g. pass hids:[RATEHAWK_TEST_HOTEL_ID]).
    let res;
    if ((rawParams.hids && rawParams.hids.length) || (rawParams.ids && rawParams.ids.length)) {
        res = await client.serpHotels({ ...params, hids: rawParams.hids, ids: rawParams.ids });
    } else if (rawParams.latitude && rawParams.longitude) {
        res = await client.serpGeo({ ...params, latitude: Number(rawParams.latitude), longitude: Number(rawParams.longitude), radius: rawParams.radius || 5000, hotels_limit: rawParams.hotels_limit || 30 });
    } else {
        // region search: resolve region_id from region_id / destinationCode (map) /
        // destination name (multicomplete) / configured default region.
        const regionId = await resolveRegionForSearch(rawParams, params.language);
        if (!regionId) {
            logger.warn(`RateHawk search skipped: could not resolve a region ` +
                `(region_id/destinationCode="${rawParams.destinationCode || ''}"). ` +
                `Set RATEHAWK_DEFAULT_REGION_ID or RATEHAWK_DESTINATION_REGION_MAP, or send a destination name.`);
            return [];
        }
        res = await client.serpRegion({ ...params, region_id: regionId, hotels_limit: rawParams.hotels_limit || 30 });
    }

    if (!res.ok) {
        logger.error('RateHawk SERP search failed', { error: res.error });
        return [];
    }

    const serpHotels = (res.data && res.data.hotels) || [];
    if (!serpHotels.length) return [];

    // SERP-only listing (fast). We do NOT call hotelpage per result — that is done
    // lazily via getHotelPricing() when the user opens a specific hotel. The SERP
    // rates (cheapest shown) are enough for the listing; full bookable rates with
    // book_hash come from HP-on-selection.
    // Hydrate static content (name/image/stars/lat/lng) from our local MongoDB
    // Hotel cache (populated by syncRatehawkHotels.js).
    let dbMap = {};
    try {
        const Hotel = getHotelModel();
        const idList = serpHotels.map(h => h.id).filter(Boolean);
        const docs = await Hotel.find({ hotelId: { $in: idList } }).lean();
        docs.forEach(d => { dbMap[d.hotelId] = d; });
        logger.info(`RateHawk search: ${serpHotels.length} hotels from SERP; hydrated ${docs.length}/${idList.length} from local DB cache`);
    } catch (e) {
        logger.warn('RateHawk DB hydration skipped', { error: e.message });
    }

    return serpHotels.map(h => {
        const d = dbMap[h.id] || {};
        return {
            id: h.id,
            hid: h.hid,
            name: d.name || FALLBACK_HOTEL_NAME,
            image: d.image || '',
            stars: d.stars || '',
            city: d.city || 'دبي',
            latitude: d.latitude || '',
            longitude: d.longitude || '',
            metapolicy_struct: d.staticData && d.staticData.metapolicy_struct,
            rates: h.rates || [],
            provider: 'ratehawk'
        };
    });
}

// HP-on-selection: fetch full rooms/rates (with bookable book_hash) for a SINGLE
// hotel the user opened. This is the only place we call /search/hp/.
async function getHotelPricing(hotelId, searchParams = {}) {
    const params = normalizeSearchParams(searchParams);
    if (!hotelId) return { success: false, error: 'missing_hotel_id', rooms: [] };
    if (!params.checkin || !params.checkout) return { success: false, error: 'missing_dates', rooms: [] };

    const numeric = /^\d+$/.test(String(hotelId));
    const key = hpCacheKey(hotelId, params);
    let entry = hpCache.get(key);
    if (!entry || entry.expires <= Date.now()) {
        const body = { ...params };
        if (numeric) body.hid = Number(hotelId); else body.id = String(hotelId);
        const res = await client.hotelPage(body); // single user-facing call: 429 -> sleep+retry is fine
        if (!res.ok) return { success: false, error: res.error || 'hp_failed', rooms: [] };
        const hotel = res.data && res.data.hotels && res.data.hotels[0];
        if (!hotel) return { success: false, error: 'not_found', rooms: [] };
        entry = {
            rates: hotel.rates || [],
            metapolicy_struct: hotel.metapolicy_struct || hotel.metapolicy || null,
            id: hotel.id,
            hid: hotel.hid,
            expires: Date.now() + HP_CACHE_TTL_MS
        };
        hpCache.set(key, entry);
    }

    // Hydrate static content from our local DB, then map to the unified room shape.
    let doc = null;
    try {
        const Hotel = getHotelModel();
        doc = await Hotel.findOne({ hotelId: String(entry.id || hotelId) }).lean();
    } catch (e) { /* ignore */ }

    const raw = {
        id: entry.id || hotelId,
        hid: entry.hid,
        name: (doc && doc.name) || FALLBACK_HOTEL_NAME,
        image: (doc && doc.image) || '',
        stars: (doc && doc.stars) || '',
        city: (doc && doc.city) || 'دبي',
        latitude: (doc && doc.latitude) || '',
        longitude: (doc && doc.longitude) || '',
        metapolicy_struct: entry.metapolicy_struct
            || (doc && doc.staticData && doc.staticData.metapolicy_struct),
        rates: entry.rates || [],
        provider: 'ratehawk'
    };
    const [mapped] = mappingService.deduplicateHotels([raw]);
    return {
        success: true,
        hotelId: raw.id,
        hid: raw.hid,
        name: raw.name,
        image: raw.image,
        stars: raw.stars,
        latitude: raw.latitude,
        longitude: raw.longitude,
        metapolicy: (mapped && mapped.metapolicy) || [],
        rooms: (mapped && mapped.rooms) || []
    };
}

// Backward-compatible name used by server.js
const fetchHotelsInChunks = (searchParams) => searchAvailability(searchParams);

/**
 * Retrieve the full hotelpage (all rates) for a single hotel the user selected.
 */
async function getHotelPage(rawParams = {}) {
    const params = normalizeSearchParams(rawParams);
    const body = { ...params };
    if (rawParams.hid) body.hid = Number(rawParams.hid);
    if (rawParams.id) body.id = rawParams.id;
    const res = await client.hotelPage(body);
    if (!res.ok) return { success: false, error: res.error };
    const hotel = (res.data && res.data.hotels && res.data.hotels[0]) || null;
    return { success: true, hotel, rates: (hotel && hotel.rates) || [] };
}

// Backward-compatible signature: fetchSingleHotelPage(hotelId, searchParams)
async function fetchSingleHotelPage(hotelId, searchParams = {}) {
    const numeric = /^\d+$/.test(String(hotelId));
    const merged = { ...searchParams, [numeric ? 'hid' : 'id']: hotelId };
    const page = await getHotelPage(merged);
    return {
        success: page.success,
        hotelId,
        rooms: (page.rates || []).map(r => ({
            roomId: r.book_hash,
            match_hash: r.match_hash,
            name: r.room_name,
            board: r.meal,
            priceAED: rateToAED(r),
            book_hash: r.book_hash
        }))
    };
}

// ---- Step 3: Prebook --------------------------------------------------------
async function prebookRate(bookHash, priceIncreasePercent = 0) {
    const res = await client.prebook({ hash: bookHash, price_increase_percent: priceIncreasePercent });
    if (!res.ok) return { success: false, error: res.error };
    const hotel = (res.data && res.data.hotels && res.data.hotels[0]) || null;
    const rate = hotel && hotel.rates && hotel.rates[0];
    return {
        success: true,
        priceChanged: !!(res.data && res.data.changes && res.data.changes.price_changed),
        rate,
        bookHash: rate && rate.book_hash,
        finalPriceAED: rate ? rateToAED(rate) : 0
    };
}

const validatePrebookRate = (hash, priceIncreasePercent = 0) =>
    client.prebookRate(hash, priceIncreasePercent);
const validateSerpPrebookRate = (hash, priceIncreasePercent = 0) =>
    client.prebookSerpRate(hash, priceIncreasePercent);

/**
 * Backward-compatible recheck used by server.js recheck-and-pay.
 * Accepts book_hash / hash / roomId / rateKey. Returns { success, finalPrice }.
 */
async function recheckHotel(details = {}) {
    const bookHash = details.book_hash || details.hash || details.rateKey || details.roomId;
    if (!bookHash) return { success: false, error: 'missing book_hash' };
    const pre = await prebookRate(bookHash, details.price_increase_percent || 0);
    if (!pre.success) return { success: false, error: pre.error };
    return {
        success: true,
        status: 'AVAILABLE',
        finalPrice: pre.finalPriceAED,
        book_hash: pre.bookHash,
        priceChanged: pre.priceChanged
    };
}

// ---- Step 4: Booking --------------------------------------------------------
function bookingError(code, httpStatus = 400) {
    const error = new Error(code);
    error.code = code;
    error.ratehawkError = code;
    error.httpStatus = httpStatus;
    return error;
}

function requiredText(value, field, maxLength = 256) {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
        throw bookingError(`invalid_${field}`);
    }
    return value.trim();
}

function transientBookingFailure(value) {
    return value?.httpStatus >= 500 || value?.response?.status >= 500
        || ['timeout', 'unknown'].includes(value?.ratehawkError || value?.error)
        || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(value?.code);
}

function retryAfterMs(response) {
    if (response?.httpStatus !== 429) return 5000;
    const limit = response.rateLimit || {};
    const reset = String(limit.reset || '').trim();
    const resetTime = /^\d+$/.test(reset) ? Number(reset) * (Number(reset) < 1e12 ? 1000 : 1)
        : Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(reset) ? reset : `${reset}Z`);
    const windowSeconds = Number(limit.secondsNumber);
    return Math.max(5000, Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds * 1000 : 60000,
        Number.isFinite(resetTime) ? resetTime - Date.now() : 0);
}

async function createBookingProcess(details = {}, { beforeAttempt = async () => {}, maxAttempts = 10 } = {}) {
    const bookHash = requiredText(details.book_hash, 'book_hash', 1024);
    const language = requiredText(details.language || 'en', 'language', 5);
    const userIp = requiredText(details.user_ip, 'user_ip', 45);
    if (!isIP(userIp)) throw bookingError('invalid_user_ip');
    let partnerOrderId = details.partner_order_id
        ? requiredText(details.partner_order_id, 'partner_order_id') : crypto.randomUUID();
    const attempts = Math.min(10, Math.max(1, Math.floor(Number(maxAttempts)) || 1));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) partnerOrderId = crypto.randomUUID();
        await beforeAttempt(partnerOrderId);
        let response;
        try {
            response = await client.bookingForm({ book_hash: bookHash, partner_order_id: partnerOrderId, language, user_ip: userIp });
        } catch (error) {
            if (!transientBookingFailure(error) || attempt === attempts - 1) throw error;
            continue;
        }
        if (response.ok && response.httpStatus < 300) {
            const data = response.data;
            if (!data || !data.order_id || (data.partner_order_id && data.partner_order_id !== partnerOrderId)
                || !Array.isArray(data.payment_types) || !data.payment_types.length) {
                throw bookingError('invalid_booking_form_response', 502);
            }
            return {
                partner_order_id: partnerOrderId,
                order_id: data.order_id,
                item_id: data.item_id,
                payment_types: data.payment_types,
                is_gender_specification_required: data.is_gender_specification_required === true,
                upsell_data: data.upsell_data || []
            };
        }
        const retryable = transientBookingFailure(response) || ['double_booking_form', 'duplicate_reservation'].includes(response.error);
        if (!retryable || attempt === attempts - 1) {
            throw bookingError(response.httpStatus === 429 ? 'rate_limit' : response.error || 'booking_form_unavailable', response.httpStatus === 429 ? 429 : 502);
        }
    }
}

function buildGuests(details) {
    if (!Array.isArray(details.rooms) || !details.rooms.length || details.rooms.length > 9) throw bookingError('invalid_rooms');
    return details.rooms.map(room => {
        if (!room || !Array.isArray(room.guests) || !room.guests.length || room.guests.length > 20) throw bookingError('invalid_guests');
        return { guests: room.guests.map(guest => {
            if (!guest || typeof guest !== 'object') throw bookingError('invalid_guest');
            if (guest.is_child !== undefined && typeof guest.is_child !== 'boolean') throw bookingError('invalid_is_child');
            if (guest.is_child && (!Number.isInteger(guest.age) || guest.age < 0 || guest.age > 17)) throw bookingError('invalid_child_age');
            if (guest.gender !== undefined && !['male', 'female'].includes(guest.gender)) throw bookingError('invalid_gender');
            return {
                first_name: requiredText(guest.first_name || guest.firstName, 'guest_first_name', 100),
                last_name: requiredText(guest.last_name || guest.lastName, 'guest_last_name', 100),
                is_child: guest.is_child === true,
                ...(guest.is_child ? { age: guest.age } : {}),
                ...(guest.gender ? { gender: guest.gender } : {})
            };
        }) };
    });
}

function selectBookingPayment(form, selection) {
    const payments = form.payment_types || [];
    const canonicalAmount = value => {
        const text = String(value);
        if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
        const [whole, fraction = ''] = text.split('.');
        return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
    };
    const payment = selection ? payments.find(option => option.type === selection.type
        && option.currency_code === selection.currency_code && canonicalAmount(option.amount) !== null
        && canonicalAmount(option.amount) === canonicalAmount(selection.amount)) : payments.length === 1 ? payments[0] : null;
    if (!payment || !['deposit', 'hotel', 'now'].includes(payment.type) || canonicalAmount(payment.amount) === null
        || !/^[A-Z]{3}$/.test(payment.currency_code)) throw bookingError('incorrect_chosen_payment_type');
    return payment;
}

async function createBookingCardToken(details, form, tokens = { init_uuid: crypto.randomUUID(), pay_uuid: crypto.randomUUID() }) {
    if (process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED !== 'true') throw bookingError('card_tokenization_disabled', 503);
    const payment = selectBookingPayment(form, details.payment_type);
    if (!payment.is_need_credit_card_data) throw bookingError('credit_card_not_required');
    const objectId = String(form.item_id ?? '');
    if (!objectId || objectId.length > 20) throw bookingError('missing_booking_item_id', 502);
    const card = details.credit_card_data_core || {};
    if (!/^\d{13,19}$/.test(card.card_number) || typeof card.card_number !== 'string') throw bookingError('invalid_card_number');
    if (!/^(0[1-9]|1[0-2])$/.test(card.month) || typeof card.month !== 'string') throw bookingError('invalid_month');
    if (!/^\d{2}$/.test(card.year) || typeof card.year !== 'string') throw bookingError('invalid_year');
    if ((payment.is_need_cvc || details.cvc !== undefined) && (typeof details.cvc !== 'string' || !/^\d{3}$/.test(details.cvc))) throw bookingError('invalid_cvc');
    const request = {
        object_id: objectId,
        init_uuid: tokens.init_uuid,
        pay_uuid: tokens.pay_uuid,
        user_first_name: requiredText(details.user_first_name, 'user_first_name', 100),
        user_last_name: requiredText(details.user_last_name, 'user_last_name', 100),
        is_cvc_required: payment.is_need_cvc === true,
        ...(details.cvc !== undefined ? { cvc: details.cvc } : {}),
        credit_card_data_core: {
            card_number: card.card_number, month: card.month, year: card.year,
            card_holder: requiredText(card.card_holder, 'card_holder', 150)
        }
    };
    await client.createCreditCardToken(request);
    return { init_uuid: request.init_uuid, pay_uuid: request.pay_uuid };
}

function buildBookingFinish(details, form) {
    const payment = selectBookingPayment(form, details.payment_type);
    const rooms = buildGuests(details);
    if (form.is_gender_specification_required && rooms.some(room => room.guests.some(guest => !guest.gender))) throw bookingError('gender_required');
    const contact = details.user || { email: details.email || details.holderEmail, phone: details.phone || details.holderPhone, comment: details.comment };
    const email = requiredText(contact.email, 'email');
    const phone = requiredText(contact.phone, 'phone', 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bookingError('invalid_email');
    const request = {
        language: details.language || 'en',
        partner: { partner_order_id: requiredText(form.partner_order_id, 'partner_order_id') },
        user: { email, phone, ...(contact.comment ? { comment: requiredText(contact.comment, 'comment', 2000) } : {}) },
        rooms,
        payment_type: { type: payment.type, amount: payment.amount, currency_code: payment.currency_code }
    };
    if (details.supplier_data) {
        request.supplier_data = Object.fromEntries(['first_name_original', 'last_name_original', 'email', 'phone']
            .map(field => [field, requiredText(details.supplier_data[field], `supplier_${field}`)]));
    }
    if (payment.is_need_credit_card_data) {
        const token = details.card_token || {};
        const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
        if (!uuidPattern.test(token.init_uuid) || !uuidPattern.test(token.pay_uuid)) throw bookingError('credit_card_required');
        Object.assign(request.payment_type, { init_uuid: token.init_uuid, pay_uuid: token.pay_uuid });
    }
    if (payment.type === 'now') {
        const returnUrl = new URL(buildReturnPath());
        if (returnUrl.protocol !== 'https:' || returnUrl.username || returnUrl.password) throw bookingError('invalid_return_path');
        request.return_path = returnUrl.href;
    }
    if (details.upsell_data) {
        if (!Array.isArray(details.upsell_data) || details.upsell_data.length > 2) throw bookingError('invalid_upsell_data');
        const names = new Set();
        request.upsell_data = details.upsell_data.map(choice => {
            if (!['early_checkin', 'late_checkout'].includes(choice.name) || names.has(choice.name)
                || !collectUpsellOptions(form).some(option => option.name === choice.name && option.uid === choice.uid)) throw bookingError('invalid_upsell_uid');
            names.add(choice.name);
            return { name: choice.name, uid: choice.uid };
        });
    }
    if (details.arrival_datetime !== undefined) {
        if (typeof details.arrival_datetime !== 'string' || !Number.isFinite(Date.parse(details.arrival_datetime))) throw bookingError('invalid_arrival_datetime');
        request.arrival_datetime = details.arrival_datetime;
    }
    return request;
}

async function startBookingProcess(details, form) {
    const request = buildBookingFinish(details, form);
    try {
        const response = await client.bookingFinish(request);
        if (response.ok || transientBookingFailure(response) || response.error === 'double_booking_finish' || response.httpStatus === 429
            || response.status !== 'error' || typeof response.error !== 'string' || !response.error) {
            return { success: false, status: 'processing', retry_after_ms: retryAfterMs(response) };
        }
        return { success: false, status: 'failed', error: response.error || 'booking_finish_failed' };
    } catch (error) {
        if (transientBookingFailure(error)) return { success: false, status: 'processing', retry_after_ms: 5000 };
        throw error;
    }
}

async function checkBookingProcess(partnerOrderId, options = {}) {
    requiredText(partnerOrderId, 'partner_order_id');
    let response;
    try {
        response = await client.bookingFinishStatus({ partner_order_id: partnerOrderId }, options);
    } catch (error) {
        if (transientBookingFailure(error)) return { success: false, status: 'processing', retry_after_ms: 5000 };
        if (FINAL_STATUS_ERRORS.has(error.ratehawkError)) return { success: false, status: 'failed', error: error.ratehawkError };
        throw error;
    }
    if (transientBookingFailure(response) || response.httpStatus === 429) return { success: false, status: 'processing', retry_after_ms: retryAfterMs(response) };
    if (response.data?.partner_order_id && response.data.partner_order_id !== partnerOrderId) throw bookingError('booking_status_order_mismatch', 502);
    if (response.status === 'ok' && !response.error && response.httpStatus >= 200 && response.httpStatus < 300) return { success: true, status: 'confirmed' };
    if (response.status === '3ds' && !response.error && response.httpStatus >= 200 && response.httpStatus < 300 && response.data?.data_3ds) {
        const challenge = response.data.data_3ds;
        let actionUrl;
        try { actionUrl = new URL(challenge.action_url); }
        catch { throw bookingError('invalid_3ds_challenge', 502); }
        if (actionUrl.protocol !== 'https:' || actionUrl.username || actionUrl.password
            || !['get', 'post'].includes(challenge.method) || !challenge.data || typeof challenge.data !== 'object' || Array.isArray(challenge.data)
            || Object.values(challenge.data).some(value => typeof value !== 'string')) throw bookingError('invalid_3ds_challenge', 502);
        return { success: false, status: '3ds', data_3ds: { action_url: actionUrl.href, method: challenge.method, data: challenge.data } };
    }
    if (FINAL_STATUS_ERRORS.has(response.error)) return { success: false, status: 'failed', error: response.error };
    return { success: false, status: 'processing', retry_after_ms: 5000 };
}

/**
 * Poll booking/finish/status until confirmed, final error, or timeout.
 */
async function waitForBookingStatus(partnerOrderId, { maxWaitMs = BOOK_WAIT_MS, intervalMs = BOOK_POLL_INTERVAL_MS, now = Date.now, sleep = delay => new Promise(resolve => setTimeout(resolve, delay)) } = {}) {
    const deadline = now() + Math.max(1000, Number.isFinite(maxWaitMs) ? maxWaitMs : 90000);
    const finalCheckAt = deadline - 1000;
    while (true) {
        const checkedAt = now();
        const requestDeadline = checkedAt < finalCheckAt ? finalCheckAt : deadline;
        const result = await checkBookingProcess(partnerOrderId, { timeout: Math.max(1, Math.min(30000, requestDeadline - checkedAt)) });
        if (result.status !== 'processing') return result;
        if (checkedAt >= finalCheckAt || now() >= deadline) return { ...result, timed_out: true };
        const delay = Math.max(5000, Number.isFinite(intervalMs) ? intervalMs : 5000, result.retry_after_ms || 0);
        if (result.retry_after_ms > 5000 && now() + delay > finalCheckAt) return { ...result, timed_out: true };
        if (now() < finalCheckAt) await sleep(Math.min(delay, finalCheckAt - now()));
    }
}

/**
 * Full booking flow. `details` must include a prebooked `book_hash`
 * (or book_hash/hash/rateKey/roomId). Returns { success, hcn, order_id, ... }.
 */
async function bookHotel(details = {}) {
    const processes = require('./bookingProcessService');
    const process = await processes.createProcess({
        book_hash: details.book_hash || details.hash || details.rateKey || details.roomId,
        language: details.language,
        user_ip: details.user_ip,
        guests: details.guests
    }, details.idempotency_key);
    if (!['form_ready', 'card_ready', 'finishing', 'processing', '3ds', 'confirmed', 'failed'].includes(process.status)) return process;
    const result = await processes.finishProcess(process.process_id, details);
    return { ...result, ...(result.success ? { hcn: result.partner_order_id } : {}) };
}

// ---- Step 5: Post-booking ---------------------------------------------------
const ORDER_SORT_FIELDS = new Set(['cancelled_at', 'checkin_at', 'checkout_at', 'created_at', 'free_cancellation_before', 'modified_at', 'payment_due', 'payment_pending']);
const ORDER_DATE_FIELDS = new Set([...ORDER_SORT_FIELDS, 'paid_at']);
const ORDER_STATUSES = new Set(['cancelled', 'completed', 'failed', 'noshow', 'rejected']);
const ORDER_SOURCES = new Set(['b2b-site', 'b2b-api', 'b2b-card', 'b2b-handmade', 'b2b-mobile-app-andr', 'b2b-mobile-app-ios']);
const ORDER_LANGUAGES = new Set('ar bg cs da de el en es fi fr he hu it ja kk ko nl no pl pt pt_PT ro ru sk sq sr sv th tr uk vi zh_CN zh_TW'.split(' '));

function orderDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) throw bookingError('invalid_search_date');
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw bookingError('invalid_search_date');
    const time = Date.parse(value.length > 10 && !/Z|[+-]\d{2}:\d{2}$/.test(value) ? `${value}Z` : value);
    if (!Number.isFinite(time)) throw bookingError('invalid_search_date');
    return time;
}

function validateOrderObject(value, allowed, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.has(key))) throw bookingError(`invalid_${field}`);
}

async function retrieveBookings(options = {}) {
    validateOrderObject(options, new Set(['ordering', 'pagination', 'search', 'language']), 'order_request');
    const ordering = options.ordering === undefined ? { ordering_type: 'desc', ordering_by: 'created_at' } : options.ordering;
    const pagination = options.pagination === undefined ? { page_number: 1, page_size: 10 } : options.pagination;
    const search = options.search === undefined ? {} : options.search;
    const language = options.language === undefined ? 'en' : options.language;
    validateOrderObject(ordering, new Set(['ordering_type', 'ordering_by']), 'ordering');
    validateOrderObject(pagination, new Set(['page_number', 'page_size']), 'pagination');
    validateOrderObject(search, new Set([...ORDER_DATE_FIELDS, 'order_ids', 'partner_order_ids', 'status', 'source']), 'search');
    if (!['asc', 'desc'].includes(ordering.ordering_type) || !ORDER_SORT_FIELDS.has(ordering.ordering_by)) throw bookingError('invalid_ordering');
    if (!Number.isSafeInteger(pagination.page_number) || pagination.page_number < 1 || !Number.isInteger(pagination.page_size)
        || pagination.page_size < 1 || pagination.page_size > 50) throw bookingError('invalid_pagination');
    if (!ORDER_LANGUAGES.has(language)) throw bookingError('invalid_language');
    const filters = {};
    for (const [field, value] of Object.entries(search)) {
        if (ORDER_DATE_FIELDS.has(field)) {
            validateOrderObject(value, new Set(['from_date', 'to_date']), 'date_range');
            if (!Object.keys(value).length) throw bookingError('invalid_date_range');
            for (const date of Object.values(value)) orderDate(date);
            if (value.from_date && value.to_date && orderDate(value.from_date) > orderDate(value.to_date)) throw bookingError('invalid_date_range');
            filters[field] = { ...value };
        } else if (field === 'order_ids') {
            if (!Array.isArray(value) || !value.length || value.some(orderId => !Number.isSafeInteger(orderId) || orderId <= 0)) throw bookingError('invalid_order_ids');
            filters[field] = [...value];
        } else if (field === 'partner_order_ids') {
            if (!Array.isArray(value) || !value.length) throw bookingError('invalid_partner_order_ids');
            filters[field] = value.map(orderId => requiredText(orderId, 'partner_order_id'));
        } else {
            if (!(field === 'status' ? ORDER_STATUSES : ORDER_SOURCES).has(value)) throw bookingError(`invalid_${field}`);
            filters[field] = value;
        }
    }
    const response = await client.orderInfo({ ordering: { ...ordering }, pagination: { ...pagination }, search: filters, language });
    if (response.httpStatus === 429) throw Object.assign(bookingError('rate_limit', 429), { retry_after_ms: retryAfterMs(response) });
    if (!response.ok || response.httpStatus < 200 || response.httpStatus >= 300) {
        const code = typeof response.error === 'string' && /^[a-z_]+$/.test(response.error) ? response.error : 'order_info_unavailable';
        throw bookingError(code, code === 'page_out_of_range' ? 400 : 502);
    }
    const data = response.data;
    if (!data || !Array.isArray(data.orders) || data.orders.some(order => !order || typeof order !== 'object' || Array.isArray(order))) throw bookingError('invalid_order_info_response', 502);
    const result = { success: true, orders: data.orders };
    for (const field of ['current_page_number', 'total_orders', 'total_pages', 'found_orders', 'found_pages']) {
        if (!Number.isSafeInteger(data[field]) || data[field] < (field === 'current_page_number' ? 1 : 0)) throw bookingError('invalid_order_info_response', 502);
        result[field] = data[field];
    }
    if (result.current_page_number !== pagination.page_number || data.orders.length > pagination.page_size) throw bookingError('invalid_order_info_response', 502);
    if (filters.partner_order_ids && data.orders.some(order => !filters.partner_order_ids.includes(order.partner_data?.order_id))) throw bookingError('order_info_mismatch', 502);
    if (filters.order_ids && data.orders.some(order => !filters.order_ids.includes(order.order_id))) throw bookingError('order_info_mismatch', 502);
    return result;
}

function getHotelConfirmationNumber(order) {
    return order && (
        (order.hotel_data && order.hotel_data.order_id) ||
        order.hotel_confirmation_number ||
        (order.hotel_data && order.hotel_data.hotel_confirmation_number) ||
        (order.supplier_data && order.supplier_data.hotel_confirmation_number)
    ) || null;
}

async function getOrderInfo(partnerOrderId) {
    if (!partnerOrderId) return { success: false, error: 'missing_partner_order_id' };

    try {
        const orderId = requiredText(partnerOrderId, 'partner_order_id');
        const result = await retrieveBookings({
            ordering: { ordering_type: 'desc', ordering_by: 'created_at' },
            pagination: { page_number: 1, page_size: 10 },
            search: { partner_order_ids: [orderId] },
            language: 'en'
        });
        const order = result.orders[0] || null;
        if (result.orders.length > 1) throw bookingError('order_info_mismatch', 502);
        if (!order) {
            return {
                success: true,
                pending: true,
                found: 0,
                order: null,
                retry_after_ms: 60000
            };
        }

        const hotelConfirmationNumber = getHotelConfirmationNumber(order);
        const synced = hotelConfirmationNumber
            ? await syncBookingByPartnerOrderId(partnerOrderId, { hotelConfirmationNumber })
            : false;

        return {
            success: true,
            pending: false,
            found: result.found_orders,
            order,
            hotelConfirmationNumber,
            databaseUpdated: synced,
            status: order.status,
            isCancellable: order.is_cancellable,
            supplierReference: order.supplier_data && (order.supplier_data.confirmation_id || order.supplier_data.order_id),
            amountPayable: order.amount_payable,
            amountRefunded: order.amount_refunded,
            amountSell: order.amount_sell,
            cancellationInfo: order.cancellation_info,
            upsells: order.upsells
        };
    } catch (error) {
        const code = error.ratehawkError || error.code;
        if (code === 'order_not_found') return { success: true, pending: true, found: 0, order: null, retry_after_ms: 60000 };
        return { success: false, pending: false, error: typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : 'order_info_unavailable',
            httpStatus: [400, 429, 502].includes(error.httpStatus) ? error.httpStatus : 502,
            ...(Number.isFinite(error.retry_after_ms) ? { retry_after_ms: error.retry_after_ms } : {}) };
    }
}

const getOrderDetails = getOrderInfo;

// Backward-compatible name used by server.js
const fetchOrderDetails = (hcn) => getOrderDetails(hcn);

// ---- Webhook (Receive booking status webhook) ------------------------------
// ETG payload: { data: { partner_order_id, status }, signature: { signature, timestamp, token } }
// status is "completed" (=> confirmed) or "failed".
function parseWebhook(payload = {}) {
    const data = payload?.data || {};
    const partnerOrderId = typeof data.partner_order_id === 'string' && data.partner_order_id.length <= 256
        ? data.partner_order_id : null;
    const rawStatus = data.status;
    const confirmed = rawStatus === 'completed';
    const failed = rawStatus === 'failed';
    return { partnerOrderId, rawStatus, confirmed, failed };
}

// Verify the ETG webhook signature: HMAC-SHA256(timestamp + token) keyed with the API key.
function verifyWebhookSignature(payload = {}) {
    const apiKey = process.env.RATEHAWK_API_KEY;
    if (!apiKey) return { verified: false, reason: 'missing_api_key' };
    const signature = payload?.signature;
    if (!signature || !Number.isSafeInteger(signature.timestamp) || signature.timestamp <= 0
        || typeof signature.token !== 'string' || !signature.token || signature.token.length > 256
        || typeof signature.signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature.signature)) {
        return { verified: false, reason: 'invalid_signature' };
    }
    const expected = crypto.createHmac('sha256', apiKey)
        .update(`${signature.timestamp}${signature.token}`).digest();
    const verified = crypto.timingSafeEqual(expected, Buffer.from(signature.signature, 'hex'));
    return { verified, ...(verified ? {} : { reason: 'signature_mismatch' }) };
}

async function submitCancellation(partnerOrderId) {
    const orderId = requiredText(partnerOrderId, 'partner_order_id');
    const pending = { success: false, pending: true, status: 'cancel_pending' };
    try {
        const response = await client.cancelOrder({ partner_order_id: orderId });
        if (transientBookingFailure(response) || response.httpStatus === 429 || response.error === 'lock') return pending;
        if (response.ok && response.status === 'ok' && response.httpStatus >= 200 && response.httpStatus < 300) {
            const valid = value => value && typeof value.amount === 'string' && /^\d+(?:\.\d+)?$/.test(value.amount) && /^[A-Z]{3}$/.test(value.currency_code);
            if (!['amount_refunded', 'amount_payable', 'amount_sell'].every(field => valid(response.data?.[field]))) return pending;
            return {
                success: true, pending: false, status: 'cancelled', partner_order_id: orderId,
                amountRefunded: response.data.amount_refunded,
                amountPayable: response.data.amount_payable,
                amountSell: response.data.amount_sell
            };
        }
        if (response.status === 'error' && typeof response.error === 'string' && /^[a-z_]+$/.test(response.error)) {
            return { success: false, pending: false, status: 'cancel_failed', error: response.error };
        }
        return pending;
    } catch (error) {
        if (!transientBookingFailure(error) && typeof error.ratehawkError === 'string' && /^[a-z_]+$/.test(error.ratehawkError)) {
            return { success: false, pending: false, status: 'cancel_failed', error: error.ratehawkError };
        }
        return pending;
    }
}

async function cancelBooking(partnerOrderId, options = {}) {
    return require('./postBookingService').cancelBooking(partnerOrderId, options);
}

const cancelOrder = cancelBooking;

function contractObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function contractAmount(value) {
    return typeof value === 'string' ? /^-?\d+(?:\.\d+)?$/.test(value) : typeof value === 'number' && Number.isFinite(value);
}

async function retrieveContractData(operation, kind) {
    let response;
    try {
        response = await operation();
    } catch (error) {
        response = { error: error?.ratehawkError, httpStatus: error?.httpStatus || error?.response?.status };
    }
    if (response?.httpStatus === 429) throw Object.assign(bookingError('rate_limit', 429), { retry_after_ms: retryAfterMs(response) });
    if ([401, 403].includes(response?.httpStatus)
        || ['unauthorized', 'incorrect_credentials', 'no_auth_header', 'invalid_auth_header', 'not_allowed_host', 'api_access_disabled'].includes(response?.error)) {
        throw bookingError('supplier_unauthorized', 502);
    }
    if (response?.error === 'unknown') throw bookingError('supplier_unknown', 502);
    if (response?.ok !== true || response.status !== 'ok' || response.error != null
        || !Number.isInteger(response.httpStatus) || response.httpStatus < 200 || response.httpStatus >= 300) {
        throw bookingError(`${kind}_unavailable`, 502);
    }
    if (!contractObject(response.data)) throw bookingError(`invalid_${kind}_response`, 502);
    return response.data;
}

async function retrieveContract() {
    const data = await retrieveContractData(() => client.contractInfo(), 'contract');
    const textFields = ['active_from', 'agreement_date', 'agreement_number', 'closing_documents_issuance_type', 'kind'];
    const entityFields = ['address_actual', 'address_legal', 'name', 'taxpayer_id'];
    if (!Array.isArray(data.contract_datas) || data.contract_datas.some(contract => !contractObject(contract)
        || textFields.some(field => typeof contract[field] !== 'string') || !contract.agreement_number.trim()
        || (contract.terminated_at !== null && typeof contract.terminated_at !== 'string')
        || !contractObject(contract.legal_entity) || entityFields.some(field => typeof contract.legal_entity[field] !== 'string'))) {
        throw bookingError('invalid_contract_response', 502);
    }
    return { success: true, contract_datas: data.contract_datas };
}

async function retrieveFinancialDetails() {
    const data = await retrieveContractData(() => client.financialInfo(), 'financial_details');
    const commonAmounts = ['overdue_debt', 'unpaid_non_ref_orders_sum', 'unpaid_orders_sum', 'unpaid_ref_orders_sum'];
    const summaryAmounts = ['contract_overpay', 'credit_limit', 'deposit', 'max_booking_price', ...commonAmounts];
    const agreementAmounts = ['overpay', ...commonAmounts];
    if (!contractObject(data.contract) || summaryAmounts.some(field => !contractAmount(data.contract[field]))
        || typeof data.contract.reporting_currency !== 'string' || !/^[A-Z]{3}$/.test(data.contract.reporting_currency)
        || !Array.isArray(data.contract_datas) || data.contract_datas.some(contract => !contractObject(contract)
            || typeof contract.agreement_number !== 'string' || !contract.agreement_number.trim()
            || agreementAmounts.some(field => !contractAmount(contract[field])))) {
        throw bookingError('invalid_financial_details_response', 502);
    }
    return { success: true, contract: data.contract, contract_datas: data.contract_datas };
}

module.exports = {
    // low-level client (exposed for advanced use / testing)
    client,
    RATEHAWK_TEST_HOTEL_ID,
    buildReturnPath,
    normalizeUpsells,
    buildUpsellData,
    getApiOverview,
    retrieveContract,
    retrieveFinancialDetails,
    // Step 1 - static/content
    getHotelStatic,
    getSingleHotelInfo,
    getFilterValues,
    getHotelIdsByFilter,
    getHotelsContent,
    // Step 2 - search
    getAutocompleteSuggestions,
    searchLiveRates,
    searchLiveRatesByGeo,
    searchLiveRatesByRegion,
    getRegionHotelSort,
    getHotelPageRates,
    getRateDetailsByHash,
    searchAvailability,
    fetchHotelsInChunks,
    getHotelPage,
    getHotelPricing,
    fetchSingleHotelPage,
    // Step 3 - prebook
    prebookRate,
    validatePrebookRate,
    validateSerpPrebookRate,
    recheckHotel,
    // Step 4 - booking
    createBookingProcess,
    selectBookingPayment,
    createBookingCardToken,
    buildBookingFinish,
    startBookingProcess,
    checkBookingProcess,
    bookHotel,
    waitForBookingStatus,
    // Step 5 - post-booking
    retrieveBookings,
    getOrderInfo,
    getOrderDetails,
    fetchOrderDetails,
    submitCancellation,
    cancelOrder,
    cancelBooking,
    // Webhook helpers
    parseWebhook,
    verifyWebhookSignature
};
