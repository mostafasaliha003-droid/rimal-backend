const { compromisedCredential } = require('./internalApiKeyMiddleware');
const { assertDedicatedUri } = require('./hotelbedsDatabaseTarget');
const { validateSettings: validateHotelbedsRateSettings } = require('./hotelbedsRateLimiter');
const { contentConfigurationFrom } = require('./hotelbedsContentClient');
const { configuredHotelbedsPilotCodes } = require('./hotelbedsPilotList');

const REQUIRED_REALM = /^[a-z0-9:_-]{1,100}$/i;
const SHA256_HEX = /^[a-f\d]{64}$/i;
const MINIMUM_SECRET_LENGTH = 32;
const DAILY_QUOTA_DEFAULT = 50;
const DAILY_QUOTA_MAX = 50;
const DAILY_WINDOW_MINIMUM_MS = 24 * 60 * 60 * 1000;

const REQUIRED_BASE_ENVIRONMENT = Object.freeze([
    'MONGO_URI',
    'RIMAL_AUTH_REALM',
    'PAYMENT_BOOKING_ENCRYPTION_KEY'
]);

const HOTELBEDS_SECRET_ENVIRONMENT = Object.freeze([
    'HOTELBEDS_API_KEY',
    'HOTELBEDS_SECRET',
    'HOTELBEDS_ACCOUNT_CONFIG'
]);

const PAYMENT_MOCK_GATES = Object.freeze([
    'MULTI_SUPPLIER_MOCK_SEARCH_ENABLED',
    'HOTELBEDS_MOCK_DATABASE_ENABLED',
    'HOTELBEDS_PREPAID_CHECKOUT_ENABLED',
    'HOTELBEDS_PREPAID_CHECKOUT_APPROVED',
    'HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED',
    'HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED'
]);

function nonEmpty(env, name) {
    return typeof env?.[name] === 'string' && env[name].trim().length > 0;
}

function validRealm(value) {
    return typeof value === 'string' && value === value.trim() && REQUIRED_REALM.test(value);
}

function validEncryptionKey(value) {
    return typeof value === 'string' && SHA256_HEX.test(value);
}

function internalApiKeyStatus(env) {
    const value = typeof env?.RIMAL_INTERNAL_API_KEY === 'string' ? env.RIMAL_INTERNAL_API_KEY : '';
    if (!value) return 'disabled';
    if (value.length < MINIMUM_SECRET_LENGTH || value === env.RATEHAWK_BOOKING_TOKEN) return 'invalid';
    return compromisedCredential(value) ? 'compromised' : 'configured_unverified';
}

function mongoDatabaseName(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = new URL(value.trim());
        if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) return null;
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '') || null;
    } catch {
        return null;
    }
}

function checkBaseEnvironment(env = process.env) {
    const checks = REQUIRED_BASE_ENVIRONMENT.map(name => {
        if (!nonEmpty(env, name)) return { name, status: 'missing' };
        if (name === 'RIMAL_AUTH_REALM') return { name, status: validRealm(env[name]) ? 'ready' : 'invalid' };
        if (name === 'PAYMENT_BOOKING_ENCRYPTION_KEY') {
            return { name, status: validEncryptionKey(env[name]) ? 'ready' : 'invalid' };
        }
        return { name, status: mongoDatabaseName(env[name]) ? 'ready' : 'invalid' };
    });
    return { status: checks.every(check => check.status === 'ready') ? 'ready' : 'blocked', checks };
}

function checkHotelbedsOperationBudgets(env) {
    const raw = typeof env?.HOTELBEDS_DAILY_BUDGETS === 'string' ? env.HOTELBEDS_DAILY_BUDGETS.trim() : '';
    if (!raw) return { status: 'missing' };

    let budgets;
    try { budgets = JSON.parse(raw); } catch { return { status: 'invalid' }; }
    if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) return { status: 'invalid' };

    const entries = Object.entries(budgets);
    const operationNames = entries.map(([name]) => name.toLowerCase());
    const allowedOperations = ['status', 'availability', 'checkrates', 'booking', 'contentsync'];
    if (!entries.length || new Set(operationNames).size !== operationNames.length
        || entries.some(([name, value]) => {
            const validValue = typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
                || typeof value === 'string' && /^\d+$/.test(value)
                    && Number.isSafeInteger(Number(value)) && Number(value) >= 1;
            return !allowedOperations.includes(name.toLowerCase()) || !validValue;
        })) return { status: 'invalid' };

    const dailyMaxRaw = env.HOTELBEDS_DAILY_MAX_REQUESTS;
    const dailyMax = dailyMaxRaw === undefined || dailyMaxRaw === '' ? DAILY_QUOTA_DEFAULT : Number(dailyMaxRaw);
    const dailyWindowRaw = env.HOTELBEDS_DAILY_WINDOW_MS;
    const dailyWindow = dailyWindowRaw === undefined || dailyWindowRaw === ''
        ? DAILY_WINDOW_MINIMUM_MS : Number(dailyWindowRaw);
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    if (!Number.isSafeInteger(dailyMax) || dailyMax < 1 || dailyMax > DAILY_QUOTA_MAX
        || !Number.isSafeInteger(dailyWindow) || dailyWindow < DAILY_WINDOW_MINIMUM_MS || total > dailyMax) {
        return { status: 'exceeds_evaluation_limit' };
    }
    return { status: 'configured_unverified', configuredOperations: operationNames };
}

function checkHotelbedsRateSettings(env, operation) {
    const budgets = checkHotelbedsOperationBudgets(env);
    const normalizedOperation = String(operation || '').toLowerCase();
    if (!budgets.configuredOperations?.includes(normalizedOperation)) return { status: 'blocked' };

    let configured;
    try { configured = JSON.parse(env.HOTELBEDS_DAILY_BUDGETS); }
    catch { return { status: 'invalid' }; }
    const operationBudget = Object.entries(configured)
        .find(([name]) => name.toLowerCase() === normalizedOperation)?.[1];
    try {
        validateHotelbedsRateSettings({
            maxRequests: env.HOTELBEDS_RATE_MAX_REQUESTS,
            windowMs: env.HOTELBEDS_RATE_WINDOW_MS,
            dailyMaxRequests: env.HOTELBEDS_DAILY_MAX_REQUESTS,
            dailyWindowMs: env.HOTELBEDS_DAILY_WINDOW_MS,
            operation: normalizedOperation,
            operationDailyMaxRequests: operationBudget
        });
        return { status: 'configured_unverified' };
    } catch {
        return { status: 'invalid' };
    }
}

function checkHotelbedsCredentials(env) {
    try {
        require('./hotelbedsClient').credentialsFrom(env);
        return { status: 'present_unverified' };
    } catch (error) {
        return { status: error?.code === 'hotelbeds_environment_not_supported' ? 'unsupported_environment' : 'missing_or_invalid' };
    }
}

function checkHotelbedsContentClient(env) {
    try {
        contentConfigurationFrom(env);
        return { status: 'test_configuration_present_unverified' };
    } catch (error) {
        return { status: error?.code === 'hotelbeds_environment_not_supported'
            || error?.code === 'hotelbeds_content_endpoint_invalid' ? 'invalid_or_unsupported' : 'missing_or_invalid' };
    }
}

function checkHotelbedsContentAllowlist(env, requestedCodes) {
    const raw = typeof env?.HOTELBEDS_PILOT_HOTEL_CODES === 'string'
        ? env.HOTELBEDS_PILOT_HOTEL_CODES.trim() : '';
    const language = typeof env?.HOTELBEDS_PILOT_LANGUAGE === 'string'
        ? env.HOTELBEDS_PILOT_LANGUAGE.trim().toUpperCase() : '';
    if (!raw || !/^[A-Z]{2,12}$/.test(language)) return { status: 'missing_or_invalid' };

    const tokens = raw.split(',').map(code => code.trim());
    if (tokens.length > 5 || tokens.some(code => !/^\d{1,10}$/.test(code) || Number(code) < 1)
        || new Set(tokens.map(Number)).size !== tokens.length) return { status: 'missing_or_invalid' };
    const allowedCodes = new Set(configuredHotelbedsPilotCodes(env));
    if (tokens.some(code => !allowedCodes.has(String(Number(code))))) return { status: 'not_in_pilot_allowlist' };
    const normalizedCodes = tokens.map(Number);

    if (requestedCodes === undefined) return { status: 'configured_unverified', hotelCount: normalizedCodes.length };
    if (!Array.isArray(requestedCodes) || requestedCodes.length < 1 || requestedCodes.length > 5) {
        return { status: 'invalid_request' };
    }
    const normalizedRequested = requestedCodes.map(Number);
    if (normalizedRequested.some(code => !Number.isSafeInteger(code)
        || code < 1 || !normalizedCodes.includes(code))) return { status: 'not_in_pilot_allowlist' };
    return { status: 'requested_allowlisted', hotelCount: new Set(normalizedRequested).size };
}

function checkHotelbedsIsolatedDatabase(env) {
    if (env.HOTELBEDS_MOCK_DATABASE_ENABLED !== 'true') return { status: 'disabled' };
    try {
        assertDedicatedUri(env.HOTELBEDS_MOCK_MONGO_URI, env.MONGO_URI);
        return { status: 'isolated_target_validated_not_connected' };
    } catch {
        return { status: 'invalid_or_not_isolated' };
    }
}

function checkHotelbedsEnvironment(env = process.env) {
    if (env?.HOTELBEDS_ENABLED !== 'true') {
        return {
            status: 'disabled',
            environment: null,
            secretChecks: HOTELBEDS_SECRET_ENVIRONMENT.map(name => ({ name, status: 'not_checked' })),
            certificate: { status: 'not_checked' },
            operationBudgets: { status: 'not_checked' },
            pilot: { status: 'disabled' },
            publicSearch: { status: 'disabled' },
            booking: { status: 'disabled' },
            mockCheckout: { status: 'disabled' },
            contentApi: {
                status: 'not_enabled',
                mutualTls: 'not_used_by_current_content_client',
                planOnlyCli: 'available_local_only_no_network_no_database_write'
            },
            cacheApi: { status: 'not_implemented_or_configured' },
            cdsApi: { status: 'not_implemented_or_configured' }
        };
    }

    const environment = typeof env.HOTELBEDS_ENV === 'string' ? env.HOTELBEDS_ENV.trim().toLowerCase() : '';
    const testOnly = environment === 'test';
    const secretChecks = HOTELBEDS_SECRET_ENVIRONMENT.map(name => ({
        name, status: nonEmpty(env, name) ? 'present_unverified' : 'missing'
    }));
    const credentials = checkHotelbedsCredentials(env);

    let certificateStatus = 'missing';
    const certContent = typeof env.HOTELBEDS_MTLS_CERT_CONTENT === 'string' ? env.HOTELBEDS_MTLS_CERT_CONTENT.trim() : '';
    const keyContent = typeof env.HOTELBEDS_MTLS_KEY_CONTENT === 'string' ? env.HOTELBEDS_MTLS_KEY_CONTENT.trim() : '';
    const certPath = typeof env.HOTELBEDS_MTLS_CERT_PATH === 'string' ? env.HOTELBEDS_MTLS_CERT_PATH.trim() : '';
    const keyPath = typeof env.HOTELBEDS_MTLS_KEY_PATH === 'string' ? env.HOTELBEDS_MTLS_KEY_PATH.trim() : '';
    if (Boolean(certContent) !== Boolean(keyContent) || Boolean(certPath) !== Boolean(keyPath)
        || (certContent && certPath) || (keyContent && keyPath)) certificateStatus = 'invalid_pair';
    else if ((certContent && keyContent) || (certPath && keyPath)) certificateStatus = 'configured_unverified';

    const publicSearchRequested = [
        'HOTELBEDS_LIVE_AGGREGATE_SEARCH_ENABLED', 'MULTI_SUPPLIER_SEARCH_ENABLED',
        'MULTI_SUPPLIER_PRICE_POLICY_APPROVED', 'MULTI_SUPPLIER_FX_POLICY_APPROVED',
        'MULTI_SUPPLIER_CONTENT_APPROVED', 'HOTELBEDS_PUBLIC_SEARCH_ENABLED',
        'HOTELBEDS_PUBLIC_PRICING_APPROVED', 'HOTELBEDS_PUBLIC_PRICE_POLICY_APPROVED',
        'HOTELBEDS_PUBLIC_CONTENT_APPROVED'
    ].some(name => env[name] === 'true');
    const bookingRequested = env.HOTELBEDS_BOOKING_ENABLED === 'true'
        || env.HOTELBEDS_BOOKING_APPROVED === 'true'
        || env.HOTELBEDS_PREPAID_BOOKING_ENABLED === 'true'
        || env.HOTELBEDS_PREPAID_BOOKING_APPROVED === 'true'
        || env.HOTELBEDS_CREDIT_LINE_APPROVED === 'true';
    const mockCheckoutRequested = PAYMENT_MOCK_GATES.some(name => env[name] === 'true');
    const mockCheckoutConfigured = PAYMENT_MOCK_GATES.every(name => env[name] === 'true')
        && testOnly && validEncryptionKey(env.PAYMENT_BOOKING_ENCRYPTION_KEY)
        && typeof env.ZIINA_MOCK_WEBHOOK_SECRET === 'string'
        && env.ZIINA_MOCK_WEBHOOK_SECRET.length >= MINIMUM_SECRET_LENGTH;

    const credentialsPresent = credentials.status === 'present_unverified'
        && secretChecks.every(check => check.status === 'present_unverified');
    const operationBudgets = checkHotelbedsOperationBudgets(env);
    const statusRateSettings = checkHotelbedsRateSettings(env, 'status');
    const availabilityRateSettings = checkHotelbedsRateSettings(env, 'availability');
    const contentRateSettings = checkHotelbedsRateSettings(env, 'contentsync');
    const isolatedDatabase = checkHotelbedsIsolatedDatabase(env);
    const allowlist = checkHotelbedsContentAllowlist(env);
    const contentClient = checkHotelbedsContentClient(env);
    const contentImportRequested = env.HOTELBEDS_CONTENT_IMPORT_ENABLED === 'true'
        || env.HOTELBEDS_CONTENT_IMPORT_APPROVED === 'true';

    let certificate = { status: certificateStatus };
    if (certificateStatus === 'configured_unverified') {
        const endpoint = typeof env.HOTELBEDS_MTLS_BASE_URL === 'string'
            ? env.HOTELBEDS_MTLS_BASE_URL.trim().replace(/\/+$/, '') : '';
        certificate = { status: testOnly && endpoint === 'https://api-mtls.test.hotelbeds.com'
            ? 'configured_unverified' : 'invalid_or_unsupported_endpoint' };
    }

    const pilotRequested = env.HOTELBEDS_AVAILABILITY_PILOT_ENABLED === 'true'
        || env.HOTELBEDS_PILOT_APPROVED === 'true';
    const pilotReady = env.HOTELBEDS_AVAILABILITY_PILOT_ENABLED === 'true'
        && env.HOTELBEDS_PILOT_APPROVED === 'true'
        && env.HOTELBEDS_MOCK_DATABASE_ENABLED === 'true'
        && testOnly && credentialsPresent
        && certificate.status === 'configured_unverified'
        && allowlist.status === 'configured_unverified'
        && isolatedDatabase.status === 'isolated_target_validated_not_connected'
        && env.HOTELBEDS_PILOT_PRICE_POLICY === 'supplier-raw-internal-only'
        && typeof env.HOTELBEDS_PILOT_OPERATOR_KEY === 'string'
        && env.HOTELBEDS_PILOT_OPERATOR_KEY.length >= MINIMUM_SECRET_LENGTH
        && operationBudgets.configuredOperations?.includes('availability')
        && availabilityRateSettings.status === 'configured_unverified';

    const contentReady = env.HOTELBEDS_CONTENT_IMPORT_ENABLED === 'true'
        && env.HOTELBEDS_CONTENT_IMPORT_APPROVED === 'true'
        && testOnly && credentialsPresent
        && contentClient.status === 'test_configuration_present_unverified'
        && allowlist.status === 'configured_unverified'
        && operationBudgets.configuredOperations?.includes('contentsync')
        && contentRateSettings.status === 'configured_unverified'
        && isolatedDatabase.status === 'isolated_target_validated_not_connected';

    return {
        status: testOnly ? 'test_only_unverified' : 'blocked',
        environment: testOnly ? 'test' : environment ? 'unsupported' : 'missing',
        credentials: credentials.status,
        secretChecks,
        certificate,
        operationBudgets,
        isolatedDatabase,
        pilot: !pilotRequested ? { status: 'disabled' }
            : {
                status: pilotReady ? 'configured_unverified' : 'invalid_or_incomplete',
                database: isolatedDatabase.status
            },
        hotelsApi: {
            status: testOnly && credentialsPresent ? 'client_configured_unverified' : 'blocked',
            nonMutualTlsStatus: statusRateSettings.status,
            mutualTls: certificate.status,
            mutualTlsOperations: ['availability', 'checkRate', 'booking', 'bookingList']
        },
        contentApi: {
            status: !contentImportRequested ? 'not_enabled' : contentReady
                ? 'manual_pilot_sync_configured_unverified' : 'blocked_invalid_or_incomplete',
            client: contentClient.status,
            mutualTls: 'not_used_by_current_content_client',
            hotelAllowlist: allowlist.status,
            rateLimiter: contentRateSettings.status,
            isolatedDatabase: isolatedDatabase.status,
            runtimeCaller: 'manual_apply_requires_approval_and_transactions',
            planOnlyMode: 'local_only_no_dotenv_no_network_no_database_write',
            planOnlyCli: 'available'
        },
        publicSearch: publicSearchRequested ? {
            status: 'blocked_pending_approval_and_runtime_verification',
            supplierCredentials: credentialsPresent ? 'present_unverified' : 'blocked',
            mutualTls: certificate.status,
            liveFx: 'unverified',
            verifiedContent: 'unverified'
        } : { status: 'disabled' },
        booking: bookingRequested ? {
            status: 'blocked_pending_certification_and_live_checkout_approval',
            runtimeBookingMode: 'test_only',
            certificate: certificate.status
        } : { status: 'disabled' },
        mockCheckout: mockCheckoutRequested ? {
            status: mockCheckoutConfigured ? 'configured_unverified' : 'invalid_or_incomplete',
            mode: 'test_only_mock_workflow',
            externalPayment: 'not_tested',
            externalSupplierBooking: 'not_tested'
        } : { status: 'disabled' },
        cacheApi: { status: 'not_implemented_or_configured' },
        cdsApi: { status: 'not_implemented_or_configured' }
    };
}

function checkStartupEnvironment(env = process.env) {
    const valid = validRealm(env?.RIMAL_AUTH_REALM);
    return { status: valid ? 'ready' : 'blocked', checks: [
        { name: 'RIMAL_AUTH_REALM', status: valid ? 'ready' : 'missing_or_invalid' }
    ] };
}

function getDeploymentReadiness(env = process.env) {
    const startup = checkStartupEnvironment(env);
    const application = checkBaseEnvironment(env);
    const hotelbeds = checkHotelbedsEnvironment(env);
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        overallStatus: startup.status !== 'ready' ? 'blocked'
            : application.status !== 'ready' ? 'application_environment_incomplete' : 'application_ready',
        startup,
        application,
        internalApiKey: { status: internalApiKeyStatus(env) },
        hotelbeds,
        externalConnectivity: 'not_tested',
        certification: 'not_claimed'
    };
}

function readinessHttpStatus(readiness, databaseState) {
    const appState = typeof readiness === 'string' ? readiness : readiness?.application?.status;
    return (appState === 'ready' || appState === 'application_ready')
        && databaseState === 'connected' ? 200 : 503;
}

function contentPlanningReadiness(env = process.env) {
    const hotelbeds = checkHotelbedsEnvironment(env);
    const content = hotelbeds.contentApi;
    return {
        ready: content.status === 'manual_pilot_sync_configured_unverified'
            && content.hotelAllowlist === 'configured_unverified'
            && content.rateLimiter === 'configured_unverified'
            && content.isolatedDatabase === 'isolated_target_validated_not_connected'
            && content.client === 'test_configuration_present_unverified',
        gates: content
    };
}

module.exports = {
    REQUIRED_BASE_ENVIRONMENT,
    HOTELBEDS_SECRET_ENVIRONMENT,
    getDeploymentReadiness,
    readinessHttpStatus,
    contentPlanningReadiness,
    checkStartupEnvironment,
    checkBaseEnvironment,
    checkHotelbedsEnvironment,
    checkHotelbedsContentAllowlist,
    checkHotelbedsOperationBudgets,
    internalApiKeyStatus,
    validRealm,
    validEncryptionKey,
    mongoDatabaseName
};