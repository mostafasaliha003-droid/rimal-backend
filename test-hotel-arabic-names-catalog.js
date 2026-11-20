const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EDITOR, readCatalog, applyArabicNameCatalog, reportHotelsWithoutArabicNames } = require('./services/hotelArabicNames');
const catalogFile = require('./data/hotel-arabic-names.json');

function model(hotels) {
    const state = { writes: [], filter: null };
    return {
        state,
        find(filter) {
            state.filter = filter;
            const query = { select: () => query, sort: () => query, limit: () => query, lean: async () => hotels };
            return query;
        },
        bulkWrite: async operations => { state.writes.push(...operations); },
    };
}

test('the shipped catalog is valid: numeric hids, Arabic names and a source for each', () => {
    assert.doesNotThrow(() => readCatalog(catalogFile));
    assert.throws(() => readCatalog({ 12: { name: 'Atlantis', source: 'x' } }), /Invalid/);
    assert.throws(() => readCatalog({ 12: { name: 'أتلانتس' } }), /Invalid/);
    assert.throws(() => readCatalog({ abc: { name: 'أتلانتس', source: 'x' } }), /Invalid/);
});

test('catalog names become approved Arabic names, without replacing an editor\'s own name', async () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const hotels = model([
        { _id: 1, hid: '10', translations: {} },
        { _id: 2, hid: '11', translations: { ar: { name: 'اسم المحرر', source: 'editorial', reviewStatus: 'approved', editor: 'mona' } } },
        { _id: 3, hid: '12', translations: { ar: { name: 'فندق قديم', source: 'editorial', reviewStatus: 'approved', editor: EDITOR } } },
        { _id: 4, hid: '13', translations: { ar: { name: 'ريكسوس', source: 'editorial', reviewStatus: 'approved', editor: EDITOR } } },
    ]);
    const result = await applyArabicNameCatalog({ model: hotels, now: () => now, logger: {}, entries: {
        10: { name: 'أتلانتس ذا بالم', city: 'دبي', source: 'https://www.atlantis.com/ar' },
        11: { name: 'اسم آخر', source: 'x' },
        12: { name: 'فندق جديد', source: 'x' },
        13: { name: 'ريكسوس', source: 'x' },
        99: { name: 'غير موجود', source: 'x' },
    } });
    assert.deepEqual(result, { applied: 2, unchanged: 1, kept: 1, missing: 1 });
    assert.deepEqual(hotels.state.filter.hid.$in.sort(), ['10', '11', '12', '13', '99']);
    const [first, second] = hotels.state.writes;
    assert.deepEqual(first.updateOne.filter, { _id: 1 });
    assert.deepEqual(first.updateOne.update.$set['translations.ar'],
        { name: 'أتلانتس ذا بالم', city: 'دبي', source: 'editorial', reviewStatus: 'approved', editor: EDITOR, updatedAt: now });
    assert.ok(first.updateOne.update.$set.translationSearchTokens.length > 0);
    assert.equal(second.updateOne.update.$set['translations.ar'].name, 'فندق جديد');
});

test('the report lists hotels without an approved Arabic name in capped, parseable lines', async () => {
    const lines = [];
    const hotels = model([{ hid: '1', name: 'A|B', city: 'Dubai' }, { hid: '2', name: 'C', city: null }, { hid: '3', name: 'D', city: 'Doha' }]);
    assert.equal(await reportHotelsWithoutArabicNames({ model: hotels, perLine: 2, print: line => lines.push(line) }), 3);
    assert.deepEqual(hotels.state.filter['translations.ar.reviewStatus'], { $ne: 'approved' });
    assert.deepEqual(lines, ['[arabic-name-report 1-2/3] 1|A B|Dubai ;; 2|C|', '[arabic-name-report 3-3/3] 3|D|Doha']);
});
