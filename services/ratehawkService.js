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

// How long bookHotel() will poll booking/finish/status before returning "processing".
const BOOK_WAIT_MS = parseInt(process.env.RATEHAWK_BOOK_WAIT_MS || '90000', 10);
const BOOK_POLL_INTERVAL_MS = parseInt(process.env.RATEHAWK_BOOK_POLL_MS || '3000', 10);

// Hotelpage enrichment during search. SERP only returns match_hash; a bookable
// book_hash requires a hotelpage (hp) call per hotel. hp is rate-limited
// (~10/min), so we only enrich the top N hotels of a region result.
const HP_LIMIT = parseInt(process.env.RATEHAWK_HP_LIMIT || '8', 10);
const HP_CONCURRENCY = parseInt(process.env.RATEHAWK_HP_CONCURRENCY || '3', 10);

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

// Run async tasks with bounded concurrency.
async function mapWithConcurrency(items, limit, worker) {
    const out = [];
    let i = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await worker(items[idx], idx);
        }
    });
    await Promise.all(runners);
    return out;
}

function rateToAED(rate) {
    const pt = rate && rate.payment_options && rate.payment_options.payment_types && rate.payment_options.payment_types[0];
    const amount = parseFloat((pt && pt.amount) || rate.price || 0);
    const currency = (pt && pt.currency_code) || rate.currency || 'USD';
    return mappingService.convertToAED(amount, currency);
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
const getFilterValues = () => client.filterValues();
const getHotelIdsByFilter = (data) => client.hotelIdsByFilter(data);

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
        // region search: accept a numeric region_id, a numeric destinationCode,
        // or a free-text destination name (resolved via multicomplete).
        let regionId = Number(rawParams.region_id) || Number(rawParams.destinationCode) || null;
        if (!regionId) {
            regionId = await resolveRegionId(rawParams.destination || rawParams.destinationName || rawParams.query || rawParams.destinationCode, params.language);
        }
        if (!regionId) {
            logger.warn('RateHawk search skipped: could not resolve a region (region_id / destination)');
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

    // 2b. Hotelpage step — SERP rates only carry match_hash; a bookable book_hash
    // requires hp per hotel. Enrich the top N hotels so returned rooms are bookable.
    const enrichCount = Math.min(HP_LIMIT, serpHotels.length);
    const targets = serpHotels.slice(0, enrichCount);

    const hpResults = await mapWithConcurrency(targets, HP_CONCURRENCY, async (h) => {
        try {
            const page = await client.hotelPage({ ...params, hid: h.hid });
            const hotel = page.ok && page.data && page.data.hotels && page.data.hotels[0];
            const rates = (hotel && hotel.rates) || [];
            return { hid: h.hid, id: h.id, rates: rates.length ? rates : (h.rates || []) };
        } catch (e) {
            return { hid: h.hid, id: h.id, rates: h.rates || [] };
        }
    });

    // Hydrate static content (name / image / stars / lat / lng) from our local
    // MongoDB Hotel cache (populated by syncRatehawkHotels.js). SERP/HP return only
    // IDs + live pricing, so static data is blended in from our synced collection.
    let dbMap = {};
    try {
        const Hotel = getHotelModel();
        const idList = hpResults.map(h => h.id).filter(Boolean);
        const docs = await Hotel.find({ hotelId: { $in: idList } }).lean();
        docs.forEach(d => { dbMap[d.hotelId] = d; });
        logger.info(`RateHawk search: hydrated ${docs.length}/${idList.length} hotels from local DB cache`);
    } catch (e) {
        logger.warn('RateHawk DB hydration skipped', { error: e.message });
    }

    return hpResults.map(h => {
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
            rates: h.rates || [],
            provider: 'ratehawk'
        };
    });
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
async function getOrderDetails(partnerOrderId) {
    const res = await client.orderInfo({
        ordering: { ordering_type: 'desc', ordering_by: 'created_at' },
        pagination: { page_number: 1, page_size: 10 },
        search: { partner_order_ids: [String(partnerOrderId)] },
        language: 'en'
    });
    if (!res.ok) return { success: false, error: res.error };
    const order = (res.data && res.data.orders && res.data.orders[0]) || null;
    return {
        success: !!order,
        found: res.data && res.data.total_orders,
        order,
        status: order && order.status,
        isCancellable: order && order.is_cancellable,
        supplierReference: order && order.supplier_data && (order.supplier_data.confirmation_id || order.supplier_data.order_id),
        amountPayable: order && order.amount_payable
    };
}

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

module.exports = {
    // low-level client (exposed for advanced use / testing)
    client,
    RATEHAWK_TEST_HOTEL_ID,
    buildReturnPath,
    getApiOverview,
    // Step 1 - static/content
    getHotelStatic,
    getFilterValues,
    getHotelIdsByFilter,
    getHotelsContent,
    // Step 2 - search
    searchAvailability,
    fetchHotelsInChunks,
    getHotelPage,
    fetchSingleHotelPage,
    // Step 3 - prebook
    prebookRate,
    recheckHotel,
    // Step 4 - booking
    bookHotel,
    waitForBookingStatus,
    // Step 5 - post-booking
    getOrderDetails,
    fetchOrderDetails,
    cancelBooking,
    // Webhook helpers
    parseWebhook,
    verifyWebhookSignature
};
