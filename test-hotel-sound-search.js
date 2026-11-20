const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hotelSoundKeys, findHotelSuggestions } = require('./services/hotelSearchIndex');
const { backfillHotelSoundKeys } = require('./services/hotelSoundKeyBackfill');
const { toStaticOperation } = require('./services/hotelDumpSyncService');

const NAMES = [
    'Atlantis The Palm', 'Al Seef Heritage Hotel Dubai', 'Crowne Plaza Dubai Deira', 'Kempinski Hotel Mall of the Emirates',
    'The St. Regis Downtown Dubai', 'Novotel Dubai Al Barsha', 'Qasr Al Sarab Desert Resort by Anantara', 'Sofitel Dubai The Palm',
    'Movenpick Hotel Jumeirah Beach', 'Hotel Indigo Dubai Downtown', 'Raffles The Palm Dubai', 'Jumeirah Beach Hotel',
];
const hotels = NAMES.map((name, index) => ({ hid: String(1000 + index), name, soundKeys: hotelSoundKeys(name) }));

// Applies the sound-key branch the way MongoDB would: any stored key matching any anchored regex.
function soundModel(documents) {
    return {
        find(filter) {
            const branch = filter.$or.find(entry => entry.soundKeys);
            const matches = branch ? documents.filter(hotel => hotel.soundKeys.some(key => branch.soundKeys.$in.some(regex => regex.test(key)))) : [];
            return { select: () => ({ limit: () => ({ maxTimeMS() { return this; }, lean: async () => matches }) }) };
        },
    };
}

test('Arabic spellings of supplier names find the hotel without an Arabic translation', async () => {
    const cases = {
        'أتلانتس ذا بالم': 'Atlantis The Palm', 'فندق السيف': 'Al Seef Heritage Hotel Dubai', 'كراون بلازا ديرة': 'Crowne Plaza Dubai Deira',
        'كمبينسكي مول الإمارات': 'Kempinski Hotel Mall of the Emirates', 'سانت ريجيس داون تاون': 'The St. Regis Downtown Dubai',
        'نوفوتيل البرشاء': 'Novotel Dubai Al Barsha', 'قصر السراب': 'Qasr Al Sarab Desert Resort by Anantara', 'سوفيتيل ذا بالم': 'Sofitel Dubai The Palm',
        'موفنبيك': 'Movenpick Hotel Jumeirah Beach', 'فندق انديجو': 'Hotel Indigo Dubai Downtown', 'رافلز': 'Raffles The Palm Dubai',
    };
    for (const [query, name] of Object.entries(cases)) {
        const [first] = await findHotelSuggestions(query, { Hotel: soundModel(hotels), language: 'ar' });
        assert.equal(first?.name, name, query);
        assert.equal(first.resolvedLanguage, 'en');
    }
});

test('sound keys stay specific: unrelated names and Latin queries do not use them', async () => {
    assert.deepEqual(await findHotelSuggestions('روتانا', { Hotel: soundModel(hotels), language: 'ar' }), []);
    const latin = { find(filter) { assert.ok(!filter.$or.some(entry => entry.soundKeys)); return soundModel([]).find({ $or: [] }); } };
    assert.deepEqual(await findHotelSuggestions('Atlantis', { Hotel: latin }), []);
    assert.deepEqual(hotelSoundKeys('Atlantis The Palm'), ['tlntstblm', 'tblm', 'blm']);
    assert.deepEqual(hotelSoundKeys(''), []);
});

test('content imports store sound keys with the supplier name', () => {
    const operation = toStaticOperation({ hid: 7, id: 'atlantis', name: 'Atlantis The Palm', region: {} });
    assert.deepEqual(operation.updateOne.update.$set.soundKeys, ['tlntstblm', 'tblm', 'blm']);
});

test('backfill fills only hotels without keys, in batches, and marks empty names done', async () => {
    const writes = [];
    const pending = [{ _id: 'a', name: 'Atlantis The Palm' }, { _id: 'b', name: '' }, { _id: 'c', name: 'Raffles' }];
    let filter;
    const model = {
        find(value) {
            filter = value;
            const query = { select: () => query, lean: () => query, batchSize: () => query,
                cursor: () => ({ async *[Symbol.asyncIterator]() { yield* pending; }, close: async () => {} }) };
            return query;
        },
        bulkWrite: async operations => { writes.push(operations); },
    };
    const result = await backfillHotelSoundKeys({ model, batchSize: 2, pauseMs: 0, logger: {} });
    assert.deepEqual(filter, { provider: 'ratehawk', soundKeys: { $exists: false } });
    assert.equal(result.indexed, 3);
    assert.deepEqual(writes.map(batch => batch.length), [2, 1]);
    assert.deepEqual(writes[0][1].updateOne, { filter: { _id: 'b' }, update: { $set: { soundKeys: [] } } });
    assert.deepEqual(writes[1][0].updateOne.update.$set.soundKeys, ['rfls']);
});
