const mongoose = require('mongoose');

const DATABASE_GATE = 'HOTELBEDS_MOCK_DATABASE_ENABLED';
const connection = mongoose.createConnection();

function fail(code, cause) {
    return Object.assign(new Error(code), {
        code,
        httpStatus: 503,
        ...(cause ? { cause } : {})
    });
}

function parseMongoTarget(uri, code) {
    if (typeof uri !== 'string' || !uri.trim()) throw fail(code);
    let parsed;
    try { parsed = new URL(uri.trim()); } catch { throw fail(code); }
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) throw fail(code);
    let database;
    try { database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || ''); }
    catch { throw fail(code); }
    if (!database) throw fail(code);
    const options = [...parsed.searchParams.entries()]
        .filter(([key]) => !['retrywrites', 'w', 'readpreference', 'appname'].includes(key.toLowerCase()))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
            leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    const identity = require('node:crypto').createHash('sha256').update(JSON.stringify({
        protocol: parsed.protocol.toLowerCase(),
        hostname: parsed.hostname.toLowerCase(),
        port: parsed.port,
        database,
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        options
    })).digest('hex');
    return {
        protocol: parsed.protocol.toLowerCase(),
        hostname: parsed.hostname.toLowerCase(),
        database,
        identity
    };
}

function assertDedicatedUri(mockUri, defaultUri) {
    const mockTarget = parseMongoTarget(mockUri, 'hotelbeds_mock_database_uri_invalid');
    const defaultTarget = parseMongoTarget(defaultUri, 'default_database_uri_unavailable');
    if (!mockTarget.database.toLowerCase().includes('mock')) {
        throw fail('hotelbeds_mock_database_name_required');
    }
    if (mockTarget.database.toLowerCase() === defaultTarget.database.toLowerCase()
        || mockTarget.identity === defaultTarget.identity) {
        throw fail('hotelbeds_mock_database_not_isolated');
    }
    return mockTarget;
}

function createHotelbedsMockDatabase({
    mongooseInstance = mongoose,
    isolatedConnection = mongooseInstance.createConnection()
} = {}) {
    let isolatedConnectionPromise = null;
    let connectedTarget = null;
    let openingTarget = null;
    let closePromise = null;

    function sameTarget(left, right) {
        return Boolean(left && right && left.protocol === right.protocol
            && left.hostname === right.hostname
            && left.database.toLowerCase() === right.database.toLowerCase()
            && left.identity === right.identity);
    }

    function assertConnectionDatabase(target, errorCode = 'hotelbeds_mock_database_target_changed') {
        const actualName = isolatedConnection.db?.databaseName || isolatedConnection.name;
        if (typeof actualName !== 'string' || !actualName
            || actualName.toLowerCase() !== target.database.toLowerCase()) {
            throw fail(errorCode);
        }
    }

    async function ensureIsolatedConnected({ env = process.env, connectTimeoutMs = 8000 } = {}) {
        if (!env || env[DATABASE_GATE] !== 'true') throw fail('hotelbeds_mock_database_disabled');
        let target;
        try {
            target = assertDedicatedUri(env.HOTELBEDS_MOCK_MONGO_URI, env.MONGO_URI);
        } catch (error) {
            throw error?.httpStatus ? error : fail('hotelbeds_mock_database_configuration_invalid', error);
        }
        if (closePromise) await closePromise;
        if (isolatedConnectionPromise && !openingTarget && isolatedConnection.readyState === 0) {
            const previousOpen = isolatedConnectionPromise;
            try { await previousOpen; } catch { /* A previous failed open can be retried. */ }
            if (isolatedConnectionPromise === previousOpen && isolatedConnection.readyState === 0) {
                isolatedConnectionPromise = null;
                connectedTarget = null;
            }
        }
        if (isolatedConnection.readyState === 1) {
            if (!sameTarget(connectedTarget, target)) {
                throw fail('hotelbeds_mock_database_target_changed');
            }
            assertConnectionDatabase(target);
            return isolatedConnection;
        }
        if (isolatedConnectionPromise) {
            if (!sameTarget(openingTarget, target)) throw fail('hotelbeds_mock_database_target_changed');
            await isolatedConnectionPromise;
            assertConnectionDatabase(target);
            return isolatedConnection;
        }

        openingTarget = target;
        isolatedConnectionPromise = Promise.resolve().then(() => isolatedConnection.openUri(
            env.HOTELBEDS_MOCK_MONGO_URI,
            { serverSelectionTimeoutMS: connectTimeoutMs }
        )).then(async () => {
            connectedTarget = target;
            assertConnectionDatabase(target);
            return isolatedConnection;
        }).catch(async error => {
            if (isolatedConnection.readyState !== 0) {
                await isolatedConnection.close().catch(() => {});
            }
            connectedTarget = null;
            openingTarget = null;
            isolatedConnectionPromise = null;
            throw fail('hotelbeds_mock_database_unavailable', error);
        });
        isolatedConnectionPromise.finally(() => {
            if (openingTarget === target) openingTarget = null;
        }).catch(() => {});
        return isolatedConnectionPromise;
    }

    async function ensureModelConnected(Model, {
        env = process.env,
        errorCode = 'hotelbeds_mock_model_connection_mismatch',
        expectedConnection,
        connectTimeoutMs = 8000
    } = {}) {
        const activeConnection = await ensureIsolatedConnected({ env, connectTimeoutMs });
        if (!Model?.db || Model.db !== activeConnection
            || expectedConnection && activeConnection !== expectedConnection
            || activeConnection === mongooseInstance.connection
            || activeConnection.readyState !== 1) {
            throw fail(errorCode);
        }
        assertConnectionDatabase(assertDedicatedUri(env.HOTELBEDS_MOCK_MONGO_URI, env.MONGO_URI), errorCode);
        return activeConnection;
    }

    async function close() {
        if (closePromise) return closePromise;
        closePromise = (async () => {
            if (isolatedConnectionPromise) {
                try { await isolatedConnectionPromise; } catch { /* The connection may never have opened. */ }
            }
            if (isolatedConnection.readyState !== 0) await isolatedConnection.close();
            isolatedConnectionPromise = null;
            connectedTarget = null;
            openingTarget = null;
        })();
        try {
            await closePromise;
        } finally {
            closePromise = null;
        }
    }

    function isolatedModel(name, schema) {
        if (typeof name !== 'string' || !name || !schema) {
            throw new TypeError('hotelbeds_mock_model_definition_invalid');
        }
        return isolatedConnection.models[name] || isolatedConnection.model(name, schema);
    }

    return {
        connection: isolatedConnection,
        model: isolatedModel,
        ensureConnected: ensureIsolatedConnected,
        ensureModelConnected,
        close
    };
}

const defaultDatabase = createHotelbedsMockDatabase({
    mongooseInstance: mongoose,
    isolatedConnection: connection
});

async function ensureModelConnected(Model, options) {
    return defaultDatabase.ensureModelConnected(Model, options);
}

async function close() {
    return defaultDatabase.close();
}

module.exports = {
    DATABASE_GATE,
    connection,
    model: defaultDatabase.model,
    ensureConnected: defaultDatabase.ensureConnected,
    ensureModelConnected,
    close,
    assertDedicatedUri,
    createHotelbedsMockDatabase
};