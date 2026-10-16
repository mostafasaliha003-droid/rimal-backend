const HotelbedsHotel = require('../models/HotelbedsHotel');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');

const MOCK_HOTEL_CONTENT = Object.freeze({
    900001: Object.freeze({
        hotelCode: 900001,
        language: 'ENG',
        name: 'Rimal Certification Mock Hotel',
        category: Object.freeze({ code: '4EST', name: '4 STARS' }),
        address: '100 Mock Palm Avenue, Dubai, United Arab Emirates',
        phone: '+971-4-555-0100',
        sourceUpdatedAt: new Date('2026-09-01T00:00:00.000Z')
    })
});

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function requiredText(value, code, maxLength) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw fail(code);
    }
    return value.trim();
}

function positiveHotelCode(value) {
    const hotelCode = Number(value);
    if (!Number.isSafeInteger(hotelCode) || hotelCode < 1) throw fail('hotelbeds_content_hotel_code_invalid');
    return hotelCode;
}

function normalizeLanguage(value = 'ENG') {
    const language = String(value).trim().toUpperCase();
    if (!/^[A-Z]{2,12}$/.test(language)) throw fail('hotelbeds_content_language_invalid');
    return language;
}

function normalizeCategory(value, { required = true } = {}) {
    const category = typeof value === 'string' ? { name: value } : value;
    if (!category || typeof category !== 'object' || Array.isArray(category)) {
        throw fail('hotelbeds_content_category_invalid');
    }
    const rawName = category.name ?? category.description ?? category.content;
    const name = typeof rawName === 'string' ? rawName : rawName?.content;
    const code = typeof category.code === 'string' ? category.code.trim().slice(0, 40) : '';
    if (!name && required) throw fail('hotelbeds_content_category_invalid');
    if (!name && !code) return null;
    return {
        code,
        ...(name ? { name: requiredText(name, 'hotelbeds_content_category_invalid', 100) } : {})
    };
}

function normalizeAddress(value) {
    if (typeof value === 'string') return requiredText(value, 'hotelbeds_content_address_invalid', 500);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw fail('hotelbeds_content_address_invalid');
    }
    const street = [value.street, value.number].filter(part => typeof part === 'string' && part.trim()).join(' ');
    const parts = [value.content || value.address || value.line1 || street, value.city,
        value.postalCode, value.countryName || value.country]
        .filter(part => typeof part === 'string' && part.trim());
    return requiredText(parts.join(', '), 'hotelbeds_content_address_invalid', 500);
}

function localizedText(value, code, maxLength) {
    const text = typeof value === 'string' ? value : value?.content;
    return requiredText(text, code, maxLength);
}

function categoryFromContent(source, { required = true } = {}) {
    if (source.category !== undefined && source.category !== null) {
        return normalizeCategory(source.category, { required });
    }
    if (source.category === null && !required) return null;
    const categoryName = source.categoryName ?? source.categoryDescription;
    const categoryCode = source.categoryCode;
    const name = typeof categoryName === 'string'
        ? categoryName
        : categoryName?.content ?? categoryName?.description ?? categoryName?.name;
    if (!name && categoryCode == null && !required) return null;
    return normalizeCategory({
        code: typeof categoryCode === 'string' ? categoryCode : '',
        name
    }, { required });
}

function phoneFromContent(source) {
    const direct = source.phone ?? source.phoneNumber;
    if (typeof direct === 'string') return direct;
    const phones = source.phones;
    if (Array.isArray(phones)) {
        const phone = phones.find(item => typeof item?.phoneNumber === 'string' && item.phoneNumber.trim());
        return phone?.phoneNumber || '';
    }
    if (phones && typeof phones === 'object') {
        const candidate = phones.phoneNumber ?? phones.phone;
        if (typeof candidate === 'string') return candidate;
    }
    return '';
}

function normalizeHotelContent(source, {
    language = 'ENG',
    syncedAt = new Date(),
    provenance = 'mock_fixture',
    requirePhone = true,
    requireCategory = true
} = {}) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw fail('hotelbeds_content_record_invalid');
    }
    const normalizedLanguage = normalizeLanguage(source.language || language);
    const code = positiveHotelCode(source.hotelCode ?? source.code);
    const name = localizedText(source.name, 'hotelbeds_content_name_invalid', 200);
    const category = categoryFromContent(source, { required: requireCategory });
    const address = normalizeAddress(source.address);
    const rawPhone = phoneFromContent(source);
    const phone = requirePhone ? requiredText(rawPhone, 'hotelbeds_content_phone_invalid', 80)
        : typeof rawPhone === 'string' && rawPhone.trim() ? rawPhone.trim().slice(0, 80) : null;
    const sourceUpdatedAt = source.sourceUpdatedAt == null ? undefined : new Date(source.sourceUpdatedAt);
    if (sourceUpdatedAt && Number.isNaN(sourceUpdatedAt.getTime())) {
        throw fail('hotelbeds_content_source_date_invalid');
    }
    const syncDate = new Date(syncedAt);
    if (Number.isNaN(syncDate.getTime())) throw fail('hotelbeds_content_sync_date_invalid');
    if (!['hotelbeds_content_api', 'mock_fixture'].includes(provenance)) {
        throw fail('hotelbeds_content_provenance_invalid');
    }

    return {
        hotelCode: code,
        language: normalizedLanguage,
        source: provenance,
        name,
        ...(category ? { category } : {}),
        address,
        ...(phone ? { phone } : {}),
        ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
        syncedAt: syncDate
    };
}

async function fetchMockHotelContent(hotelCode, language) {
    const fixture = MOCK_HOTEL_CONTENT[hotelCode];
    if (!fixture) throw fail('hotelbeds_mock_content_not_found', 404);
    return { ...fixture, category: { ...fixture.category }, language };
}

function createHotelbedsContentService({
    HotelModel = HotelbedsHotel,
    fetchContent = fetchMockHotelContent,
    now = () => new Date(),
    env = process.env,
    database = hotelbedsMockDatabase,
    testOnly = false,
    ensureModelConnected: testEnsureModelConnected
} = {}) {
    if (testOnly && (typeof testEnsureModelConnected !== 'function' || process.env.NODE_ENV === 'production')
        || !testOnly && testEnsureModelConnected !== undefined) {
        throw new TypeError('hotelbeds_content_test_dependency_invalid');
    }
    const ensureModelConnected = testOnly
        ? testEnsureModelConnected
        : database.ensureModelConnected.bind(database);
    async function syncMockHotels({ hotelCodes = [900001], language = 'ENG' } = {}) {
        if (!Array.isArray(hotelCodes)) throw fail('hotelbeds_content_hotel_codes_invalid');
        const normalizedLanguage = normalizeLanguage(language);
        const codes = [...new Set(hotelCodes.map(positiveHotelCode))];
        if (!codes.length) return { syncedCount: 0, hotels: [], writeResult: null };

        await ensureModelConnected(HotelModel, {
            env,
            errorCode: 'hotelbeds_content_database_unavailable'
        });

        const syncedAt = now();
        const hotels = await Promise.all(codes.map(async hotelCode => {
            const fetched = await fetchContent(hotelCode, normalizedLanguage);
            return normalizeHotelContent(fetched, { language: normalizedLanguage, syncedAt });
        }));

        const operations = hotels.map(hotel => {
            const { hotelCode, language: hotelLanguage, source, ...fields } = hotel;
            return {
                updateOne: {
                    filter: { hotelCode, language: hotelLanguage, contentSource: 'mock_fixture' },
                    update: { $set: { ...fields, contentSource: source }, $setOnInsert: { hotelCode, language: hotelLanguage } },
                    upsert: true
                }
            };
        });
        const writeResult = await HotelModel.bulkWrite(operations, { ordered: true });
        return { syncedCount: hotels.length, hotels, writeResult };
    }

    return { syncMockHotels };
}

const defaultService = createHotelbedsContentService();

module.exports = {
    normalizeLanguage,
    normalizeHotelContent,
    categoryFromContent,
    normalizeAddress,
    phoneFromContent,
    fetchMockHotelContent,
    createHotelbedsContentService,
    syncMockHotels: defaultService.syncMockHotels
};