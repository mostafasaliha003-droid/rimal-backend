const crypto = require('node:crypto');
const CheckoutSession = require('../models/CheckoutSession');
const defaultOfferCacheService = require('./offerCacheService');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const { hotelbedsScopeFrom, ownerSubjectFrom, sameHotelbedsScope } = require('./hotelbedsScope');
const { validOfferTermsVersion, normalizeTermsConsent } = require('./offerTermsVersion');

const CHECKOUT_GATES = Object.freeze([
    'HOTELBEDS_MOCK_DATABASE_ENABLED',
    'HOTELBEDS_PREPAID_CHECKOUT_ENABLED',
    'HOTELBEDS_PREPAID_CHECKOUT_APPROVED',
    'HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED',
    'HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED'
]);

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function encryptionKey(env) {
    const raw = env.PAYMENT_BOOKING_ENCRYPTION_KEY || '';
    if (!/^[a-f\d]{64}$/i.test(raw)) throw fail('checkout_encryption_unavailable', 503);
    return Buffer.from(raw, 'hex');
}

function encryptGuestDetails(details, env = process.env) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(env), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') };
}

function decryptGuestDetails(envelope, env = process.env) {
    if (!envelope || !/^[a-f\d]{24}$/i.test(envelope.iv || '')
        || !/^[a-f\d]{32}$/i.test(envelope.tag || '')
        || typeof envelope.ciphertext !== 'string') throw fail('checkout_guest_details_unavailable', 503);
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(envelope.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
            decipher.final()
        ]).toString('utf8');
        return JSON.parse(plaintext);
    } catch {
        throw fail('checkout_guest_details_unavailable', 503);
    }
}

function validText(value, code, maxLength = 80) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength
        || /[\u0000-\u001f\u007f]/.test(value)) throw fail(code);
    return value.trim();
}

function sanitizeGuestDetails(input, offer) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('booking_guest_details_invalid');
    const firstName = validText(input.firstName, 'booking_guest_name_invalid');
    const lastName = validText(input.lastName, 'booking_guest_name_invalid');
    const email = validText(input.email, 'booking_guest_email_invalid', 254);
    const phone = typeof input.phone === 'string' && input.phone.trim()
        ? validText(input.phone, 'booking_guest_phone_invalid', 40) : '';
    if (!/^\S+@\S+\.\S+$/.test(email) || offer.roomCount !== 1 || offer.childCount !== 0
        || !Number.isSafeInteger(offer.adultCount) || offer.adultCount < 1) {
        throw fail('booking_guest_details_invalid');
    }
    const roomGuests = input.rooms?.[0]?.guests;
    if (!Array.isArray(input.rooms) || input.rooms.length !== 1
        || !Array.isArray(roomGuests) || roomGuests.length !== offer.adultCount
        || roomGuests.some(person => person?.is_child === true)) {
        throw fail('hotelbeds_booking_occupancy_unsupported', 400);
    }
    const guests = roomGuests.map((person, index) => ({
        firstName: index === 0 ? firstName : validText(person?.firstName, 'booking_guest_name_invalid'),
        lastName: index === 0 ? lastName : validText(person?.lastName, 'booking_guest_name_invalid'),
        is_child: false
    }));
    return { firstName, lastName, email, phone, rooms: [{ guests }] };
}

function minorUnits(amount) {
    if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount)) {
        throw fail('checkout_offer_price_unavailable', 409);
    }
    const [whole, fraction = ''] = amount.split('.');
    const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('checkout_offer_price_invalid', 409);
    return Number(minor);
}

function fingerprint(value, env) {
    return crypto.createHmac('sha256', encryptionKey(env)).update(value).digest('hex');
}

function publicSession(session) {
    return {
        sessionId: session.sessionId,
        status: session.status,
        totalAmount: session.totalAmount,
        currency: session.currency,
        ...(session.status === 'awaiting_payment' && session.mockPaymentUrl
            ? { payment_url: session.mockPaymentUrl } : {})
    };
}

function sessionAccessToken(session, env) {
    return crypto.createHmac('sha256', encryptionKey(env))
        .update(`hotelbeds-checkout-session-v2:${session.realm}:${session.environment}:${session.accountId}:${session.ownerSubject}:${session.sessionId}:${session.requestFingerprint}`)
        .digest('hex');
}

function checkoutSessionScopeFilter(context, idempotencyKeyHash) {
    return { ...context, idempotencyKeyHash };
}

function createCheckoutSessionService({
    Model = CheckoutSession,
    offerCacheService = defaultOfferCacheService.hotelbeds,
    env = process.env,
    now = () => new Date(),
    createSessionId = () => crypto.randomUUID(),
    testOnly = false,
    database = hotelbedsMockDatabase,
    createPaymentIntent = ({ sessionId }) => ({
        id: `mock_${sessionId.replaceAll('-', '')}`,
        paymentUrl: `https://pay.example.test/mock/${sessionId}`
    }),
    ensureDatabaseReady: testEnsureDatabaseReady
} = {}) {
    const ensureDatabaseReady = async () => {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        await database.ensureModelConnected(Model, { env, errorCode: 'checkout_database_unavailable' });
    };
    if (!Model || typeof Model.create !== 'function' || typeof Model.findOne !== 'function'
        || typeof Model.findOneAndUpdate !== 'function'
        || !offerCacheService || typeof offerCacheService.getCheckoutOffer !== 'function'
        || typeof now !== 'function' || typeof createSessionId !== 'function'
        || typeof createPaymentIntent !== 'function' || !database
        || testOnly && typeof testEnsureDatabaseReady !== 'function'
        || testOnly && process.env.NODE_ENV === 'production'
        || !testOnly && testEnsureDatabaseReady !== undefined) {
        throw new TypeError('checkout_session_dependencies_invalid');
    }

    async function assertReady() {
        if (CHECKOUT_GATES.some(gate => env[gate] !== 'true')) throw fail('hotelbeds_prepaid_checkout_disabled', 503);
        if (env.HOTELBEDS_ENABLED !== 'true' || String(env.HOTELBEDS_ENV || '').toLowerCase() !== 'test') {
            throw fail('hotelbeds_test_environment_required', 503);
        }
        await ensureDatabaseReady();
    }

    function trustedScope() {
        try { return hotelbedsScopeFrom(env, { testOnly }); }
        catch (error) { throw fail(error.code || 'checkout_scope_unavailable', error.httpStatus || 503); }
    }

    function trustedContext(ownerSubject) {
        try { return { ...trustedScope(), ownerSubject: ownerSubjectFrom(ownerSubject, { testOnly }) }; }
        catch (error) { throw fail(error.code || 'checkout_scope_unavailable', error.httpStatus || 503); }
    }

    async function createSession({ publicOfferId, guestDetails, idempotencyKey, ownerSubject,
        termsAccepted, acceptedTermsVersion } = {}) {
        await assertReady();
        const context = trustedContext(ownerSubject);
        if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
            throw fail('invalid_idempotency_key');
        }
        if (typeof publicOfferId !== 'string' || !/^[a-f\d]{64}$/i.test(publicOfferId)) {
            throw fail('offer_cache_public_id_invalid', 404);
        }
        const idempotencyKeyHash = fingerprint(JSON.stringify({ ...context, idempotencyKey }), env);
        const existing = await Model.findOne(checkoutSessionScopeFilter(context, idempotencyKeyHash))
            .select('+idempotencyKeyHash +requestFingerprint +mockPaymentUrl +acceptedTermsVersion').lean();
        if (existing) {
            if (termsAccepted !== true || !validOfferTermsVersion(acceptedTermsVersion)
                || acceptedTermsVersion !== existing.acceptedTermsVersion) {
                throw fail('checkout_terms_acceptance_required', 409);
            }
            const existingGuests = sanitizeGuestDetails(guestDetails, {
                roomCount: existing.occupancy?.rooms,
                adultCount: existing.occupancy?.adults,
                childCount: existing.occupancy?.children
            });
            if (!sameHotelbedsScope(existing, context) || existing.ownerSubject !== context.ownerSubject) {
                throw fail('checkout_session_not_found', 404);
            }
            const requestFingerprint = fingerprint(JSON.stringify({ ...context, publicOfferId,
                acceptedTermsVersion, guests: existingGuests }), env);
            if (existing.requestFingerprint !== requestFingerprint) throw fail('checkout_idempotency_conflict', 409);
            return { ...publicSession(existing), access_token: sessionAccessToken(existing, env) };
        }

        const offer = await offerCacheService.getCheckoutOffer(publicOfferId);
        if (!offer || offer.provider !== 'hotelbeds') throw fail('checkout_offer_not_found', 404);
        if (offer.origin !== 'mock_fixture') throw fail('checkout_live_offer_forbidden', 409);
        if (!sameHotelbedsScope(offer, context)) throw fail('checkout_offer_scope_mismatch', 409);
        let termsConsent;
        try {
            termsConsent = normalizeTermsConsent({
                termsAccepted,
                acceptedTermsVersion,
                expectedTermsVersion: offer.termsVersion,
                now
            });
        } catch {
            throw fail('checkout_terms_acceptance_required', 409);
        }
        if (offer.paymentType !== 'AT_WEB') throw fail('checkout_payment_flow_unsupported', 409);
        if (!['BOOKABLE', 'RECHECK'].includes(offer.rateType)) throw fail('checkout_rate_not_bookable', 409);
        if (typeof offer.opaqueToken !== 'string' || !offer.opaqueToken.trim()) throw fail('checkout_offer_reference_missing', 409);
        if (!offer.lockedSellAmount || offer.lockedSellCurrency !== 'AED') {
            throw fail('checkout_offer_price_unavailable', 409);
        }
        if (!Number.isSafeInteger(offer.roomCount) || offer.roomCount !== 1
            || !Number.isSafeInteger(offer.adultCount) || offer.adultCount < 1 || offer.childCount !== 0) {
            throw fail('hotelbeds_booking_occupancy_unsupported', 409);
        }
        const guests = sanitizeGuestDetails(guestDetails, offer);
        const totalAmount = minorUnits(offer.lockedSellAmount);
        if (typeof offer.lockedNetPrice !== 'string' || !/^\d+(?:\.\d+)?$/.test(offer.lockedNetPrice)
            || typeof offer.currency !== 'string' || !/^[A-Z]{3}$/.test(offer.currency)
            || typeof offer.providerHotelCode !== 'string' || !offer.providerHotelCode.trim()) {
            throw fail('checkout_offer_constraints_invalid', 409);
        }
        const sessionId = createSessionId();
        if (typeof sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(sessionId)) {
            throw fail('checkout_session_id_invalid', 503);
        }
        let intent;
        try {
            intent = await createPaymentIntent({ sessionId, amount: totalAmount, currency: 'AED', test: true });
        } catch {
            throw fail('mock_payment_intent_unavailable', 503);
        }
        if (!intent || typeof intent.id !== 'string' || !/^mock_[a-f\d]{32}$/i.test(intent.id)
            || typeof intent.paymentUrl !== 'string'
            || intent.id !== `mock_${sessionId.replaceAll('-', '')}`
            || intent.paymentUrl !== `https://pay.example.test/mock/${sessionId}`) {
            throw fail('mock_payment_intent_invalid', 503);
        }
        const paymentUrl = new URL(intent.paymentUrl);
        if (paymentUrl.protocol !== 'https:' || paymentUrl.hostname !== 'pay.example.test'
            || paymentUrl.username || paymentUrl.password) throw fail('mock_payment_intent_invalid', 503);
        const requestFingerprint = fingerprint(JSON.stringify({ ...context, publicOfferId,
            acceptedTermsVersion: termsConsent.acceptedTermsVersion, guests }), env);
        const createdAt = new Date(now());
        const offerExpiresAt = new Date(offer.expiresAt);
        if (Number.isNaN(createdAt.getTime()) || Number.isNaN(offerExpiresAt.getTime())
            || offerExpiresAt <= createdAt) throw fail('checkout_offer_expired', 409);

        let session;
        try {
            session = await Model.create({
                ...context,
                sessionId,
                publicOfferId: offer.publicOfferId,
                offerExpiresAt,
                provider: 'hotelbeds',
                offerOrigin: offer.origin,
                ...termsConsent,
                paymentProvider: 'mock',
                paymentType: offer.paymentType,
                acceptedTermsVersion: offer.termsVersion,
                providerOfferRef: offer.opaqueToken,
                providerHotelCode: offer.providerHotelCode,
                totalAmount,
                currency: 'AED',
                guestDetailsEncrypted: encryptGuestDetails(guests, env),
                rateType: offer.rateType,
                lockedNetPrice: offer.lockedNetPrice,
                lockedNetCurrency: offer.currency,
                bookingIdentity: offer.bookingIdentity,
                bookingTerms: offer.bookingTerms,
                occupancy: { rooms: offer.roomCount, adults: offer.adultCount, children: offer.childCount },
                idempotencyKeyHash,
                requestFingerprint,
                paymentIntentId: intent.id,
                mockPaymentUrl: intent.paymentUrl,
                status: 'awaiting_payment',
                createdAt
            });
        } catch (error) {
            if (error.code !== 11000) throw error;
            const duplicate = await Model.findOne(checkoutSessionScopeFilter(context, idempotencyKeyHash))
                .select('+idempotencyKeyHash +requestFingerprint +mockPaymentUrl +acceptedTermsVersion').lean();
            if (duplicate && sameHotelbedsScope(duplicate, context) && duplicate.ownerSubject === context.ownerSubject
                && duplicate.requestFingerprint === requestFingerprint) {
                return { ...publicSession(duplicate), access_token: sessionAccessToken(duplicate, env) };
            }
            throw fail('checkout_idempotency_conflict', 409);
        }

        const created = session?.toObject ? session.toObject() : session;
        return {
            ...publicSession({ ...created, mockPaymentUrl: intent.paymentUrl }),
            access_token: sessionAccessToken({ ...created, requestFingerprint }, env)
        };
    }

    async function getSession(sessionId, accessToken) {
        await ensureDatabaseReady();
        const context = trustedScope();
        if (typeof sessionId !== 'string' || !/^[a-f\d-]{36}$/i.test(sessionId)) {
            throw fail('checkout_session_not_found', 404);
        }
        if (typeof accessToken !== 'string' || !/^[a-f\d]{64}$/i.test(accessToken)) {
            throw fail('checkout_session_not_found', 404);
        }
        const session = await Model.findOne({ sessionId, ...context }).select('+mockPaymentUrl +requestFingerprint').lean();
        if (!session || !sameHotelbedsScope(session, context)
            || typeof session.ownerSubject !== 'string' || !session.ownerSubject) throw fail('checkout_session_not_found', 404);
        const expected = Buffer.from(sessionAccessToken(session, env), 'hex');
        const supplied = Buffer.from(accessToken, 'hex');
        if (!crypto.timingSafeEqual(expected, supplied)) throw fail('checkout_session_not_found', 404);
        return publicSession(session);
    }

    return { createSession, getSession, getScope: trustedScope };
}

const defaultService = createCheckoutSessionService();

module.exports = {
    CHECKOUT_GATES,
    createCheckoutSessionService,
    encryptGuestDetails,
    decryptGuestDetails,
    sanitizeGuestDetails,
    minorUnits,
    publicSession,
    sessionAccessToken,
    checkoutSessionScopeFilter,
    createSession: input => defaultService.createSession(input),
    getSession: (sessionId, accessToken) => defaultService.getSession(sessionId, accessToken)
};