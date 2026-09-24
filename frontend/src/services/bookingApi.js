import axios from 'axios';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
    || (import.meta.env.PROD ? 'https://rimal-api.onrender.com/api' : '/api');
const secureKey = import.meta.env.VITE_REMAL_SECURE_KEY || 'rml_live_9f8b7c6d5e4a3b2c1d0e9f8a7b6c5d2e';

const api = axios.create({
    baseURL: apiBaseUrl,
    // RateHawk SERP searches can take up to the backend's configured
    // RATEHAWK_SERP_TIMEOUT_MS (60s by default), plus network overhead.
    timeout: 75000,
    headers: {
        'Content-Type': 'application/json',
        'x-api-key': secureKey
    }
});

const responseData = (response) => response.data;

/**
 * Search hotel and region suggestions for autocomplete.
 * @param {string} query - User-entered hotel or region text.
 * @param {string} [language='en'] - ETG response language.
 * @returns {Promise<object>} Suggestion response containing hotels and regions.
 */
export const suggest = async (query, language = 'en') =>
    responseData(await api.get('/search/suggest', { params: { query, language } }));

/**
 * Search live rates by a list of hotel IDs.
 * @param {object} searchData - Dates, hotel IDs, guests, and search options.
 * @returns {Promise<object>} SERP rates and hotel results.
 */
export const searchByIds = async (searchData) =>
    responseData(await api.post('/search/rates', searchData));

/**
 * Search live rates around geographic coordinates.
 * @param {object} geoData - Coordinates, dates, guests, radius, and search options.
 * @returns {Promise<object>} Geo SERP rates and hotel results.
 */
export const searchByGeo = async (geoData) =>
    responseData(await api.post('/search/rates/geo', geoData));

/**
 * Search live rates within an ETG region.
 * @param {object} regionData - Region ID, dates, guests, and search options.
 * @returns {Promise<object>} Region SERP rates and hotel results.
 */
export const searchByRegion = async (regionData) =>
    responseData(await api.post('/search/rates/region', regionData));

/**
 * Retrieve ETG's optimal hotel ranking for a region.
 * @param {number|string} regionId - ETG region ID.
 * @param {number} [limit=250] - Maximum number of hotel IDs to return.
 * @returns {Promise<object>} Sorted hotel ID response.
 */
export const sortRegionHotels = async (regionId, limit = 250) =>
    responseData(await api.get(`/search/sort/${encodeURIComponent(regionId)}`, { params: { limit } }));

/**
 * Retrieve full hotelpage rates for prebooking validation.
 * @param {object} hotelData - Hotel ID, dates, guests, and optional match hash.
 * @returns {Promise<object>} Hotelpage rates containing book hashes.
 */
export const getHotelPage = async (hotelData) =>
    responseData(await api.post('/search/hotelpage', hotelData));

/**
 * Retrieve static hotel content and live room rates for the details page.
 * @param {string|number} hid - RateHawk hotel identifier.
 * @param {object} searchData - Dates, guests, and search options.
 * @returns {Promise<{staticData: object, liveData: object}>}
 */
export const getHotelStatic = async (hid) =>
    responseData(await api.get(`/v1/hotels/${encodeURIComponent(hid)}`));

/**
 * Validate a hotel rate through the standard ETG prebook endpoint.
 * @param {string} hash - ETG book hash.
 * @param {number} [priceIncreasePercent=0] - Allowed price increase percentage.
 * @returns {Promise<object>} Prebook validation result.
 */
export const prebook = async (hash, priceIncreasePercent = 0) =>
    responseData(await api.post('/booking/prebook', {
        hash,
        price_increase_percent: priceIncreasePercent
    }));

/**
 * Validate a SERP-originated rate through the ETG SERP prebook endpoint.
 * @param {string} hash - ETG book hash from a SERP result.
 * @param {number} [priceIncreasePercent=0] - Allowed price increase percentage.
 * @returns {Promise<object>} SERP prebook validation result.
 */
export const prebookSerp = async (hash, priceIncreasePercent = 0) =>
    responseData(await api.post('/booking/prebook-serp', {
        hash,
        price_increase_percent: priceIncreasePercent
    }));

/**
 * Create a Ziina payment intent for a validated room selection.
 * @param {object} paymentData - Booking and guest details with the exact total.
 * @returns {Promise<object>} Ziina payment URL response.
 */
export const createZiinaIntent = async (paymentData, idempotencyKey) =>
    responseData(await api.post('/payment/ziina/intent', paymentData, { headers: { 'Idempotency-Key': idempotencyKey } }));

export const paymentAvailability = async () => responseData(await api.get('/payment/availability'));

export const getCheckoutStatus = async (reference, accessToken) =>
    responseData(await api.get(`/payment/ziina/${encodeURIComponent(reference)}/status`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    }));

/**
 * Look up rate details by ETG book hash.
 * @param {string} bookHash - ETG book hash to resolve.
 * @param {string} [language='en'] - ETG response language.
 * @returns {Promise<object>} Rate details containing hotels and original parameters.
 */
export const lookupRate = async (bookHash, language = 'en') =>
    responseData(await api.get(`/search/rate/${encodeURIComponent(bookHash)}`, {
        params: { language }
    }));

export { api };

export default {
    paymentAvailability,
    suggest,
    searchByIds,
    searchByGeo,
    searchByRegion,
    sortRegionHotels,
    getHotelPage,
    getHotelStatic,
    prebook,
    prebookSerp,
    createZiinaIntent,
    getCheckoutStatus,
    lookupRate
};
