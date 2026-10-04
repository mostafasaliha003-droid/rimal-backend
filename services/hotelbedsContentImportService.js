const HotelbedsHotelContent = require('../models/HotelbedsVerifiedHotelContent');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { operationBudgetFor } = require('./hotelbedsRateLimiter');
const { configuredHotelbedsPilotCodes } = require('./hotelbedsPilotList');
const { normalizeLanguage, normalizeHotelContent } = require('./hotelbedsContentService');
const { safeRelativeImagePath, boundedText } = require('./hotelbedsContentPolicy');

const MAX_IMPORT_HOTELS = 5;
const MAX_IMPORT_PAGES = 5;
const MAX_PAGE_SIZE = 1000;

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function positiveInteger(value, code, max) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail(code, 400);
    return value;
}

function contentImportPlan({ hotelCodes, language, from = 1, pageSize = 1000, pageLimit = 1 } = {}, env = process.env) {
    if (env.HOTELBEDS_CONTENT_IMPORT_ENABLED !== 'true' || env.HOTELBEDS_CONTENT_IMPORT_APPROVED !== 'true') {
        throw fail('hotelbeds_content_import_not_approved');
    }
    if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').toLowerCase() !== 'test') {
        throw fail('hotelbeds_content_import_test_only');
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
    positiveInteger(from, 'hotelbeds_content_import_from_invalid', Number.MAX_SAFE_INTEGER - MAX_PAGE_SIZE);
    positiveInteger(pageSize, 'hotelbeds_content_import_page_size_invalid', MAX_PAGE_SIZE);
    positiveInteger(pageLimit, 'hotelbeds_content_import_page_limit_invalid', MAX_IMPORT_PAGES);
    if (pageSize * pageLimit < codes.length) throw fail('hotelbeds_content_import_page_capacity_insufficient', 400);
    const operationBudget = operationBudgetFor(env, 'contentsync');
    if (operationBudget === null) throw fail('hotelbeds_content_import_operation_budget_unconfigured');
    if (pageLimit > operationBudget) {
        throw fail('hotelbeds_content_import_operation_budget_exceeded', 429);
    }
    return Object.freeze({
        hotelCodes: codes.map(Number), language: normalizedLanguage, from, pageSize, pageLimit,
        maxRequests: pageLimit, source: 'hotelbeds_content_api'
    });
}

function normalizedImportRecord(record, plan, syncedAt) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw fail('hotelbeds_content_import_record_invalid', 502);
    }
    const hotelCode = Number(record.code ?? record.hotelCode);
    if (!plan.hotelCodes.includes(hotelCode)) throw fail('hotelbeds_content_import_unapproved_record', 502);
    const language = normalizeLanguage(record.language || plan.language);
    if (language !== plan.language) throw fail('hotelbeds_content_import_language_mismatch', 502);
    if (!Array.isArray(record.images) || !record.images.length || !Array.isArray(record.facilities)
        || !boundedText(record.description, 4000)) {
        throw fail('hotelbeds_content_import_incomplete_record', 502);
    }
    const normalized = normalizeHotelContent({
        ...record,
        hotelCode,
        language,
        name: record.name,
        category: record.category,
        address: record.address,
        phones: record.phones,
        phone: record.phone || record.phones?.[0]?.phoneNumber,
        sourceUpdatedAt: record.lastUpdate ?? record.sourceUpdatedAt
    }, { language, syncedAt, provenance: 'hotelbeds_content_api', requirePhone: false });
    const images = record.images.slice(0, 500).map(image => {
        const path = safeRelativeImagePath(image?.path);
        const visualOrder = image?.visualOrder;
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
            name: normalized.name, category: normalized.category, address: normalized.address, phone: normalized.phone,
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
    async function importContent(options, { fetchPage, fetchRateComments } = {}) {
        const plan = contentImportPlan(options, env);
        if (typeof fetchPage !== 'function') throw fail('hotelbeds_content_import_adapter_required', 400);
        if (testOnly) await testEnsureModelConnected(ContentModel);
        else await database.ensureModelConnected(ContentModel, { env, errorCode: 'hotelbeds_content_database_unavailable' });
        const syncedAt = new Date(now());
        if (!Number.isFinite(syncedAt.getTime())) throw fail('hotelbeds_content_import_clock_invalid', 503);
        const commentsRequested = typeof fetchRateComments === 'function';
        const rateCommentRequestCount = commentsRequested ? plan.hotelCodes.length : 0;
        const operationBudget = operationBudgetFor(env, 'contentsync');
        if (plan.pageLimit + rateCommentRequestCount > operationBudget) {
            throw fail('hotelbeds_content_import_operation_budget_exceeded', 429);
        }

        const found = new Map();
        for (let pageIndex = 0; pageIndex < plan.pageLimit; pageIndex += 1) {
            const first = plan.from + pageIndex * plan.pageSize;
            const last = first + plan.pageSize - 1;
            const page = await fetchPage({ language: plan.language, from: first, to: last, fields: 'all' });
            const hotels = Array.isArray(page?.hotels) ? page.hotels : page?.data?.hotels;
            if (!Array.isArray(hotels)) throw fail('hotelbeds_content_import_page_invalid', 502);
            for (const hotel of hotels) {
                const code = Number(hotel?.code ?? hotel?.hotelCode);
                if (!plan.hotelCodes.includes(code)) continue;
                if (found.has(code)) throw fail('hotelbeds_content_import_duplicate_hotel', 502);
                found.set(code, normalizedImportRecord(hotel, plan, syncedAt));
            }
        }
        if (plan.hotelCodes.some(code => !found.has(code))) throw fail('hotelbeds_content_import_approved_hotel_missing', 502);

        const records = [...found.values()];
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
        const operations = records.map(record => ({ updateOne: {
            filter: { hotelCode: record.hotelCode, language: record.language, source: plan.source },
            update: { $set: {
                source: record.source, content: record.content,
                sourceUpdatedAt: record.sourceUpdatedAt, syncedAt: record.syncedAt
            }, $setOnInsert: { hotelCode: record.hotelCode, language: record.language } },
            upsert: true
        } }));
        const writeResult = await ContentModel.bulkWrite(operations, { ordered: true });
        let rateCommentWriteResult = null;
        if (fetchRateComments !== undefined) {
            if (typeof fetchRateComments !== 'function') throw fail('hotelbeds_rate_comment_import_adapter_required', 400);
            const rateCommentRecords = [];
            for (const hotelCode of plan.hotelCodes) {
                const response = await fetchRateComments({ hotelCode, language: plan.language });
                const entries = Array.isArray(response) ? response : response?.rateComments;
                if (!Array.isArray(entries)) throw fail('hotelbeds_rate_comment_import_response_invalid', 502);
                for (const entry of entries) {
                    const normalized = normalizeRateCommentRecord(entry, {
                        hotelCode, language: plan.language, source: plan.source, syncedAt
                    });
                    rateCommentRecords.push(normalized);
                }
            }
        const RateCommentModel = require('../models/HotelbedsRateComment');
        await (testOnly
            ? testEnsureModelConnected(RateCommentModel)
            : database.ensureModelConnected(RateCommentModel, {
                env, errorCode: 'hotelbeds_rate_comment_database_unavailable'
            }));
            for (const record of rateCommentRecords) {
                const validationError = new RateCommentModel(record).validateSync();
                if (validationError) throw validationError;
            }
            if (rateCommentRecords.length) {
                rateCommentWriteResult = await RateCommentModel.bulkWrite(rateCommentRecords.map(record => ({
                    updateOne: {
                        filter: {
                            hotelCode: record.hotelCode, language: record.language,
                            incoming: record.incoming, code: record.code, rateCodes: record.rateCodes,
                            source: record.source
                        },
                        update: { $set: record }, upsert: true
                    }
                })), { ordered: true });
            }
        }
        return {
            importedCount: records.length,
            rateCommentCount: rateCommentRequestCount,
            pageCount: plan.pageLimit,
            supplierRequests: plan.pageLimit + rateCommentRequestCount,
            source: plan.source,
            writeResult,
            rateCommentWriteResult
        };
    }
    return { importContent };
}

function normalizeRateCommentRecord(record, { hotelCode, language, source, syncedAt }) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || Number(record.hotelCode ?? hotelCode) !== hotelCode
        || normalizeLanguage(record.language || language) !== language
        || typeof record.incoming !== 'string' || !record.incoming.trim()
        || typeof record.code !== 'string' || !record.code.trim()
        || typeof record.rateCodes !== 'string' || !record.rateCodes.trim()
        || !Array.isArray(record.commentsByRates)) {
        throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
    }
    const commentsByRates = record.commentsByRates.map(group => {
        if (typeof group?.rateCodes !== 'string' || !group.rateCodes.trim() || !Array.isArray(group.comments)) {
            throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
        }
        return {
            rateCodes: group.rateCodes.trim(),
            comments: group.comments.map(comment => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(comment?.dateStart || '')
                    || !/^\d{4}-\d{2}-\d{2}$/.test(comment?.dateEnd || '')
                    || !boundedText(comment?.description, 2000)) {
                    throw fail('hotelbeds_rate_comment_import_record_invalid', 502);
                }
                return { dateStart: comment.dateStart, dateEnd: comment.dateEnd,
                    description: boundedText(comment.description, 2000) };
            })
        };
    });
    return {
        hotelCode, language, source, incoming: record.incoming.trim(), code: record.code.trim(),
        rateCodes: record.rateCodes.trim(), commentsByRates,
        issues: Array.isArray(record.issues) ? record.issues.slice(0, 100) : [],
        facilities: Array.isArray(record.facilities) ? record.facilities.slice(0, 500) : [],
        syncedAt
    };
}

module.exports = { MAX_IMPORT_HOTELS, MAX_IMPORT_PAGES, contentImportPlan, normalizedImportRecord,
    normalizeRateCommentRecord, createHotelbedsContentImportService };