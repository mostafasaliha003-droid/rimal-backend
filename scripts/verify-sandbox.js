const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getReleaseReadiness } = require('../services/releaseReadiness');
const { customerPrice } = require('../services/paymentService');
const ORIGIN = 'https://rimal-api-staging.onrender.com';

async function verifySandbox({ createCheckout = false } = {}) {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.sandbox') });
    const report = getReleaseReadiness();
    if (!report.checkout.ready || report.checkout.mode !== 'sandbox') throw new Error('sandbox_configuration_required');
    const credentials = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../sandbox-access.local.json')));
    if (credentials.url !== ORIGIN) throw new Error('sandbox_origin_mismatch');
    async function request(route, { body, token, key, allowUnavailable = false } = {}) {
        const response = await fetch(`${ORIGIN}/api${route}`, {
            method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(135000),
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(key ? { 'Idempotency-Key': key } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        const result = await response.json();
        if (!response.ok && !(allowUnavailable && response.status === 503)) {
            const code = /^[a-z_]{1,80}$/i.test(result.error || '') ? result.error : 'request_failed';
            throw new Error(`sandbox_http_${response.status}_${code}`);
        }
        return result;
    }
    const health = await request('/v1/health');
    if (health.databaseState !== 1) throw new Error('sandbox_database_unavailable');
    const admin = await request('/v1/admin/login', { body: { email: credentials.adminEmail, password: credentials.adminPassword } });
    const runtime = await request('/v1/admin/readiness', { token: admin.access_token, allowUnavailable: true });
    if (!runtime.checkout?.ready || runtime.checkout.mode !== 'sandbox') throw new Error('sandbox_runtime_not_ready');
    const user = await request('/auth/login', { body: { email: credentials.testEmail, password: credentials.testPassword } });
    const session = await request('/auth/session', { token: user.access_token });
    if (!session.success) throw new Error('sandbox_user_session_unavailable');
    const checkin = new Date(); checkin.setUTCDate(checkin.getUTCDate() + 30);
    const checkout = new Date(checkin); checkout.setUTCDate(checkout.getUTCDate() + 2);
    const criteria = { hid: 10004834, checkin: checkin.toISOString().slice(0, 10), checkout: checkout.toISOString().slice(0, 10),
        guests: [{ adults: 2, children: [] }], residency: 'ae', language: 'en', currency: 'USD' };
    const hotelpage = await request('/search/hotelpage', { body: criteria });
    const hotel = hotelpage.hotel || hotelpage.hotels?.[0];
    const rates = hotelpage.rates || hotel?.rates || [];
    const available = rates.filter(rate => rate.payment_options?.payment_types?.some(option =>
        option.type === 'deposit' && option.currency_code === 'USD' && option.is_need_credit_card_data === false))
        .sort((a, b) => customerPrice(a).amount - customerPrice(b).amount);
    if (!available.length) throw new Error('sandbox_bookable_rate_missing');
    const result = { generatedAt: new Date().toISOString(), origin: ORIGIN, databaseConnected: true,
        authenticated: true, checkoutEnabled: true, availableRates: available.length,
        revision: health.revision, runtimeBlockers: runtime.blockers };
    if (createCheckout) {
        const evidencePath = path.resolve(__dirname, '../logs/sandbox-app-checkout.json');
        // Keep the operation key/payload before sending. An uncertain HTTP
        // outcome is recovered by replaying these exact inputs, never a new key.
        let evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath)) : null;
        if (evidence && evidence.origin !== ORIGIN) throw new Error('sandbox_evidence_origin_invalid');
        if (!evidence) {
            const guests = JSON.parse(process.env.ETG_CERT_GUESTS_JSON).standard_booking;
            const holder = guests[0][0];
            const rate = available[0];
            const price = customerPrice(rate);
            if (price.currency !== 'USD' || price.amount <= 0 || price.amount > 1000) throw new Error('sandbox_test_amount_exceeded');
            evidence = { origin: ORIGIN, idempotencyKey: crypto.randomUUID(), payload: {
                ...criteria, book_hash: rate.book_hash, roomName: rate.room_name, hotelName: hotel?.name || 'ETG Sandbox Hotel',
                total: price.amount, currency: price.currency,
                guest: { firstName: holder.first_name, lastName: holder.last_name,
                    email: process.env.ETG_CERT_GUEST_EMAIL, phone: process.env.ETG_CERT_GUEST_PHONE },
                rooms: guests.map(room => ({ guests: room.map(guest => ({ firstName: guest.first_name,
                    lastName: guest.last_name, is_child: guest.is_child === true, ...(guest.is_child ? { age: guest.age } : {}) })) }))
            } };
            fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
            fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
        }
        const attempt = await request('/payment/ziina/intent', { body: evidence.payload, key: evidence.idempotencyKey, token: user.access_token });
        fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, ...attempt }, null, 2), { mode: 0o600 });
        result.paymentStatus = attempt.status;
        result.paymentReference = attempt.reference;
        result.testPaymentUrlCreated = Boolean(attempt.payment_url);
    }
    return result;
}

if (require.main === module) verifySandbox({ createCheckout: process.argv.includes('--create-test-checkout') })
    .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
        console.error(/^[a-z_\d]+$/i.test(error.message) ? error.message : 'sandbox_verification_unavailable');
        process.exitCode = 1;
    });

module.exports = { verifySandbox };
