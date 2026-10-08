const crypto = require('node:crypto');

function fail(code) {
    return Object.assign(new Error(code), { code, httpStatus: 503 });
}

function parseMongoTarget(uri, code) {
    if (typeof uri !== 'string' || !uri.trim()) throw fail(code);
    let parsed;
    try { parsed = new URL(uri.trim()); } catch { throw fail(code); }
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) throw fail(code);

    let database;
    let username;
    let password;
    try {
        database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
        username = decodeURIComponent(parsed.username);
        password = decodeURIComponent(parsed.password);
    } catch {
        throw fail(code);
    }
    if (!database) throw fail(code);

    const options = [...parsed.searchParams.entries()]
        .filter(([key]) => !['retrywrites', 'w', 'readpreference', 'appname'].includes(key.toLowerCase()))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
            leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    const identity = crypto.createHash('sha256').update(JSON.stringify({
        protocol: parsed.protocol.toLowerCase(),
        hostname: parsed.hostname.toLowerCase(),
        port: parsed.port,
        database,
        username,
        password,
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

module.exports = { parseMongoTarget, assertDedicatedUri };