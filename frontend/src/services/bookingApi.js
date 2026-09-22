import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
        ...(typeof import.meta !== 'undefined' && import.meta.env?.VITE_REMAL_SECURE_KEY
            ? { 'x-api-key': import.meta.env.VITE_REMAL_SECURE_KEY }
            : {})
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
    suggest,
    searchByIds,
    searchByGeo,
    searchByRegion,
    sortRegionHotels,
    getHotelPage,
    prebook,
    prebookSerp,
    lookupRate
};
