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

module.exports = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin) || origin === 'null') {
            callback(null, true);
        } else {
            const error = new Error('CORS origin is not allowed.');
            error.status = 403;
            callback(error);
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization', 'Idempotency-Key'],
    credentials: true
};