const allowedOrigins = new Set([
    'https://remalbookings.com',
    'https://www.remalbookings.com',
    'http://localhost:10000',
    'http://127.0.0.1:10000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5178',
    'http://127.0.0.1:5178',
    'https://rimal-api.onrender.com',
    'https://mostafasaliha003-droid.github.io'
]);

// Set only on the isolated Staging API, e.g.
// STAGING_FRONTEND_ORIGIN=https://staging.remalbookings.com
const stagingFrontendOrigin = (() => {
    const configured = String(process.env.STAGING_FRONTEND_ORIGIN || '').trim();
    if (!configured) return null;
    try {
        const parsed = new URL(configured);
        if (parsed.protocol !== 'https:' || parsed.origin !== configured.replace(/\/$/, '')
            || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
        return parsed.origin;
    } catch {
        return null;
    }
})();

if (stagingFrontendOrigin) allowedOrigins.add(stagingFrontendOrigin);

module.exports = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
            callback(null, true);
        } else {
            const error = new Error('CORS origin is not allowed.');
            error.status = 403;
            callback(error);
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true
};
