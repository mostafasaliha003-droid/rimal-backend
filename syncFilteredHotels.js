// Synchronize filtered ETG hotel IDs and rich static content into MongoDB.

require('dotenv').config();

const mongoose = require('mongoose');
const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');

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
const CHUNK_SIZE = clamp(Number(process.env.RATEHAWK_CONTENT_CHUNK_SIZE || 200), 100, 250);
const DELAY_MS = Math.max(1000, Number(process.env.RATEHAWK_CONTENT_DELAY_MS || 1500));

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getUpdatedSince() {
    const argument = process.argv.slice(2).find(value => !value.startsWith('--'));
    const flagIndex = process.argv.indexOf('--updated_since');
    const flagValue = flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
    const value = process.env.RATEHAWK_UPDATED_SINCE || flagValue || argument || '';
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        throw new Error('updated_since must use YYYY-MM-DD HH:MM:SS');
    }
    return value;
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
    return source
        .map(item => item && typeof item === 'object' ? (item.hid || item.hotel_id || item.id) : item)
        .filter(value => value !== undefined && value !== null && value !== '')
        .map(value => String(value));
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
    return typeof image === 'string' ? image.replace('{size}', '1024x768') : '';
}

function toHotelOperation(hotel) {
    if (!hotel || typeof hotel !== 'object') return null;
    const hid = hotel.hid || hotel.hotel_id || hotel.id;
    if (hid === undefined || hid === null || hid === '') return null;
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

async function fetchHotelIds(updatedSince) {
    const response = await client.hotelIds(updatedSince ? { updated_since: updatedSince } : {});
    if (!response.ok) throw new Error(response.error || 'ETG hotel IDs request failed');
    return extractHotelIds(response.data);
}

async function fetchHotelContent(ids) {
    const response = await client.hotelContent({ hids: ids });
    if (!response.ok) throw new Error(response.error || 'ETG hotel content request failed');
    return extractHotels(response.data);
}

async function syncFilteredHotels() {
    if (!MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');

    const updatedSince = getUpdatedSince();
    logger.info('Starting ETG filtered hotel content synchronization', {
        updatedSince: updatedSince || 'all hotels',
        chunkSize: CHUNK_SIZE,
        delayMs: DELAY_MS
    });

    const ids = await fetchHotelIds(updatedSince);
    logger.info('Fetched ETG hotel IDs', { count: ids.length, updatedSince: updatedSince || null });
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
    extractHotelIds,
    extractHotels,
    toHotelOperation,
    syncFilteredHotels
};
