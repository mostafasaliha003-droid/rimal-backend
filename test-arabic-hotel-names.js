const { test } = require('node:test');
const assert = require('node:assert/strict');
const { arabicTranslation, syncArabicHotelNames } = require('./syncArabicHotelNames');
const { findHotelSuggestions } = require('./services/hotelSearchIndex');

const now = new Date('2026-11-20T10:00:00Z');

test('supplier Arabic names are stored as approved translations; Latin-only content is skipped', () => {
    assert.deepEqual(arabicTranslation({ name: 'أتلانتس ذا بالم', address: 'نخلة جميرا، دبي', region: { name: 'دبي' } }, now),
        { name: 'أتلانتس ذا بالم', address: 'نخلة جميرا، دبي', city: 'دبي', source: 'supplier', reviewStatus: 'approved', updatedAt: now });
    assert.equal(arabicTranslation({ name: 'Atlantis The Palm' }, now), null);
    assert.equal(arabicTranslation(null, now), null);
});

test('sync fetches Arabic content in batches of 100 and keeps editorial names', async () => {
    const hotels = Array.from({ length: 205 }, (_, i) => ({ hid: String(1000 + i) }));
    hotels[1].translations = { ar: { name: 'اسم محرر', source: 'editorial', reviewStatus: 'approved' } };
    const requests = [], writes = [];
    const model = { find: () => ({ select: () => ({ lean: () => ({ cursor: async function* () { yield* hotels; } }) }) }),
        bulkWrite: async ops => { writes.push(...ops); } };
    const client = { hotelContentByIds: async body => {
        requests.push(body);
        assert.equal(body.language, 'ar');
        return { ok: true, data: body.hids.map(hid => ({ hid, name: hid % 2 ? `فندق ${hid}` : `Hotel ${hid}` })) };
    } };
    const result = await syncArabicHotelNames({ model, client, connect: false, pauseMs: 0, now: () => now });
    assert.deepEqual(requests.map(body => body.hids.length), [100, 100, 5]);
    assert.equal(result.checked, 205);
    assert.ok(!writes.some(op => op.updateOne.filter.hid === '1001'), 'editorial Arabic name untouched');
    const written = writes.find(op => op.updateOne.filter.hid === '1003').updateOne.update.$set;
    assert.equal(written['translations.ar'].name, 'فندق 1003');
    assert.ok(written.translationSearchTokens.length > 0);
    assert.equal(result.named + result.withoutArabic, 204);
});

test('an Arabic query finds the hotel by its Arabic name despite hamza and alef spelling', async () => {
    const hotel = { hid: '7', hotelId: 'atlantis', name: 'Atlantis The Palm', city: 'Dubai',
        translations: { ar: { name: 'أتلانتس ذا بالم', city: 'دبي', source: 'supplier', reviewStatus: 'approved' } } };
    const Hotel = { find: () => ({ select: () => ({ limit: () => ({ maxTimeMS: () => ({ lean: async () => [hotel] }) }) }) }) };
    for (const query of ['اتلانتس', 'أتلانتس ذا', 'اتلانتس ذا بالم']) {
        const [match] = await findHotelSuggestions(query, { Hotel, language: 'ar' });
        assert.equal(match?.name, 'أتلانتس ذا بالم', query);
        assert.equal(match.resolvedLanguage, 'ar');
    }
});
