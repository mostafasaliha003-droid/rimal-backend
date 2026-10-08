const HotelbedsHotelContent = require('../models/HotelbedsVerifiedHotelContent');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { operationBudgetFor, validateSettings } = require('./hotelbedsRateLimiter');
const { configuredHotelbedsPilotCodes } = require('./hotelbedsPilotList');
const { normalizeLanguage, normalizeHotelContent } = require('./hotelbedsContentService');
const { safeRelativeImagePath, boundedText } = require('./hotelbedsContentPolicy');
const { contentConfigurationFrom } = require('./hotelbedsContentClient');

const MAX_IMPORT_HOTELS = 5;
const MAX_IMPORT_PAGES = 1;
const MAX_PAGE_SIZE = 1000;

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function positiveInteger(value, code, max) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail(code, 400);
    return value;
}

function validContentDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeRateCodeSet(value) {
    const codes = Array.isArray(value)
        ? value.map(code => Number.isSafeInteger(code) && code >= 0 && code <= 2147483647 ? String(code) : '')
        : typeof value === 'string' && value.trim() && value.trim().length <= 100
            ? value.trim().split(/\s+/) : null;
    if (!codes || codes.length > 50 || codes.some(code => !/^[A-Za-z0-9._-]{1,40}$/.test(code))
        || new Set(codes).size !== codes.length || codes.join(' ').length > 100) return null;
    return codes.join(' ');
}

function normalizeSupplierIdentifier(value, maxLength = 80) {
    if (Number.isSafeInteger(value) && value >= 0 && value <= 2147483647) return String(value);
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length <= maxLength && /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : null;
}

function assertRequestedContentLanguage(value, expectedLanguage) {
    if (!value || typeof value !== 'object' || value.languageCode === undefined) return;
    if (typeof value.languageCode !== 'string') {
        throw fail('hotelbeds_content_import_language_mismatch', 502);
    }
    let actualLanguage;
    try {
        actualLanguage = normalizeLanguage(value.languageCode);
    } catch {
        throw fail('hotelbeds_content_import_language_mismatch', 502);
    }
    if (actualLanguage !== expectedLanguage) {
        throw fail('hotelbeds_content_import_language_mismatch', 502);
    }
}

function contentImportPlan({ hotelCodes, language, from = 1, pageSize = 1000, pageLimit = 1,
    lastUpdateTime } = {}, env = process.env) {
    if (env.HOTELBEDS_CONTENT_IMPORT_ENABLED !== 'true' || env.HOTELBEDS_CONTENT_IMPORT_APPROVED !== 'true') {
        throw fail('hotelbeds_content_import_not_approved');
    }
    if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').toLowerCase() !== 'test') {
        throw fail('hotelbeds_content_import_test_only');
    }
    try {
        contentConfigurationFrom(env);
    } catch {
        throw fail('hotelbeds_content_import_configuration_invalid');
    }
    if (!Array.isArray(hotelCodes) || hotelCodes.length < 1 || hotelCodes.length > MAX_IMPORT_HOTELS) {
        throw fail('hotelbeds_content_import_hotel_codes_invalid', 400);
    }
    const allowedCodes = configuredHotelbedsPilotCodes(env);
    const codes = [...new Set(hotelCodes.map(value => {
        if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) {
            throw fail('hotelbeds_content_import_hotel_codes_invalid', 400);
        }
        return String(Number(value));
    }))];
    if (codes.length !== hotelCodes.length || codes.some(code => !allowedCodes.includes(code))) {
        throw fail('hotelbeds_content_import_hotel_not_approved', 403);
    }
    const normalizedLanguage = normalizeLanguage(language);
    if (normalizedLanguage !== normalizeLanguage(env.HOTELBEDS_PILOT_LANGUAGE)) {
        throw fail('hotelbeds_content_import_language_not_approved', 403);
    }
    positiveInteger(from, 'hotelbeds_content_import_from_invalid', 2147483647 - MAX_PAGE_SIZE);
    positiveInteger(pageSize, 'hotelbeds_content_import_page_size_invalid', MAX_PAGE_SIZE);
    positiveInteger(pageLimit, 'hotelbeds_content_import_page_limit_invalid', MAX_IMPORT_PAGES);
    if (lastUpdateTime !== undefined && !validContentDate(lastUpdateTime)) {
        throw fail('hotelbeds_content_import_last_update_invalid', 400);
    }
    if (pageSize * pageLimit < codes.length) throw fail('hotelbeds_content_import_page_capacity_insufficient', 400);
    const operationBudget = operationBudgetFor(env, 'contentsync');
    if (operationBudget === null) throw fail('hotelbeds_content_import_operation_budget_unconfigured');
    // Reserve one possible categories dictionary request before the sync starts.
    if (pageLimit + 1 > operationBudget) {
        throw fail('hotelbeds_content_import_operation_budget_exceeded', 429);
    }
    validateSettings({
        maxRequests: env.HOTELBEDS_RATE_MAX_REQUESTS,
        windowMs: env.HOTELBEDS_RATE_WINDOW_MS,
        dailyMaxRequests: env.HOTELBEDS_DAILY_MAX_REQUESTS,
        dailyWindowMs: env.HOTELBEDS_DAILY_WINDOW_MS,
        operation: 'contentsync',
        operationDailyMaxRequests: operationBudget
    });
    if (env.HOTELBEDS_MOCK_DATABASE_ENABLED !== 'true') {
        throw fail('hotelbeds_content_import_database_gate_disabled');
    }
    try {
        hotelbedsMockDatabase.assertDedicatedUri(
            env.HOTELBEDS_MOCK_MONGO_URI, env.MONGO_URI
        );
    } catch (error) {
        throw fail(error?.code || 'hotelbeds_content_import_database_configuration_invalid');
    }
    return Object.freeze({
        hotelCodes: codes.map(Number), language: normalizedLanguage, from, pageSize, pageLimit,
        maxRequests: pageLimit + 1, source: 'hotelbeds_content_api',
        ...(lastUpdateTime ? { lastUpdateTime } : {}),
        database: Object.freeze({
            status: 'isolated_target_validated_not_connected',
            name: 'configured_mock_database'
        })
    });
}

function contentImportPlanSummary(plan) {
    if (!plan || plan.source !== 'hotelbeds_content_api' || !Array.isArray(plan.hotelCodes)) {
        throw fail('hotelbeds_content_import_plan_invalid', 400);
    }
    return {
        status: 'plan_only_no_external_requests_or_database_writes',
        source: plan.source,
        hotelCount: plan.hotelCodes.length,
        language: plan.language,
        pageCount: plan.pageLimit,
        pageSize: plan.pageSize,
        maximumSupplierRequests: plan.maxRequests,
        operation: 'contentsync',
        isolatedDatabase: plan.database?.status === 'isolated_target_validated_not_connected'
            ? plan.database.status : 'not_validated'
    };
}

function normalizedImportRecord(record, plan, syncedAt, categoryDescriptions = new Map()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw fail('hotelbeds_content_import_record_invalid', 502);
    }
    const hotelCode = Number(record.code ?? record.hotelCode);
    if (!plan.hotelCodes.includes(hotelCode)) throw fail('hotelbeds_content_import_unapproved_record', 502);
    const language = normalizeLanguage(record.language || plan.language);
    if (language !== plan.language) throw fail('hotelbeds_content_import_language_mismatch', 502);
    for (const value of [record.name, record.address, record.city, record.country?.description,
        record.description, record.category?.description]) {
        assertRequestedContentLanguage(value, plan.language);
    }
    for (const facility of Array.isArray(record.facilities) ? record.facilities : []) {
        assertRequestedContentLanguage(facility?.description, plan.language);
    }
    for (const issue of Array.isArray(record.issues) ? record.issues : []) {
        assertRequestedContentLanguage(issue?.description, plan.language);
    }
    for (const image of Array.isArray(record.images) ? record.images : []) {
        assertRequestedContentLanguage(image?.type?.description, plan.language);
    }
    if (!Array.isArray(record.images) || !record.images.length || !Array.isArray(record.facilities)
        || !boundedText(record.description, 4000)) {
        throw fail('hotelbeds_content_import_incomplete_record', 502);
    }
    const categoryCode = record.category?.code ?? record.categoryCode;
    const categoryDescription = record.category?.description
        ?? categoryDescriptions.get(String(categoryCode ?? ''));
    const category = categoryCode || boundedText(categoryDescription, 100)
        ? {
            ...(record.category || {}),
            ...(categoryCode ? { code: String(categoryCode) } : {}),
            ...(categoryDescription ? { description: categoryDescription } : {})
        }
        : undefined;
    const address = record.address && typeof record.address === 'object' && !Array.isArray(record.address)
        ? {
            ...record.address,
            ...(boundedText(record.city, 150) ? { city: boundedText(record.city, 150) } : {}),
            ...(boundedText(record.country?.description, 150) || boundedText(record.countryCode, 20)
                ? { countryName: boundedText(record.country?.description, 150) || boundedText(record.countryCode, 20) }
                : {})
        }
        : record.address;
    const normalized = normalizeHotelContent({
        ...record,
        hotelCode,
        language,
        name: record.name,
        ...(category ? { category } : {}),
        address,
        phones: record.phones,
        phone: record.phone || record.phones?.[0]?.phoneNumber,
        sourceUpdatedAt: record.lastUpdate ?? record.sourceUpdatedAt
    }, { language, syncedAt, provenance: 'hotelbeds_content_api', requirePhone: false, requireCategory: false });
    const images = record.images.slice(0, 500).map((image, imageIndex) => {
        const path = safeRelativeImagePath(image?.path);
        const visualOrder = image?.visualOrder ?? image?.order ?? imageIndex;
        const order = image?.order;
        if (!path || !Number.isSafeInteger(visualOrder) || visualOrder < 0 || visualOrder > 10000
            || order !== undefined && (!Number.isSafeInteger(order) || order < 0 || order > 10000)) {
            throw fail('hotelbeds_content_import_image_invalid', 502);
        }
        return {
            path,
            visualOrder,
            ...(order === undefined ? {} : { order }),
            roomCode: boundedText(image.roomCode, 40) || '',
            roomType: boundedText(image.roomType, 40) || '',
            characteristicCode: boundedText(image.characteristicCode, 40) || '',
            type: { code: boundedText(image.type?.code, 20) || '', description: boundedText(image.type?.description, 100) || '' }
        };
    });
    const facilities = record.facilities.slice(0, 500).map(facility => {
        const description = boundedText(facility?.description, 300);
        if (!description || !Number.isSafeInteger(Number(facility.facilityCode))
            || !Number.isSafeInteger(Number(facility.facilityGroupCode))) {
            throw fail('hotelbeds_content_import_facility_invalid', 502);
        }
        return {
            facilityCode: Number(facility.facilityCode), facilityGroupCode: Number(facility.facilityGroupCode),
            description,
            ...(typeof facility.order === 'number' ? { order: facility.order } : {}),
            ...(typeof facility.indFee === 'boolean' ? { indFee: facility.indFee } : {}),
            ...(typeof facility.indYesOrNo === 'boolean' ? { indYesOrNo: facility.indYesOrNo } : {}),
            ...(typeof facility.indLogic === 'boolean' ? { indLogic: facility.indLogic } : {}),
            ...(facility.amount !== undefined ? { amount: facility.amount } : {}),
            ...(typeof facility.currency === 'string' ? { currency: facility.currency.toUpperCase() } : {}),
            ...(typeof facility.number === 'number' ? { number: facility.number } : {}),
            ...(typeof facility.voucher === 'boolean' ? { voucher: facility.voucher } : {}),
            ...(typeof facility.applicationType === 'string' ? { applicationType: facility.applicationType } : {})
        };
    });
    const description = boundedText(record.description, 4000);
    const issues = Array.isArray(record.issues) ? record.issues.slice(0, 100).map(issue => ({
        issueCode: boundedText(issue?.issueCode, 40), issueType: boundedText(issue?.issueType, 40),
        dateFrom: boundedText(issue?.dateFrom, 40), dateTo: boundedText(issue?.dateTo, 40),
        description: boundedText(issue?.description, 1000)
    })).filter(issue => issue.description) : [];
    return {
        ...normalized,
        contentStatus: 'complete',
        content: {
            name: normalized.name,
            ...(normalized.category ? { category: normalized.category } : {}),
            address: normalized.address,
            ...(normalized.phone ? { phone: normalized.phone } : {}),
            ...(description ? { description } : {}), images, facilities, issues, contentStatus: 'complete'
        }
    };
}

function createHotelbedsContentImportService({
    ContentModel = HotelbedsHotelContent,
    database = hotelbedsMockDatabase,
    env = process.env,
    now = () => new Date(),
    testOnly = false,
    ensureModelConnected: testEnsureModelConnected
} = {}) {
    if (testOnly && (typeof testEnsureModelConnected !== 'function' || process.env.NODE_ENV === 'production')
        || !testOnly && testEnsureModelConnected !== undefined) {
        throw new TypeError('hotelbeds_content_import_test_dependency_invalid');
    }
    async function importContent(options, { fetchPage, fetchCategories, fetchRateComments, commit } = {}) {
        if (fetchRateComments !== undefined) {
            throw fail('hotelbeds_content_import_rate_comments_separate_sync_required', 400);
        }
        const plan = contentImportPlan(options, env);
        if (typeof fetchPage !== 'function') throw fail('hotelbeds_content_import_adapter_required', 400);
        if (commit !== undefined && typeof commit !== 'function') {
            throw fail('hotelbeds_content_import_commit_adapter_invalid', 400);
        }
        if (!testOnly && !commit) {
            throw fail('hotelbeds_content_sync_coordinator_required', 409);
        }
        const syncedAt = new Date(now());
        if (!Number.isFinite(syncedAt.getTime())) throw fail('hotelbeds_content_import_clock_invalid', 503);
        const operationBudget = operationBudgetFor(env, 'contentsync');
        // Reserve one bounded dictionary request before making any supplier call.
        // It is used only when hotel records contain category codes but no
        // localized category descriptions.
        if (plan.pageLimit + 1 > operationBudget) {
            throw fail('hotelbeds_content_import_operation_budget_exceeded', 429);
        }

        const found = new Map();
        for (let pageIndex = 0; pageIndex < plan.pageLimit; pageIndex += 1) {
            const first = plan.from + pageIndex * plan.pageSize;
            const last = first + plan.pageSize - 1;
            const page = await fetchPage({
                language: plan.language,
                from: first,
                to: last,
                fields: 'all',
                codes: plan.hotelCodes,
                ...(plan.lastUpdateTime ? { lastUpdateTime: plan.lastUpdateTime } : {})
            });
            const hotels = Array.isArray(page?.hotels) ? page.hotels : page?.data?.hotels;
            if (!Array.isArray(hotels)) throw fail('hotelbeds_content_import_page_invalid', 502);
            for (const hotel of hotels) {
                const code = Number(hotel?.code ?? hotel?.hotelCode);
                if (!plan.hotelCodes.includes(code)) continue;
                if (found.has(code)) throw fail('hotelbeds_content_import_duplicate_hotel', 502);
                found.set(code, hotel);
            }
        }
        if (!plan.lastUpdateTime && plan.hotelCodes.some(code => !found.has(code))) {
            throw fail('hotelbeds_content_import_approved_hotel_missing', 502);
        }

        const rawRecords = [...found.values()];
        if (plan.lastUpdateTime && rawRecords.length === 0) {
            const result = {
                importedCount: 0,
                pageCount: plan.pageLimit,
                categoryRequestCount: 0,
                supplierRequests: plan.pageLimit,
                source: plan.source,
                writeResult: null
            };
            if (commit) await commit(async () => null);
            return result;
        }
        const categoryCodes = [...new Set(rawRecords.flatMap(record => {
            const code = record.category?.code ?? record.categoryCode;
            const description = record.category?.description;
            return code && !boundedText(description, 100) ? [String(code)] : [];
        }))];
        const categoryDescriptions = new Map();
        let categoryRequestCount = 0;
        if (categoryCodes.length) {
            if (typeof fetchCategories !== 'function') {
                throw fail('hotelbeds_content_import_categories_adapter_required', 400);
            }
            const response = await fetchCategories({
                language: plan.language,
                from: 1,
                to: categoryCodes.length,
                fields: 'all',
                codes: categoryCodes
            });
            const categories = Array.isArray(response?.categories) ? response.categories : response?.data?.categories;
            if (!Array.isArray(categories)) throw fail('hotelbeds_content_import_categories_invalid', 502);
            for (const category of categories) {
                const code = typeof category?.code === 'string' ? category.code.trim() : '';
                assertRequestedContentLanguage(category?.description, plan.language);
                const description = boundedText(category?.description, 100);
                if (!code || !categoryCodes.includes(code) || categoryDescriptions.has(code)) {
                    throw fail('hotelbeds_content_import_categories_invalid', 502);
                }
                if (description) categoryDescriptions.set(code, description);
            }
            categoryRequestCount = 1;
        }

        const records = rawRecords.map(record => normalizedImportRecord(record, plan, syncedAt, categoryDescriptions));
        for (const record of records) {
            const document = new ContentModel({
                hotelCode: record.hotelCode,
                language: record.language,
                source: record.source,
                content: record.content,
                sourceUpdatedAt: record.sourceUpdatedAt,
                syncedAt: record.syncedAt
            });
            const validationError = document.validateSync?.();
            if (validationError) throw validationError;
        }

        if (testOnly) {
            await testEnsureModelConnected(ContentModel);
        } else {
            await database.ensureModelConnected(ContentModel, { env, errorCode: 'hotelbeds_content_database_unavailable' });
        }

        const operations = records.map(record => ({ updateOne: {
            filter: { hotelCode: record.hotelCode, language: record.language, source: plan.source },
            update: { $set: {
                source: record.source, content: record.content,
                sourceUpdatedAt: record.sourceUpdatedAt, syncedAt: record.syncedAt
            }, $setOnInsert: { hotelCode: record.hotelCode, language: record.language } },
            upsert: true
        } }));
        const writeContent = async session => operations.length
            ? ContentModel.bulkWrite(operations, {
                ordered: true,
                ...(session ? { session } : {})
            })
            : null;
        const writeResult = commit
            ? await commit(writeContent)
            : await writeContent();

        return {
            importedCount: records.length,
            pageCount: plan.pageLimit,
            categoryRequestCount,
            supplierRequests: plan.pageLimit + categoryRequestCount,
            source: plan.source,
            writeResult
        };
    }
    return { importContent };
}

function normalizeRateCommentRecord(record, { hotelCode, language, source, syncedAt }) {
    const incoming = normalizeSupplierIdentifier(record?.incoming);
    const code = normalizeSupplierIdentifier(record?.code);
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || Number(record.hotel ?? record.hotelCode ?? hotelCode) !== hotelCode
        || normalizeLanguage(record.language || language) !== language
        || !incoming || !code
        || !Array.isArray(record.commentsByRates)) {
        throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
    }
    if (!record.commentsByRates.length) {
        throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
    }
    const issues = Array.isArray(record.issues) ? record.issues.slice(0, 100) : [];
    const facilities = Array.isArray(record.facilities) ? record.facilities.slice(0, 500) : [];
    return record.commentsByRates.map(group => {
        const rateCodes = normalizeRateCodeSet(group?.rateCodes);
        if (!rateCodes || !Array.isArray(group.comments)
            || group.comments.length === 0) {
            throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
        }
        const normalizedGroup = {
            rateCodes,
            comments: group.comments.map(comment => {
                if (!validContentDate(comment?.dateStart) || !validContentDate(comment?.dateEnd)
                    || comment.dateStart > comment.dateEnd || !boundedText(comment?.description, 2000)) {
                    throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
                }
                return { dateStart: comment.dateStart, dateEnd: comment.dateEnd,
                    description: boundedText(comment.description, 2000) };
            })
        };
        return {
            hotelCode, language, source, incoming, code, rateCodes: normalizedGroup.rateCodes,
            commentsByRates: [normalizedGroup], issues, facilities, syncedAt
        };
    });
}

module.exports = { MAX_IMPORT_HOTELS, MAX_IMPORT_PAGES, contentImportPlan, contentImportPlanSummary, normalizedImportRecord,
    normalizeRateCommentRecord, createHotelbedsContentImportService };