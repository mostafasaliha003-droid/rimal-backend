const crypto = require('node:crypto');

function failCredentials() {
    return Object.assign(new Error('hotelbeds_credentials_unavailable'), {
        code: 'hotelbeds_credentials_unavailable',
        httpStatus: 503
    });
}

function validateCredential(value) {
    if (typeof value !== 'string' || !value || /[\s\0]/u.test(value)) {
        throw failCredentials();
    }
    return value;
}

function generateSignature(apiKey, secret, timestampSeconds) {
    const key = validateCredential(apiKey);
    const signingSecret = validateCredential(secret);
    if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) throw failCredentials();

    // Hotelbeds documents SHA-256 hex of the exact concatenation:
    // API key + secret + current Unix timestamp in seconds (no separators).
    return crypto.createHash('sha256')
        .update(key + signingSecret + String(timestampSeconds), 'utf8')
        .digest('hex');
}

function buildAuthenticationHeaders({ apiKey, secret, timestampSeconds, method, acceptEncoding } = {}) {
    const normalizedMethod = String(method || '').toLowerCase();
    if (!['get', 'post'].includes(normalizedMethod)) throw failCredentials();

    return {
        'Api-key': validateCredential(apiKey),
        'X-Signature': generateSignature(apiKey, secret, timestampSeconds),
        Accept: 'application/json',
        ...(normalizedMethod === 'post'
            ? { 'Accept-Encoding': acceptEncoding || 'gzip', 'Content-Type': 'application/json' }
            : acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {})
    };
}

module.exports = { validateCredential, generateSignature, buildAuthenticationHeaders };