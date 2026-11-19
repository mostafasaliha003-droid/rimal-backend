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
                            return { maxTimeMS() { return this; }, lean: async () => documents };
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

const { englishTravelQuery } = require('./shared/arabicTravelSearch');
const { findArabicRegionSuggestions } = require('./services/regionSuggestions');

test('Arabic query rewriting keeps distinctive words, digits and mixed scripts without inventing inventory IDs', () => {
    assert.equal(englishTravelQuery('فُنـْدُق هِيلتُون دُبَي'), 'Hilton Dubai');
    assert.equal(englishTravelQuery('فنادق في شرم الشيخ'), 'Sharm El Sheikh');
    assert.equal(englishTravelQuery('ماريوت Downtown دبي ٣'), 'Marriott Downtown Dubai 3');
    assert.equal(englishTravelQuery('أتلانتس بالم'), 'Atlantis Palm');
    assert.equal(englishTravelQuery('فندق سيلفا ٧'), 'silfa 7');
    assert.equal(englishTravelQuery('Paris'), null);
    assert.equal(englishTravelQuery('س'.repeat(161)), null);
});

test('Arabic hotel lookup ranks English catalogue rows even before optional translations or search tokens are backfilled', async () => {
    const hotels = [
        { hid: '200', name: 'Marriott Downtown', city: 'Dubai', searchAliases: [], translations: {} },
        { hid: '201', name: 'Marriott Downtown', city: 'London', searchAliases: [], translations: {} },
        { hid: '202', name: 'Downtown Gardens', city: 'Dubai', searchAliases: [], translations: {} },
    ];
    const results = await findHotelSuggestions('فندق ماريوت داون تاون دبي', { Hotel: fakeHotelModel(hotels), language: 'ar' });
    assert.deepEqual(results.map(result => result.hid), ['200']);
    assert.equal(results[0].name, 'Marriott Downtown');
    assert.equal(results[0].resolvedLanguage, 'en');
});

test('region lookup queries actual bilingual stored names, prefers an exact city and retains its supplier region and country', async () => {
    const data = [
        {id: 3, name: { ar:'دبي مارينا', en:'Dubai Marina' }, type:'Neighborhood', country_code:'AE'},
        {id: 1, name: { ar:'دبي', en:'Dubai' }, type:'City', country_code:'AE'},
        {id: 9, name: { en:'Dubai Creek' }, type:'Neighborhood', country_code:'AE'},
    ];
    const Region = { find(query) {
        const rows = data.filter(row=>query.$or.some(branch=>{
            const [key] = Object.keys(branch);return new RegExp(branch[key].$regex).test(row.name[key.slice(5)] || '');
        }));
        return {select(){return this;},limit(){return this;},maxTimeMS(){return this;},lean:async()=>rows};
    }};
    const regions = await findArabicRegionSuggestions('دُبـي', {Region,language:'ar'});
    assert.deepEqual(regions.map(region=>region.id), [1,3,9]);
    assert.equal(regions[0].name,'دبي');assert.equal(regions[0].country,'AE');
    assert.equal(regions[2].resolvedLanguage,'en');
    assert.deepEqual(await findArabicRegionSuggestions('باريس', {Region,language:'ar'}), []);
});

test('older English-only callers with Arabic input use the original Arabic supplier query before one English alternative', async context => {
    const client = require('./services/ratehawkClient');
    const { getAutocompleteSuggestions } = require('./services/ratehawkService');
    const calls=[];
    context.mock.method(client, 'suggestHotelAndRegion', async (query,language)=>{
        calls.push([query,language]);
        return language==='ar' ? {hotels:[],regions:null} : {hotels:[{hid:91,name:'Hilton Dubai'}],regions:[]};
    });
    const result = await getAutocompleteSuggestions('فُندق هيلـتون دبي','en','ar');
    assert.deepEqual(calls,[['فندق هيلتون دبي','ar'],['Hilton Dubai','en']]);
    assert.equal(result.arabicSearchHandled, true);
    assert.equal(result.hotels[0].hid,91);assert.equal(result.hotels[0].resolvedLanguage,'en');
});
