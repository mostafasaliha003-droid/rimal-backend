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
        hotelConfirmationNumber: String
    });
    return mongoose.model('Booking', bookingSchema);
}

async function syncBookingByPartnerOrderId(partnerOrderId, update) {
    try {
        const Booking = getBookingModel();
        const booking = await Booking.findOne({
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
const BOOK_POLL_INTERVAL_MS = parseInt(process.env.RATEHAWK_BOOK_POLL_MS || '3000', 10);

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
    'soldout', 'book_limit', 'provider', 'order_not_found', 'booking_finish_did_not_succeed'
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
const getAutocompleteSuggestions = (query, language = 'en') => client.suggestHotelAndRegion(query, language);
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
function buildGuests(details) {
    if (Array.isArray(details.rooms) && details.rooms.length && details.rooms[0].guests) {
        return details.rooms.map(room => ({
            guests: room.guests.map(g => ({
                first_name: g.first_name || g.firstName || 'Guest',
                last_name: g.last_name || g.lastName || 'Traveler',
                is_child: !!g.is_child,
                ...(g.age !== undefined ? { age: g.age } : {})
            }))
        }));
    }
    // Fallback: single room, split a full name into first/last.
    const full = (details.guestName || details.customerName || 'Guest Traveler').trim().split(/\s+/);
    const first = full[0] || 'Guest';
    const last = full.slice(1).join(' ') || 'Traveler';
    return [{ guests: [{ first_name: first, last_name: last, is_child: false }] }];
}

/**
 * Poll booking/finish/status until confirmed, final error, or timeout.
 */
async function waitForBookingStatus(partnerOrderId, { maxWaitMs = BOOK_WAIT_MS, intervalMs = BOOK_POLL_INTERVAL_MS } = {}) {
    const deadline = Date.now() + maxWaitMs;
    let last = null;
    while (Date.now() < deadline) {
        const st = await client.bookingFinishStatus({ partner_order_id: partnerOrderId });
        last = st;
        if (st.status === 'ok') return { success: true, status: 'confirmed' };
        if (st.error && FINAL_STATUS_ERRORS.has(st.error)) return { success: false, status: st.error };
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return { success: false, status: 'processing', last };
}

/**
 * Full booking flow. `details` must include a prebooked `book_hash`
 * (or book_hash/hash/rateKey/roomId). Returns { success, hcn, order_id, ... }.
 */
async function bookHotel(details = {}) {
    const bookHash = details.book_hash || details.hash || details.rateKey || details.roomId;
    if (!bookHash) throw new Error('RateHawk bookHotel: missing book_hash');

    const language = details.language || 'en';
    const userIp = details.user_ip || '203.0.113.10';

    const newOrderId = () => 'RML-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    // Errors that require retrying the booking form with a NEW partner_order_id (ETG retry logic).
    // `lock` = a duplicate partner_order_id was sent too quickly -> retry with a fresh id.
    const RETRYABLE_FORM = new Set(['double_booking_form', 'duplicate_reservation', 'lock', 'unknown', 'timeout']);

    // 4a. Create booking process (booking form) — retry with a new partner_order_id on transient errors (max 5).
    let form = null;
    let partnerOrderId = details.partner_order_id || newOrderId();
    for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) partnerOrderId = newOrderId();
        try {
            form = await client.bookingForm({ book_hash: bookHash, language, partner_order_id: partnerOrderId, user_ip: userIp });
        } catch (e) {
            // The client throws for hard errors (invalid_params / fatal auth). Only retry
            // with a new partner_order_id for retryable/transient causes; surface the rest.
            if (e.ratehawkError && !RETRYABLE_FORM.has(e.ratehawkError)) throw e;
            logger.warn(`RateHawk booking/form transient (${e.message}); retrying with a new partner_order_id`);
            form = null;
            continue;
        }
        if (form.ok) break;
        if (RETRYABLE_FORM.has(form.error) && attempt < 4) {
            logger.warn(`RateHawk booking/form error "${form.error}"; retrying with a new partner_order_id`);
            continue;
        }
        break; // non-retryable error
    }
    if (!form || !form.ok) {
        const err = (form && form.error) || 'timeout';
        logger.error('RateHawk booking/form failed', { error: err });
        throw new Error(`Booking form failed: ${err}`);
    }
    const paymentType = (form.data.payment_types || [])[0];
    if (!paymentType) throw new Error('RateHawk booking/form returned no payment types');
    const upsellData = buildUpsellData(details, form.data);

    // 4b. Start booking process (booking finish)
    const finishReq = {
        language,
        partner: { partner_order_id: partnerOrderId },
        user: {
            email: details.email || details.holderEmail || 'guest@example.com',
            phone: details.phone || details.holderPhone || '+10000000000',
            comment: details.comment || ''
        },
        supplier_data: {
            first_name_original: details.firstName || (details.guestName || 'Guest').split(' ')[0] || 'Guest',
            last_name_original: details.lastName || (details.guestName || 'Guest Traveler').split(' ').slice(1).join(' ') || 'Traveler',
            email: details.email || details.holderEmail || 'guest@example.com',
            phone: details.phone || details.holderPhone || '+10000000000'
        },
        rooms: buildGuests(details),
        payment_type: { type: paymentType.type, amount: paymentType.amount, currency_code: paymentType.currency_code },
        ...(upsellData ? { upsell_data: upsellData } : {}),
        // Security Feature: Must be HTTPS and match the Host URL registered in RateHawk account settings.
        return_path: buildReturnPath()
    };
    const finish = await client.bookingFinish(finishReq);
    if (!finish.ok) {
        logger.error('RateHawk booking/finish failed', { error: finish.error });
        throw new Error(`Booking finish failed: ${finish.error || 'unknown'}`);
    }

    // 4c. Poll for the final status
    const result = await waitForBookingStatus(partnerOrderId);

    // 5. Best-effort order info for the supplier reference
    let supplierReference = '';
    try {
        const info = await getOrderDetails(partnerOrderId);
        supplierReference = info.supplierReference || '';
    } catch (e) { /* order data may sync with delay */ }

    return {
        success: result.success || result.status === 'processing',
        hcn: partnerOrderId,
        partner_order_id: partnerOrderId,
        order_id: form.data.order_id,
        status: result.status,
        supplierReference,
        amount: paymentType.amount,
        currency: paymentType.currency_code
    };
}

// ---- Step 5: Post-booking ---------------------------------------------------
function getHotelConfirmationNumber(order) {
    return order && (
        order.hotel_confirmation_number ||
        (order.hotel_data && order.hotel_data.hotel_confirmation_number) ||
        (order.supplier_data && order.supplier_data.hotel_confirmation_number)
    ) || null;
}

async function getOrderInfo(partnerOrderId) {
    if (!partnerOrderId) return { success: false, error: 'missing_partner_order_id' };

    try {
        const res = await client.orderInfo({
            ordering: { ordering_type: 'desc', ordering_by: 'created_at' },
            pagination: { page_number: 1, page_size: 10 },
            search: { partner_order_ids: [String(partnerOrderId)] },
            language: 'en'
        });

        // ETG synchronizes booking data asynchronously. An empty result is a
        // valid pending state, not an application error.
        if (!res.ok && res.error !== 'order_not_found') {
            return { success: false, pending: false, error: res.error || 'order_info_failed' };
        }

        const order = (res.data && res.data.orders && res.data.orders[0]) || null;
        if (!order) {
            return {
                success: true,
                pending: true,
                found: 0,
                order: null,
                error: res.error || null
            };
        }

        const hotelConfirmationNumber = getHotelConfirmationNumber(order);
        const synced = hotelConfirmationNumber
            ? await syncBookingByPartnerOrderId(partnerOrderId, { hotelConfirmationNumber })
            : false;

        return {
            success: true,
            pending: false,
            found: res.data.total_orders,
            order,
            hotelConfirmationNumber,
            databaseUpdated: synced,
            status: order.status,
            isCancellable: order.is_cancellable,
            supplierReference: order.supplier_data && (order.supplier_data.confirmation_id || order.supplier_data.order_id),
            amountPayable: order.amount_payable
        };
    } catch (error) {
        logger.error('RateHawk order info failed', { error: error.message, partnerOrderId });
        return { success: false, pending: false, error: error.message };
    }
}

const getOrderDetails = getOrderInfo;

// Backward-compatible name used by server.js
const fetchOrderDetails = (hcn) => getOrderDetails(hcn);

// ---- Webhook (Receive booking status webhook) ------------------------------
// ETG payload: { data: { partner_order_id, status }, signature: { signature, timestamp, token } }
// status is "completed" (=> confirmed) or "failed".
function parseWebhook(payload = {}) {
    const data = payload.data || payload;
    const partnerOrderId = data.partner_order_id || data.order_id || payload.partner_order_id || payload.hcn || null;
    const rawStatus = String(data.status || payload.status || '').toLowerCase();
    const confirmed = ['completed', 'confirmed', 'ok', 'success', 'confirmed_live'].includes(rawStatus);
    const failed = ['failed', 'error', 'soldout', 'provider', 'book_limit', 'cancelled', 'cancelled_by_hotel'].includes(rawStatus);
    return { partnerOrderId, rawStatus, confirmed, failed };
}

// Verify the ETG webhook signature: HMAC-SHA256(timestamp + token) keyed with the API key.
function verifyWebhookSignature(payload = {}) {
    try {
        const sig = payload.signature;
        if (!sig || !sig.signature || sig.timestamp === undefined || !sig.token) {
            return { verified: false, reason: 'missing_signature' };
        }
        const expected = crypto
            .createHmac('sha256', String(process.env.RATEHAWK_API_KEY || ''))
            .update(String(sig.timestamp) + String(sig.token))
            .digest('hex');
        return { verified: expected === sig.signature, expected };
    } catch (e) {
        return { verified: false, reason: e.message };
    }
}

async function cancelBooking(partnerOrderId, amountCommission = 0) {
    const res = await client.cancelOrder({ partner_order_id: String(partnerOrderId), amount_commission: amountCommission });
    if (!res.ok) return { success: false, status: res.error, error: res.error };
    return {
        success: true,
        status: 'CANCELLED',
        hcn: partnerOrderId,
        amountRefunded: res.data && res.data.amount_refunded,
        amountPayable: res.data && res.data.amount_payable
    };
}

async function cancelOrder(partnerOrderId) {
    if (!partnerOrderId) return { success: false, error: 'missing_partner_order_id' };

    try {
        const res = await client.cancelOrder({ partner_order_id: String(partnerOrderId) });
        if (!res.ok) return { success: false, error: res.error || 'cancel_failed' };

        const databaseUpdated = await syncBookingByPartnerOrderId(partnerOrderId, {
            status: 'canceled',
            supplierStatus: 'CANCELED'
        });
        return {
            success: true,
            status: 'canceled',
            partner_order_id: String(partnerOrderId),
            amountRefunded: res.data && res.data.amount_refunded,
            amountPayable: res.data && res.data.amount_payable,
            databaseUpdated
        };
    } catch (error) {
        logger.error('RateHawk order cancellation failed', { error: error.message, partnerOrderId });
        return { success: false, error: error.message };
    }
}

module.exports = {
    // low-level client (exposed for advanced use / testing)
    client,
    RATEHAWK_TEST_HOTEL_ID,
    buildReturnPath,
    normalizeUpsells,
    buildUpsellData,
    getApiOverview,
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
    searchAvailability,
    fetchHotelsInChunks,
    getHotelPage,
    getHotelPricing,
    fetchSingleHotelPage,
    // Step 3 - prebook
    prebookRate,
    recheckHotel,
    // Step 4 - booking
    bookHotel,
    waitForBookingStatus,
    // Step 5 - post-booking
    getOrderInfo,
    getOrderDetails,
    fetchOrderDetails,
    cancelOrder,
    cancelBooking,
    // Webhook helpers
    parseWebhook,
    verifyWebhookSignature
};
