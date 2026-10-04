const crypto = require('node:crypto');

// SHA-256 digest of the key previously embedded in tracked browser bundles.
// The original value is deliberately not retained in source.
const COMPROMISED_PUBLIC_KEY_DIGEST = '1e7af624d009660d66bc5682125ebc8c14037af614fe00a688534bea33ac327d';

function digest(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function secureEquals(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    const actualDigest = digest(actual);
    const expectedDigest = digest(expected);
    return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function compromisedCredential(value) {
    if (typeof value !== 'string' || !value) return false;
    const candidate = digest(value);
    const known = Buffer.from(COMPROMISED_PUBLIC_KEY_DIGEST, 'hex');
    return candidate.length === known.length && crypto.timingSafeEqual(candidate, known);
}

function createInternalApiKeyMiddleware({ env = process.env, logger = null } = {}) {
    if (!env || typeof env !== 'object') throw new TypeError('internal_api_key_environment_invalid');
    return function requireInternalApiKey(req, res, next) {
        const configured = typeof env.RIMAL_INTERNAL_API_KEY === 'string' ? env.RIMAL_INTERNAL_API_KEY : '';
        res.set('Cache-Control', 'no-store');
        if (configured.length < 32 || compromisedCredential(configured)
            || configured === env.RATEHAWK_BOOKING_TOKEN) {
            return res.status(503).json({ success: false, error: 'internal_auth_not_configured' });
        }
        if (req.get('Origin')) {
            return res.status(403).json({ success: false, error: 'server_to_server_only' });
        }
        if (!secureEquals(req.get('x-internal-api-key') || '', configured)) {
            if (typeof logger?.warn === 'function') logger.warn('Blocked unauthorized internal API access', { ip: req.ip });
            return res.status(401).json({ success: false, error: 'unauthorized' });
        }
        return next();
    };
}

module.exports = { COMPROMISED_PUBLIC_KEY_DIGEST, secureEquals, compromisedCredential, createInternalApiKeyMiddleware };