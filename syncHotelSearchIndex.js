require('dotenv').config();

const mongoose = require('mongoose');
const Hotel = require('./models/Hotel');
const { normalizeHotelSearchText, hotelSearchTokens } = require('./services/hotelSearchIndex');
const logger = require('./services/loggerService');

const BATCH_SIZE = 500;

async function syncHotelSearchIndex({ model = Hotel, batchSize = BATCH_SIZE } = {}) {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new TypeError('batchSize must be between 1 and 5000');

    await mongoose.connect(process.env.MONGO_URI);
    let pending = [];
    let indexed = 0;
    try {
        const cursor = model.find({ provider: 'ratehawk', hid: { $exists: true, $ne: null } })
            .select({ hid: 1, name: 1, translations: 1 }).lean().cursor();
        const flush = async () => {
            if (!pending.length) return;
            await model.bulkWrite(pending, { ordered: false });
            indexed += pending.length;
            pending = [];
        };
        for await (const hotel of cursor) {
            const hid = String(hotel.hid || '');
            const normalizedName = normalizeHotelSearchText(hotel.name || '');
            if (!/^\d+$/.test(hid)) continue;
            const translations = hotel.translations instanceof Map
                ? Object.fromEntries(hotel.translations)
                : hotel.translations || {};
            const translationSearchTokens = [...new Set(Object.values(translations)
                .filter(translation => translation?.reviewStatus === 'approved' && translation.name)
                .flatMap(translation => hotelSearchTokens(translation.name)))];
            pending.push({ updateOne: { filter: { hid, provider: 'ratehawk' }, update: { $set: {
                normalizedSupplierName: normalizedName,
                searchTokens: hotelSearchTokens(normalizedName),
                translationSearchTokens,
            } } } });
            if (pending.length >= batchSize) await flush();
        }
        await flush();
        await model.init();
        logger.info('Hotel local search index synchronized', { indexed });
        return { indexed };
    } finally {
        await mongoose.connection.close();
    }
}

if (require.main === module) {
    syncHotelSearchIndex().catch(error => {
        logger.error('Hotel local search index synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { BATCH_SIZE, syncHotelSearchIndex };