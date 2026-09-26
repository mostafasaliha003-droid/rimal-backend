// Synchronize ETG hotel reviews for hotels already stored in MongoDB.

require('dotenv').config();

const mongoose = require('mongoose');
const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const Hotel = require('./models/Hotel');

const MONGO_URI = process.env.MONGO_URI;
const CHUNK_SIZE = 100;
const DELAY_MS = 1500;

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function toHotelHid(value) {
    const hid = Number(value);
    if (!Number.isInteger(hid) || hid < 0 || hid > 9999999999) return null;
    return hid;
}

function chunk(items, size) {
    const chunks = [];
    for (let offset = 0; offset < items.length; offset += size) {
        chunks.push(items.slice(offset, offset + size));
    }
    return chunks;
}

function getReviewOperations(records) {
    return records
        .filter(record => record && Array.isArray(record.reviews))
        .map(record => {
            const hid = toHotelHid(record.hid);
            if (hid === null) return null;
            return {
                updateOne: {
                    filter: { hid: String(hid) },
                    update: { $set: { reviews: record.reviews } },
                    upsert: false
                }
            };
        })
        .filter(Boolean);
}

async function loadHotelHids() {
    const hotels = await Hotel.find({ provider: 'ratehawk', hid: { $exists: true, $ne: null } })
        .select({ hid: 1, _id: 0 })
        .lean();
    return [...new Set(hotels.map(hotel => toHotelHid(hotel.hid)).filter(hid => hid !== null))];
}

async function syncHotelReviews() {
    if (!MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');

    await mongoose.connect(MONGO_URI);
    const stats = { hotels: 0, chunks: 0, reviewsUpdated: 0 };
    try {
        const hids = await loadHotelHids();
        stats.hotels = hids.length;
        logger.info('Starting ETG hotel review synchronization', {
            hotels: hids.length,
            chunkSize: CHUNK_SIZE,
            delayMs: DELAY_MS
        });

        for (const [index, ids] of chunk(hids, CHUNK_SIZE).entries()) {
            const records = await client.fetchHotelReviews(ids, 'en');
            const operations = getReviewOperations(records);
            if (operations.length) {
                const result = await Hotel.bulkWrite(operations, { ordered: false });
                stats.reviewsUpdated += result.modifiedCount || 0;
            }
            stats.chunks += 1;
            logger.info('Synchronized ETG hotel review chunk', {
                chunk: index + 1,
                processed: Math.min((index + 1) * CHUNK_SIZE, hids.length),
                total: hids.length,
                returned: records.length,
                updated: operations.length
            });
            if (index < Math.ceil(hids.length / CHUNK_SIZE) - 1) await sleep(DELAY_MS);
        }

        logger.info('ETG hotel review synchronization complete', stats);
        return stats;
    } finally {
        await mongoose.connection.close();
    }
}

if (require.main === module) {
    syncHotelReviews().catch(error => {
        logger.error('ETG hotel review synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = {
    CHUNK_SIZE,
    DELAY_MS,
    chunk,
    getReviewOperations,
    syncHotelReviews
};
