const { hotelSoundKeys } = require('./hotelSearchIndex');

/**
 * Gives every RateHawk hotel its Arabic-search sound keys. Runs inside the API
 * process so existing inventory is covered without a separate job; it only
 * touches hotels that have none yet, in small batches, and is safe to repeat.
 */
async function backfillHotelSoundKeys({ model, batchSize = 500, pauseMs = 100, logger = console, shouldStop = () => false } = {}) {
    if (!model || typeof model.find !== 'function') throw new TypeError('A Hotel model is required');
    const result = { indexed: 0 };
    const cursor = model.find({ provider: 'ratehawk', soundKeys: { $exists: false } })
        .select({ _id: 1, name: 1 }).lean().batchSize(batchSize).cursor();
    let pending = [];
    const flush = async () => {
        if (!pending.length) return;
        await model.bulkWrite(pending, { ordered: false });
        result.indexed += pending.length;
        pending = [];
        if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
    };
    try {
        for await (const hotel of cursor) {
            if (shouldStop()) break;
            // An empty list marks the hotel as done, so names without consonants are not revisited.
            pending.push({ updateOne: { filter: { _id: hotel._id }, update: { $set: { soundKeys: hotelSoundKeys(hotel.name || '') } } } });
            if (pending.length >= batchSize) await flush();
        }
        await flush();
    } finally {
        await cursor.close?.();
    }
    if (result.indexed) logger.info?.('Hotel sound keys backfilled', result);
    return result;
}

// Runs shortly after start-up and then every few hours for hotels added by content imports.
function startHotelSoundKeyBackfill({ model, logger = console, delayMs = 30000, everyMs = 6 * 60 * 60 * 1000 } = {}) {
    let stopped = false, running = false;
    const run = async () => {
        if (stopped || running) return;
        running = true;
        try {
            await backfillHotelSoundKeys({ model, logger, shouldStop: () => stopped });
        } catch (error) {
            logger.warn?.('Hotel sound key backfill failed', { error: error.message });
        } finally {
            running = false;
        }
    };
    const first = setTimeout(run, delayMs);
    const repeat = setInterval(run, everyMs);
    first.unref?.();
    repeat.unref?.();
    return () => { stopped = true; clearTimeout(first); clearInterval(repeat); };
}

module.exports = { backfillHotelSoundKeys, startHotelSoundKeyBackfill };
