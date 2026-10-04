const crypto = require('node:crypto');
const express = require('express');

function createAdminAuthRouter({ sessions, auth, adminEmail, adminPasswordHash, comparePassword, bookingLimiter } = {}) {
    if (!sessions || typeof sessions.create !== 'function' || typeof sessions.revoke !== 'function'
        || !auth || typeof auth.requireRole !== 'function'
        || typeof comparePassword !== 'function') {
        throw new TypeError('admin_auth_route_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof bookingLimiter === 'function' ? bookingLimiter : (_req, _res, next) => next();

    router.post('/login', limiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (typeof adminEmail !== 'string' || !adminEmail.trim()
            || typeof adminPasswordHash !== 'string'
            || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(adminPasswordHash)) {
            return res.status(503).json({ success: false, error: 'admin_auth_unavailable' });
        }
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!email || !password || password.length > 256) {
            return res.status(401).json({ success: false, error: 'invalid_credentials' });
        }
        try {
            const validHash = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(adminPasswordHash);
            const configuredEmail = adminEmail.trim().toLowerCase();
            const suppliedEmail = Buffer.from(email);
            const expectedEmail = Buffer.from(configuredEmail);
            const identityMatches = suppliedEmail.length === expectedEmail.length
                && crypto.timingSafeEqual(suppliedEmail, expectedEmail);
            const passwordMatches = validHash ? await comparePassword(password, adminPasswordHash) : false;
            if (!identityMatches || !validHash || !passwordMatches) {
                return res.status(401).json({ success: false, error: 'invalid_credentials' });
            }
            const session = await sessions.create({ subject: email, email, role: 'admin' });
            return res.status(200).json({ success: true, access_token: session.token, expires_at: session.expiresAt.toISOString() });
        } catch {
            return res.status(503).json({ success: false, error: 'authentication_unavailable' });
        }
    });

    router.get('/session', auth.requireRole('admin'), (req, res) => {
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, email: req.auth.email });
    });

    router.post('/logout', auth.requireRole('admin'), async (req, res) => {
        try {
            await sessions.revoke(req.authToken);
            return res.status(200).json({ success: true });
        } catch {
            return res.status(503).json({ success: false, error: 'authentication_unavailable' });
        }
    });
    return router;
}

module.exports = createAdminAuthRouter;