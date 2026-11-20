require('dotenv').config();

const mongoose = require('mongoose');
const Hotel = require('./models/Hotel');
const { hotelSearchTokens } = require('./services/hotelSearchIndex');
const logger = require('./services/loggerService');

// RateHawk Content accepts at most 100 hotels per request.
const BATCH_SIZE = 100;
const arabic = /\p{Script=Arabic}/u;

function text(value, max = 300) {
    return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
}

/**
 * Arabic hotel names for search. Supplier-provided names are inventory data, not
 * machine translations, so they are stored as approved and indexed immediately.
 * Hotels without an Arabic name keep their English name and Arabic transliteration search.
 */
function arabicTranslation(content, now) {
    const name = text(content?.name);
    if (!name || !arabic.test(name)) return null;
    const region = content.region && typeof content.region === 'object' ? content.region : {};
    return {
        name,
        ...(text(content.address) && arabic.test(content.address) ? { address: text(content.address) } : {}),
        ...(text(region.name, 120) && arabic.test(region.name) ? { city: text(region.name, 120) } : {}),
        source: 'supplier', reviewStatus: 'approved', updatedAt: now,
    };
}

async function syncArabicHotelNames({ model = Hotel, client = require('./services/ratehawkClient'),
    batchSize = BATCH_SIZE, now = () => new Date(), pauseMs = 250, connect = true, limit = Infinity } = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new TypeError('batchSize must be between 1 and 100');
    if (connect) {
        if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');
        await mongoose.connect(process.env.MONGO_URI);
    }
    const result = { checked: 0, named: 0, withoutArabic: 0, failedBatches: 0 };
    try {
        const cursor = model.find({ provider: 'ratehawk', hid: { $exists: true, $ne: null } })
            .select({ hid: 1, translations: 1 }).lean().cursor();
        let batch = [];
        const flush = async () => {
            if (!batch.length) return;
            const hotels = batch;
            batch = [];
            let response;
            try {
                response = await client.hotelContentByIds({ hids: hotels.map(hotel => Number(hotel.hid)), language: 'ar' });
            } catch (error) {
                result.failedBatches += 1;
                logger.warn('Arabic hotel content batch failed', { error: error.message, size: hotels.length });
                return;
            }
            if (!response?.ok || !Array.isArray(response.data)) {
                result.failedBatches += 1;
                logger.warn('Arabic hotel content batch rejected', { error: response?.error || 'invalid_response', size: hotels.length });
                return;
            }
            const byHid = new Map(response.data.map(content => [String(content?.hid ?? ''), content]));
            const writes = [];
            for (const hotel of hotels) {
                result.checked += 1;
                const translation = arabicTranslation(byHid.get(String(hotel.hid)), now());
                if (!translation) { result.withoutArabic += 1; continue; }
                const existing = hotel.translations instanceof Map ? Object.fromEntries(hotel.translations) : hotel.translations || {};
                // An editor's reviewed Arabic name always wins over supplier content.
                if (existing.ar?.source === 'editorial' && existing.ar.reviewStatus === 'approved') continue;
                const names = Object.entries({ ...existing, ar: translation })
                    .filter(([, value]) => value?.name && value.reviewStatus === 'approved').map(([, value]) => value.name);
                writes.push({ updateOne: { filter: { hid: String(hotel.hid), provider: 'ratehawk' }, update: { $set: {
                    'translations.ar': translation,
                    translationSearchTokens: [...new Set(names.flatMap(hotelSearchTokens))],
                } } } });
                result.named += 1;
            }
            if (writes.length) await model.bulkWrite(writes, { ordered: false });
            if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
        };
        for await (const hotel of cursor) {
            if (!/^\d+$/.test(String(hotel.hid || ''))) continue;
            batch.push(hotel);
            if (batch.length >= batchSize) await flush();
            if (result.checked + batch.length >= limit) break;
        }
        await flush();
        logger.info('Arabic hotel names synchronized', result);
        return result;
    } finally {
        if (connect) await mongoose.connection.close();
    }
}

if (require.main === module) {
    const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
    syncArabicHotelNames({ limit: limitArg ? Number(limitArg.slice(8)) : Infinity }).catch(error => {
        logger.error('Arabic hotel name synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = { BATCH_SIZE, arabicTranslation, syncArabicHotelNames };
