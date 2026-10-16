const crypto = require('node:crypto');
const mongoose = require('mongoose');
const AuthSession = require('../models/AuthSession');

const USER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true, wtimeout: 10000 });

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function tokenDigest(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createAuthSessionService({
    Model = AuthSession,
    database = mongoose.connection,
    realm = process.env.RIMAL_AUTH_REALM,
    now = () => new Date(),
    createToken = () => crypto.randomBytes(32).toString('hex')
} = {}) {
    if (!Model || typeof Model.create !== 'function' || typeof Model.findOne !== 'function'
        || typeof Model.updateOne !== 'function' || !database
        || typeof now !== 'function' || typeof createToken !== 'function') {
        throw new TypeError('auth_session_dependencies_invalid');
    }

    let indexesReady;
    function configuredRealm(value = realm) {
        return typeof value === 'string' && /^[a-z0-9:_-]{1,100}$/i.test(value) ? value : null;
    }

    async function ensureReady() {
        if (!configuredRealm()) throw fail('auth_session_realm_unavailable');
        if (database.readyState !== 1) throw fail('auth_session_database_unavailable');
        if (!indexesReady) {
            indexesReady = Promise.resolve().then(async () => {
                if (typeof Model.init !== 'function') throw new Error('auth_session_indexes_unavailable');
                await Model.init();
            }).catch(() => {
                indexesReady = null;
                throw fail('auth_session_database_unavailable');
            });
        }
        await indexesReady;
        if (database.readyState !== 1) throw fail('auth_session_database_unavailable');
    }

    async function create({ subject, email, role } = {}) {
        if (typeof subject !== 'string' || !subject.trim() || subject.length > 254
            || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || !['user', 'admin'].includes(role)) {
            throw fail('auth_session_identity_invalid', 400);
        }
        await ensureReady();

        const token = createToken();
        if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) {
            throw fail('auth_session_token_invalid');
        }
        const issuedAt = new Date(now());
        const ttl = role === 'admin' ? ADMIN_SESSION_TTL_MS : USER_SESSION_TTL_MS;
        const expiresAt = new Date(issuedAt.getTime() + ttl);
        if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
            throw fail('auth_session_clock_invalid');
        }

        try {
            const created = await Model.create([{
                tokenHash: tokenDigest(token),
                subject: subject.trim(),
                email: email.trim().toLowerCase(),
                role,
                realm,
                expiresAt,
                revokedAt: null
            }], { ordered: true, writeConcern: WRITE_CONCERN });
            if (!Array.isArray(created) || created.length !== 1) throw new Error('auth_session_create_incomplete');
        } catch {
            throw fail('auth_session_persistence_unavailable');
        }
        return { token, expiresAt };
    }

    async function resolve(token, { realm: requestedRealm = realm } = {}) {
        if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) return null;
        const activeRealm = configuredRealm();
        if (!activeRealm || requestedRealm !== activeRealm) return null;
        await ensureReady();
        const at = new Date(now());
        if (!Number.isFinite(at.getTime())) throw fail('auth_session_clock_invalid');
        let record;
        try {
            record = await Model.findOne({
                tokenHash: tokenDigest(token),
                realm: activeRealm,
                revokedAt: null,
                expiresAt: { $gt: at }
            }).select('+tokenHash').lean();
        } catch {
            throw fail('auth_session_database_unavailable');
        }
        if (!record || record.realm !== activeRealm || !['user', 'admin'].includes(record.role)
            || typeof record.subject !== 'string' || typeof record.email !== 'string') return null;
        return { subject: record.subject, email: record.email, role: record.role, realm: activeRealm, expiresAt: record.expiresAt };
    }

    async function revoke(token, { realm: requestedRealm = realm } = {}) {
        if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) return false;
        const activeRealm = configuredRealm();
        if (!activeRealm || requestedRealm !== activeRealm) return false;
        await ensureReady();
        const revokedAt = new Date(now());
        if (!Number.isFinite(revokedAt.getTime())) throw fail('auth_session_clock_invalid');
        try {
            const result = await Model.updateOne({ tokenHash: tokenDigest(token), realm: activeRealm, revokedAt: null }, {
                $set: { revokedAt }
            }, { writeConcern: WRITE_CONCERN });
            return result?.modifiedCount === 1;
        } catch {
            throw fail('auth_session_database_unavailable');
        }
    }

    return { create, resolve, revoke };
}

module.exports = {
    USER_SESSION_TTL_MS,
    ADMIN_SESSION_TTL_MS,
    WRITE_CONCERN,
    tokenDigest,
    createAuthSessionService
};