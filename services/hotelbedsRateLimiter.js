const crypto = require('node:crypto');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(code, httpStatus = 503, details = {}) {
    return Object.assign(new Error(code), { code, httpStatus, ...details });
}

function positiveInteger(value, name, fallback) {
    const parsed = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw fail(`invalid_${name}`);
    return parsed;
}

function settingsFor(config = {}) {
    const burstMax = positiveInteger(config.maxRequests, 'hotelbeds_rate_max_requests');
    const burstWindowMs = positiveInteger(config.windowMs, 'hotelbeds_rate_window_ms');
    const dailyMax = positiveInteger(config.dailyMaxRequests, 'hotelbeds_daily_quota', 50);
    const dailyWindowMs = positiveInteger(config.dailyWindowMs, 'hotelbeds_daily_quota_window_ms', DAY_MS);
    if (dailyMax > 50) throw fail('hotelbeds_daily_quota_exceeds_evaluation_limit');
    if (dailyWindowMs < DAY_MS) throw fail('hotelbeds_daily_quota_window_too_short');
    const operation = config.operation === undefined ? '' : String(config.operation).trim().toLowerCase();
    const operationDailyMax = config.operationDailyMaxRequests == null
        ? null : positiveInteger(config.operationDailyMaxRequests, 'hotelbeds_operation_daily_budget');
    if (operationDailyMax !== null && (!operation || operationDailyMax > dailyMax)) {
        throw fail('hotelbeds_operation_daily_budget_invalid');
    }
    return { burstMax, burstWindowMs, dailyMax, dailyWindowMs, operation, operationDailyMax };
}

function recentRequestsExpression(cutoff) {
    return {
        $filter: {
            input: { $ifNull: ['$requests', []] },
            as: 'requestAt',
            cond: { $gt: ['$$requestAt', cutoff] }
        }
    };
}

function recentOperationRequestsExpression(cutoff, operation) {
    return {
        $filter: {
            input: { $ifNull: ['$operationRequests', []] },
            as: 'request',
            cond: { $and: [
                { $gt: ['$$request.at', cutoff] },
                { $eq: ['$$request.operation', operation] }
            ] }
        }
    };
}

function operationBudgetFor(env = process.env, operation) {
    const raw = env.HOTELBEDS_DAILY_BUDGETS;
    if (!raw) return null;
    let budgets;
    try { budgets = JSON.parse(raw); } catch { throw fail('hotelbeds_daily_budgets_invalid'); }
    if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
        throw fail('hotelbeds_daily_budgets_invalid');
    }
    const normalized = Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key.toLowerCase(), value]));
    const values = Object.values(normalized);
    if (!values.length || values.some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
        throw fail('hotelbeds_daily_budgets_invalid');
    }
    const dailyMax = positiveInteger(env.HOTELBEDS_DAILY_MAX_REQUESTS, 'hotelbeds_daily_quota', 50);
    if (dailyMax > 50 || values.reduce((sum, value) => sum + Number(value), 0) > dailyMax) {
        throw fail('hotelbeds_daily_budgets_exceed_global_quota');
    }
    const key = String(operation || '').trim().toLowerCase();
    if (!Object.hasOwn(normalized, key)) throw fail('hotelbeds_operation_daily_budget_unconfigured');
    return Number(normalized[key]);
}

function createHotelbedsRateLimiter({
    Bucket,
    database = hotelbedsMockDatabase,
    env = process.env,
    testOnly = false,
    ensureDatabaseReady: testEnsureDatabaseReady,
    now = () => Date.now()
} = {}) {
    if (testOnly && (typeof testEnsureDatabaseReady !== 'function' || process.env.NODE_ENV === 'production')
        || !testOnly && testEnsureDatabaseReady !== undefined) {
        throw new TypeError('hotelbeds_rate_limiter_test_dependency_invalid');
    }

    function getBucket() {
        return Bucket || require('../models/HotelbedsRateLimitBucket');
    }

    async function ensureBucket(id, expiresAt) {
        try {
            await getBucket().updateOne({ _id: id }, {
                $setOnInsert: { requests: [], operationRequests: [], expiresAt: new Date(expiresAt) }
            }, { upsert: true, setDefaultsOnInsert: false }).exec();
        } catch (error) {
            // Concurrent first request may race creating the unique bucket.
            if (error?.code !== 11000) throw error;
        }
    }

    async function ensureDatabaseReady() {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return null;
        }
        if (!database || typeof database.ensureConnected !== 'function') {
            throw fail('hotelbeds_rate_limiter_unavailable');
        }
        const model = getBucket();
        try {
            return await database.ensureModelConnected(model, {
                env,
                errorCode: 'hotelbeds_rate_limiter_unavailable'
            });
        } catch {
            throw fail('hotelbeds_rate_limiter_unavailable');
        }
    }

    async function acquire(config = {}) {
        await ensureDatabaseReady();
        const settings = settingsFor(config);
        if (typeof config.account !== 'string' || !config.account.trim()
            || typeof config.apiKey !== 'string' || !config.apiKey.trim()
            || !['test'].includes(String(config.environment || 'test'))) {
            throw fail('hotelbeds_rate_limit_scope_unconfigured');
        }

        const timestamp = now();
        const accountFingerprint = crypto.createHash('sha256')
            // Hotelbeds issues a separate key per suite; scope the quota by that
            // key so changing an internal account label cannot split the bucket.
            .update(`${config.environment || 'test'}|${config.apiKey}`, 'utf8')
            .digest('hex');
        const bucketId = `hotelbeds:${accountFingerprint}`;
        const burstCutoff = new Date(timestamp - settings.burstWindowMs);
        const dailyCutoff = new Date(timestamp - settings.dailyWindowMs);
        const activeBurst = recentRequestsExpression(burstCutoff);
        const activeDaily = recentRequestsExpression(dailyCutoff);
        const activeOperation = settings.operation
            ? recentOperationRequestsExpression(dailyCutoff, settings.operation) : null;
        await ensureBucket(bucketId, timestamp + settings.dailyWindowMs);
        const bucket = await getBucket().findOneAndUpdate({
            _id: bucketId,
            $expr: {
                $and: [
                    { $lt: [{ $size: activeBurst }, settings.burstMax] },
                    { $lt: [{ $size: activeDaily }, settings.dailyMax] },
                    ...(settings.operationDailyMax === null ? [] : [
                        { $lt: [{ $size: activeOperation }, settings.operationDailyMax] }
                    ])
                ]
            }
        }, [{
            $set: {
                requests: { $concatArrays: [activeDaily, [new Date(timestamp)]] },
                operationRequests: {
                    $concatArrays: [
                        { $filter: {
                            input: { $ifNull: ['$operationRequests', []] },
                            as: 'request',
                            cond: { $gt: ['$$request.at', dailyCutoff] }
                        } },
                        ...(settings.operation ? [[{ operation: settings.operation, at: new Date(timestamp) }]] : [])
                    ]
                },
                expiresAt: new Date(timestamp + settings.dailyWindowMs)
            }
        }], { new: true, upsert: false }).exec();

        if (bucket) {
            const dailyCount = (bucket.requests || []).filter(requestAt => new Date(requestAt) > dailyCutoff).length;
            return { dailyRemaining: Math.max(0, settings.dailyMax - dailyCount) };
        }

        const current = await getBucket().findById(bucketId).lean().exec();
        const recentDaily = (current?.requests || [])
            .map(value => new Date(value).getTime())
            .filter(value => Number.isFinite(value) && value > timestamp - settings.dailyWindowMs)
            .sort((left, right) => left - right);
        if (settings.operationDailyMax !== null) {
            const recentOperation = (current?.operationRequests || [])
                .filter(request => request.operation === settings.operation)
                .map(request => new Date(request.at).getTime())
                .filter(value => Number.isFinite(value) && value > timestamp - settings.dailyWindowMs)
                .sort((left, right) => left - right);
            if (recentOperation.length >= settings.operationDailyMax) {
                throw fail('hotelbeds_operation_daily_budget_exhausted', 429, {
                    operation: settings.operation,
                    retryAfterMs: Math.max(1, recentOperation[0] + settings.dailyWindowMs - timestamp)
                });
            }
        }
        if (recentDaily.length >= settings.dailyMax) {
            throw fail('hotelbeds_daily_quota_exhausted', 429, {
                retryAfterMs: Math.max(1, recentDaily[0] + settings.dailyWindowMs - timestamp)
            });
        }

        const recentBurst = (current?.requests || [])
            .map(value => new Date(value).getTime())
            .filter(value => Number.isFinite(value) && value > timestamp - settings.burstWindowMs)
            .sort((left, right) => left - right);
        throw fail('hotelbeds_rate_limited', 429, {
            retryAfterMs: recentBurst.length >= settings.burstMax
                ? Math.max(1, recentBurst[0] + settings.burstWindowMs - timestamp)
                : settings.burstWindowMs
        });
    }

    return { acquire };
}

const defaultLimiter = createHotelbedsRateLimiter();

module.exports = {
    DAY_MS,
    createHotelbedsRateLimiter,
    acquire: defaultLimiter.acquire,
    operationBudgetFor,
    _test: { settingsFor, recentRequestsExpression, recentOperationRequestsExpression, operationBudgetFor }
};