// Synchronize filtered ETG hotel IDs and rich static content into MongoDB.

require('dotenv').config();

const mongoose = require('mongoose');
const client = require('./services/ratehawkClient');
const ratehawkService = require('./services/ratehawkService');
const logger = require('./services/loggerService');
const { normalizeSupplierImage } = require('./services/supplierImages');

const hotelSchema = new mongoose.Schema({
    hid: { type: String, required: true, index: true },
    hotelId: { type: String, required: true, unique: true },
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'ratehawk' },
    staticData: mongoose.Schema.Types.Mixed
});
const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', hotelSchema);

const MONGO_URI = process.env.MONGO_URI;
const CHUNK_SIZE = 100;
const DELAY_MS = Math.max(1000, Number(process.env.RATEHAWK_CONTENT_DELAY_MS || 1500));

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getOptionValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseList(value, field, parseItem) {
    if (value === undefined || value === '') return undefined;
    let values;
    try {
        values = String(value).trim().startsWith('[')
            ? JSON.parse(value)
            : String(value).split(',').map(item => item.trim()).filter(Boolean);
    } catch (error) {
        throw new Error(`${field} must be a comma-separated list or JSON array`);
    }
    if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
    try {
        return values.map(parseItem);
    } catch (error) {
        throw new Error(`${field} contains an invalid value`);
    }
}

function getSyncFilters() {
    const rawFilters = process.env.RATEHAWK_FILTERS_JSON || getOptionValue('--filters');
    let filters = {};
    if (rawFilters) {
        try {
            filters = JSON.parse(rawFilters);
        } catch (error) {
            throw new Error('--filters must be valid JSON');
        }
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
            throw new Error('--filters must be a JSON object');
        }
    }

    const country = parseList(process.env.RATEHAWK_FILTER_COUNTRY || getOptionValue('--country'), 'country', value => {
        const number = Number(value);
        if (!Number.isInteger(number)) throw new Error('not an integer');
        return number;
    });
    const starRating = parseList(process.env.RATEHAWK_FILTER_STAR_RATING || getOptionValue('--star_rating'), 'star_rating', value => {
        const number = Number(value);
        if (!Number.isInteger(number)) throw new Error('not an integer');
        return number;
    });
    const kind = parseList(process.env.RATEHAWK_FILTER_KIND || getOptionValue('--kind'), 'kind', String);
    const serpFilter = parseList(process.env.RATEHAWK_FILTER_SERP_FILTER || getOptionValue('--serp_filter'), 'serp_filter', String);
    if (country !== undefined) filters.country = country;
    if (starRating !== undefined) filters.star_rating = starRating;
    if (kind !== undefined) filters.kind = kind;
    if (serpFilter !== undefined) filters.serp_filter = serpFilter;

    const positional = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
    const updatedSince = process.env.RATEHAWK_UPDATED_SINCE
        || getOptionValue('--updated_since')
        || positional;
    if (updatedSince !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(updatedSince)) {
            throw new Error('updated_since must use YYYY-MM-DD HH:MM:SS');
        }
        filters.updated_since = updatedSince;
    }
    return filters;
}

function validateSelectedFilters(filters, available) {
    for (const key of ['country', 'kind', 'star_rating', 'serp_filter']) {
        if (!filters[key]) continue;
        if (!Array.isArray(available?.[key])) throw new Error(`ETG ${key} filter values are unavailable`);
        const choices = new Set(available[key].map(item => String(item && typeof item === 'object' ? item.value : item)));
        if (filters[key].some(value => !choices.has(String(value)))) {
            throw new Error(`ETG ${key} filter includes a value not returned by filter_values`);
        }
    }
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
}

function extractHotelIds(payload) {
    const data = payload && payload.data !== undefined ? payload.data : payload;
    const candidates = [data && data.hids, data && data.hotel_ids, data && data.ids, data && data.hotelIds];
    const source = candidates.find(Array.isArray) || (Array.isArray(data) ? data : []);
    const ids = source
        .map(item => item && typeof item === 'object' ? (item.hid || item.hotel_id || item.id) : item)
        .filter(value => value !== undefined && value !== null && value !== '')
        .map(value => Number(value));
    if (ids.some(value => !Number.isInteger(value) || value < 0 || value > 9999999999)) {
        throw new Error('ETG hotel IDs must be at most ten-digit integers');
    }
    return ids;
}

function extractHotels(payload) {
    const data = payload && payload.data !== undefined ? payload.data : payload;
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['hotels', 'hotel_content', 'hotelContent', 'items']) {
        if (data[key]) return asArray(data[key]);
    }
    return Object.values(data).filter(item => item && typeof item === 'object' && (item.hid || item.hotel_id || item.id));
}

function pickImage(hotel) {
    const image = (hotel.images && hotel.images[0])
        || (hotel.images_ext && hotel.images_ext[0] && (hotel.images_ext[0].url || hotel.images_ext[0]))
        || '';
    return normalizeSupplierImage(image);
}

function toHotelOperation(hotel) {
    if (!hotel || typeof hotel !== 'object') return null;
    const hid = hotel.hid;
    if (!Number.isInteger(hid) || hid < 0 || hid > 9999999999) {
        throw new Error('ETG hotel content missing valid numeric hid');
    }
    const region = hotel.region || {};
    const hotelId = hotel.id || hotel.hotel_id || hid;
    return {
        updateOne: {
            filter: { hid: String(hid) },
            update: {
                $set: {
                    hid: String(hid),
                    hotelId: String(hotelId),
                    name: hotel.name || '',
                    address: hotel.address || '',
                    city: hotel.city || region.name || '',
                    countryCode: hotel.country_code || region.country_code || '',
                    stars: String(hotel.star_rating != null ? hotel.star_rating : ''),
                    latitude: String(hotel.latitude != null ? hotel.latitude : ''),
                    longitude: String(hotel.longitude != null ? hotel.longitude : ''),
                    image: pickImage(hotel),
                    provider: 'ratehawk',
                    staticData: hotel
                }
            },
            upsert: true
        }
    };
}

async function fetchHotelIds(filters) {
    return (await client.fetchHotelIdsByFilter(filters)).map(value => {
        const hid = Number(value);
        if (!Number.isInteger(hid) || hid < 0 || hid > 9999999999) {
            throw new Error('ETG hotel IDs must be at most ten-digit integers');
        }
        return hid;
    });
}

async function fetchHotelContent(ids) {
    const response = await client.hotelContent({ hids: ids });
    if (!response.ok) throw new Error(response.error || 'ETG hotel content request failed');
    if (!Array.isArray(response.data)) throw new Error('ETG hotel content response must contain a data array');
    return extractHotels(response.data);
}

async function syncFilteredHotels() {
    if (!MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');

    const filters = getSyncFilters();
    if (!Object.keys(filters).length && process.env.RATEHAWK_CONTENT_FULL_SYNC !== 'true') {
        throw new Error('Unfiltered Content full sync requires RATEHAWK_CONTENT_FULL_SYNC=true');
    }
    client.normalizeHotelIdFilters(filters);
    logger.info('Starting ETG filtered hotel content synchronization', {
        filters: Object.keys(filters).length ? filters : 'all hotels',
        chunkSize: CHUNK_SIZE,
        delayMs: DELAY_MS
    });

    const filterResult = await ratehawkService.getFilterValues({ forceRefresh: true });
    validateSelectedFilters(filters, filterResult.filters);
    const ids = await fetchHotelIds(filters);
    logger.info('Fetched ETG hotel IDs', { count: ids.length, filters });
    if (!ids.length) return { ids: 0, chunks: 0, upserted: 0, modified: 0, skipped: 0 };

    await mongoose.connect(MONGO_URI);
    const stats = { ids: ids.length, chunks: 0, content: 0, upserted: 0, modified: 0, skipped: 0 };
    try {
        for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
            const chunk = ids.slice(offset, offset + CHUNK_SIZE);
            const content = await fetchHotelContent(chunk);
            const operations = content.map(toHotelOperation).filter(Boolean);
            stats.content += content.length;
            stats.skipped += content.length - operations.length;
            if (operations.length) {
                const result = await Hotel.bulkWrite(operations, { ordered: false });
                stats.upserted += result.upsertedCount || 0;
                stats.modified += result.modifiedCount || 0;
            }
            stats.chunks += 1;
            logger.info('Synchronized ETG hotel content chunk', {
                chunk: stats.chunks,
                processed: Math.min(offset + chunk.length, ids.length),
                total: ids.length,
                returned: content.length,
                upserted: stats.upserted,
                modified: stats.modified
            });
            if (offset + CHUNK_SIZE < ids.length) await sleep(DELAY_MS);
        }
        logger.info('ETG filtered hotel content synchronization complete', stats);
        return stats;
    } finally {
        await mongoose.connection.close();
    }
}

if (require.main === module) {
    syncFilteredHotels().catch(error => {
        logger.error('ETG filtered hotel content synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = {
    CHUNK_SIZE,
    DELAY_MS,
    getSyncFilters,
    extractHotelIds,
    extractHotels,
    toHotelOperation,
    syncFilteredHotels
};
