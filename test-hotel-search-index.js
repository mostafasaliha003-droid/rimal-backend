const { test } = require('node:test');
const assert = require('node:assert/strict');
const Hotel = require('./models/Hotel');
const { normalizeHotelSearchText, hotelSearchTokens, findHotelSuggestions, buildSearchAlias } = require('./services/hotelSearchIndex');
const { toStaticOperation } = require('./services/hotelDumpSyncService');
const { toHotelOperation } = require('./syncFilteredHotels');
const { toHotelOperation: toDumpHotelOperation } = require('./syncHotelDump');

const hilton = {
    hid: '8473727',
    hotelId: 'ratehawk-hilton-dubai',
    provider: 'ratehawk',
    name: 'Hilton Dubai',
    normalizedSupplierName: normalizeHotelSearchText('Hilton Dubai'),
    searchTokens: hotelSearchTokens('Hilton Dubai'),
    translations: { ar: { name: 'هيلتون دبي', reviewStatus: 'approved' } },
    searchAliases: [{
        value: 'هيلتون دبي', normalized: normalizeHotelSearchText('هيلتون دبي'),
        language: 'ar', source: 'editorial', reviewStatus: 'approved'
    }]
};

function fakeHotelModel(documents) {
    return {
        find(filter) {
            assert.equal(filter.provider, 'ratehawk');
            assert.ok(Array.isArray(filter.$or));
            return {
                select(projection) {
                    assert.ok(projection.translations);
                    return {
                        limit(count) {
                            assert.equal(count, 500);
                            return { lean: async () => documents };
                        }
                    };
                }
            };
        }
    };
}

test('normalization joins Arabic and Latin Hilton spellings and keeps typo-search tokens', () => {
    assert.equal(normalizeHotelSearchText('هيلتون'), normalizeHotelSearchText('Hilton'));
    assert.equal(normalizeHotelSearchText('HÍLTON'), normalizeHotelSearchText('Hilton'));
    assert.ok(hotelSearchTokens('Hilton Dubai').includes('ilt'));
    assert.equal(normalizeHotelSearchText('  '), '');
});

test('Arabic, Latin and common typo suggestions resolve to the same stable ten-digit HID', async () => {
    for (const query of ['هيلتون', 'Hilton', 'Hiltn']) {
        const [suggestion] = await findHotelSuggestions(query, { Hotel: fakeHotelModel([hilton]), language: 'ar' });
        assert.equal(suggestion.hid, '8473727');
        assert.equal(suggestion.hotel_id, '8473727');
        assert.equal(suggestion.name, 'هيلتون دبي');
        assert.equal(suggestion.resolvedLanguage, 'ar');
    }
});

test('only approved translations and editorial aliases are returned; unreviewed aliases cannot match', async () => {
    assert.deepEqual(await findHotelSuggestions('Hiltn', {
        Hotel: fakeHotelModel([{ ...hilton, searchAliases: [{
            value: 'Hilton', normalized: 'hiltun', reviewStatus: 'pending'
        }], name: 'Grand Plaza', normalizedSupplierName: normalizeHotelSearchText('Grand Plaza'),
        searchTokens: hotelSearchTokens('Grand Plaza'), translations: {} }]), language: 'es'
    }), []);
    assert.equal(buildSearchAlias('Hilton', { language: 'en', reviewStatus: 'approved' }).normalized, 'hiltun');
    assert.throws(() => buildSearchAlias('', {}), /alias/);
    assert.throws(() => buildSearchAlias('Hilton', { language: 'fr' }), /language/);
});

test('supplier content upserts retain editorial fields and populate only supplier-owned search data', () => {
    for (const operation of [
        toStaticOperation({ hid: 123, id: 'supplier-123', name: 'Hilton' }),
        toDumpHotelOperation({ hid: 123, id: 'supplier-123', name: 'Hilton' }),
        toHotelOperation({ hid: 123, id: 'supplier-123', name: 'Hilton' })
    ]) {
        const update = operation.updateOne.update.$set;
        assert.equal(update.normalizedSupplierName, 'hiltun');
        assert.deepEqual(update.searchTokens, hotelSearchTokens('Hilton'));
        assert.equal(Object.hasOwn(update, 'translations'), false);
        assert.equal(Object.hasOwn(update, 'searchAliases'), false);
    }
    assert.ok(Hotel.schema.path('translations'));
    assert.ok(Hotel.schema.path('searchAliases'));
});