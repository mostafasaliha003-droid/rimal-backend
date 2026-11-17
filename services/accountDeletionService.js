const crypto = require('node:crypto');
const mongoose = require('mongoose');
const AccountDeletionRequest = require('../models/AccountDeletionRequest');

const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true, wtimeout: 10000 });
const fail = (code, httpStatus = 503) => Object.assign(new Error(code), { code, httpStatus });

// DI: Model implements init/findOne/find/create; database exposes readyState.
// Both methods accept an authenticated user identity, never request-body selectors.
// This service records intake only and has no fulfillment/destructive operations.
function createAccountDeletionService({ Model = AccountDeletionRequest, database = mongoose.connection,
    realm = process.env.RIMAL_AUTH_REALM, now = () => new Date(),
    createReference = () => `del_${crypto.randomBytes(16).toString('hex')}` } = {}) {
    if (!Model || typeof Model.init !== 'function' || typeof Model.findOne !== 'function' || typeof Model.find !== 'function'
        || typeof Model.create !== 'function' || !database || typeof now !== 'function'
        || typeof createReference !== 'function') throw new TypeError('account_deletion_dependencies_invalid');
    let indexesReady;
    const ownerValid = value => typeof value === 'string' && value.length > 0 && value.length <= 254
        && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
    function scope(identity) {
        if (typeof realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(realm)) throw fail('account_deletion_unavailable');
        if (!identity || identity.role !== 'user' || identity.realm !== realm
            || !ownerValid(identity.subject)) throw fail('unauthorized', 401);
        return { ownerSubject: identity.subject, realm };
    }
    async function ready() {
        if (database.readyState !== 1) throw fail('account_deletion_unavailable');
        if (!indexesReady) indexesReady = Promise.resolve().then(() => Model.init()).catch(() => {
            indexesReady = null; throw fail('account_deletion_unavailable');
        });
        await indexesReady;
        if (database.readyState !== 1) throw fail('account_deletion_unavailable');
    }
    function view(row, filter) {
        const at = new Date(row?.requestedAt);
        if (!row || !ownerValid(row.ownerSubject) || row.ownerSubject !== filter.ownerSubject || row.realm !== filter.realm
            || !/^del_[a-f0-9]{32}$/.test(row.reference) || row.status !== 'requested'
            || row.requestedAt == null || !Number.isFinite(at.getTime())) throw fail('account_deletion_unavailable');
        return { reference: row.reference, status: 'requested', requested_at: at.toISOString() };
    }
    async function read(filter) {
        try { return await Model.findOne(filter).select('reference ownerSubject realm status requestedAt').maxTimeMS(10000).lean(); }
        catch { throw fail('account_deletion_unavailable'); }
    }
    async function get(identity) {
        const filter = scope(identity);
        await ready();
        const row = await read(filter);
        return row ? view(row, filter) : null;
    }
    async function request(identity) {
        const filter = scope(identity);
        await ready();
        const existing = await read(filter);
        if (existing) return view(existing, filter);
        let reference, requestedAt;
        try { reference = createReference(); requestedAt = new Date(now()); }
        catch { throw fail('account_deletion_unavailable'); }
        if (!/^del_[a-f0-9]{32}$/.test(reference) || !Number.isFinite(requestedAt.getTime())) throw fail('account_deletion_unavailable');
        try {
            const rows = await Model.create([{ ...filter, reference, status: 'requested', requestedAt }],
                { ordered: true, writeConcern: WRITE_CONCERN });
            if (!Array.isArray(rows) || rows.length !== 1) throw fail('account_deletion_unavailable');
            return view(rows[0], filter);
        } catch (error) {
            // Concurrent requests are serialized by the unique owner+realm index.
            // A different owner's reference collision never becomes an entitlement.
            if (error?.code === 11000) {
                const winner = await read(filter);
                if (winner) return view(winner, filter);
            }
            throw fail('account_deletion_unavailable');
        }
    }
    async function list({ realm: requestedRealm, limit = 50, offset = 0 } = {}) {
        if (typeof realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(realm)) throw fail('account_deletion_unavailable');
        if (requestedRealm !== realm) throw fail('unauthorized', 401);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset)
            || offset < 0 || offset > 10000) throw fail('invalid_account_deletion_request', 400);
        await ready();
        let rows;
        try {
            rows = await Model.find({ realm }).select('reference ownerSubject realm status requestedAt')
                .sort({ requestedAt: -1, reference: 1 }).skip(offset).limit(limit + 1).maxTimeMS(10000).lean();
        } catch { throw fail('account_deletion_unavailable'); }
        if (!Array.isArray(rows)) throw fail('account_deletion_unavailable');
        const requests = rows.slice(0, limit).map(row => ({ ...view(row, { ownerSubject: row?.ownerSubject, realm }), ownerSubject: row.ownerSubject }));
        return { requests, pagination: { limit, offset, has_more: rows.length > limit } };
    }
    return { get, request, list };
}

module.exports = { WRITE_CONCERN, createAccountDeletionService };
