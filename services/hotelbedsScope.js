const crypto = require('node:crypto');

function fail(code) {
    return Object.assign(new Error(code), { code, httpStatus: 503 });
}

function hotelbedsScopeFrom(env = process.env, { testOnly = false } = {}) {
    if (testOnly) {
        return Object.freeze({
            realm: 'test:hotelbeds-fixture',
            environment: 'test',
            accountId: crypto.createHash('sha256').update('hotelbeds-account-v1:test-fixture-account', 'utf8').digest('hex')
        });
    }
    const realm = typeof env?.RIMAL_AUTH_REALM === 'string' ? env.RIMAL_AUTH_REALM.trim() : '';
    const environment = typeof env?.HOTELBEDS_ENV === 'string' ? env.HOTELBEDS_ENV.trim().toLowerCase() : '';
    const accountConfig = typeof env?.HOTELBEDS_ACCOUNT_CONFIG === 'string' ? env.HOTELBEDS_ACCOUNT_CONFIG.trim() : '';
    if (!/^[a-z0-9:_-]{1,100}$/i.test(realm)
        || !['test', 'live'].includes(environment)
        || !/^[a-z0-9:_-]{1,200}$/i.test(accountConfig)) {
        throw fail('hotelbeds_scope_unavailable');
    }
    return Object.freeze({
        realm,
        environment,
        accountId: crypto.createHash('sha256')
            .update(`hotelbeds-account-v1:${accountConfig}`, 'utf8').digest('hex')
    });
}

function ownerSubjectFrom(value, { testOnly = false } = {}) {
    if (testOnly && (value === undefined || value === null)) return 'test-fixture-owner';
    if (typeof value !== 'string' || !value.trim() || value.length > 254) {
        throw Object.assign(new Error('booking_owner_required'), { code: 'booking_owner_required', httpStatus: 401 });
    }
    return value.trim();
}

function sameHotelbedsScope(record, scope) {
    return Boolean(record && scope && record.realm === scope.realm
        && record.environment === scope.environment && record.accountId === scope.accountId);
}

module.exports = { hotelbedsScopeFrom, ownerSubjectFrom, sameHotelbedsScope };