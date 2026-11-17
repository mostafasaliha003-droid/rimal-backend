const express = require('express');

const fail = (code, httpStatus) => Object.assign(new Error(code), { code, httpStatus });
const response = request => ({ success: true, request, data_deleted: false });

// Mount at /api/auth/account-deletion. Existing /api/auth membership exemption
// permits pending/rejected members, while each handler still requires a user session.
function createAccountDeletionRouter({ UserModel, sessions, auth, comparePassword, service,
    authLimiter = (_req, _res, next) => next() } = {}) {
    if (!UserModel || typeof UserModel.findOne !== 'function' || !sessions || typeof sessions.resolve !== 'function'
        || !auth || typeof auth.requireRole !== 'function' || typeof comparePassword !== 'function'
        || !service || typeof service.get !== 'function' || typeof service.request !== 'function'
        || typeof authLimiter !== 'function') throw new TypeError('account_deletion_route_dependencies_invalid');
    const router = express.Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Authorization'); next(); });
    const wrap = run => async (req, res) => {
        try {
            if (Object.keys(req.query || {}).length) throw fail('invalid_account_deletion_request', 400);
            const identity = req.auth;
            if (!identity || identity.role !== 'user' || typeof identity.subject !== 'string' || !identity.subject
                || typeof identity.realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(identity.realm)
                || typeof identity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) throw fail('unauthorized', 401);
            res.json(response(await run(req, identity)));
        } catch (error) {
            const status = [400, 401].includes(error?.httpStatus) ? error.httpStatus : 503;
            const code = status === 400 && error.code === 'reauthentication_failed' ? 'reauthentication_failed'
                : status === 400 ? 'invalid_account_deletion_request'
                    : status === 401 ? 'unauthorized' : 'account_deletion_unavailable';
            res.status(status).json({ success: false, error: code });
        }
    };
    router.get('/', auth.requireRole('user'), wrap(async (_req, identity) => service.get(identity)));
    router.post('/', authLimiter, auth.requireRole('user'), wrap(async (req, identity) => {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'password') || !Object.hasOwn(body, 'confirm_account_deletion')
            || body.confirm_account_deletion !== true || typeof body.password !== 'string' || !body.password.length
            || body.password.length > 256) throw fail('invalid_account_deletion_request', 400);
        const user = await UserModel.findOne({ _id: identity.subject, email: identity.email })
            .select('_id email +password').maxTimeMS(10000).lean();
        if (!user || String(user._id) !== identity.subject || user.email !== identity.email
            || typeof user.password !== 'string' || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(user.password)
            || await comparePassword(body.password, user.password) !== true) throw fail('reauthentication_failed', 400);
        // Password comparison is asynchronous. A session revoked/replaced while it
        // ran must not authorize new intake with the stale middleware snapshot.
        if (typeof req.authToken !== 'string' || !/^[a-f\d]{64}$/i.test(req.authToken)) throw fail('unauthorized', 401);
        const current = await sessions.resolve(req.authToken, { realm: identity.realm });
        if (!current || current.role !== 'user' || current.subject !== identity.subject
            || current.realm !== identity.realm || current.email !== identity.email) throw fail('unauthorized', 401);
        return service.request(current);
    }));
    return router;
}

// Mount under the server's existing global rate protection. Like the other
// administrative routes, this requires an administrator session and its realm.
function createAdminAccountDeletionRouter({ service, auth } = {}) {
    if (!service || typeof service.list !== 'function' || !auth || typeof auth.requireRole !== 'function') {
        throw new TypeError('account_deletion_admin_dependencies_invalid');
    }
    const router = express.Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Authorization'); next(); });
    router.get('/', auth.requireRole('admin'), async (req, res) => {
        try {
            if (req.auth?.role !== 'admin' || typeof req.auth.realm !== 'string') throw fail('unauthorized', 401);
            const query = req.query || {};
            if (Object.keys(query).some(key => !['limit', 'offset'].includes(key))) throw fail('invalid_account_deletion_request', 400);
            const number = (value, fallback) => {
                if (value === undefined) return fallback;
                if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,4})$/.test(value)) throw fail('invalid_account_deletion_request', 400);
                return Number(value);
            };
            res.json({ success: true, ...await service.list({ realm: req.auth.realm,
                limit: number(query.limit, 50), offset: number(query.offset, 0) }) });
        } catch (error) {
            const status = [400, 401].includes(error?.httpStatus) ? error.httpStatus : 503;
            res.status(status).json({ success: false, error: status === 400 ? 'invalid_account_deletion_request'
                : status === 401 ? 'unauthorized' : 'account_deletion_unavailable' });
        }
    });
    return router;
}

module.exports = { createAccountDeletionRouter, createAdminAccountDeletionRouter };
