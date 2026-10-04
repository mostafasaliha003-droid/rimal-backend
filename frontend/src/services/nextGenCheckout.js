const PUBLIC_OFFER_ID_PATTERN = /^[a-f\d]{64}$/i;
const SESSION_ID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const ACCESS_TOKEN_PATTERN = /^[a-f\d]{64}$/i;
const TERMS_VERSION_PATTERN = /^[a-f\d]{64}$/i;
const AED_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export function validateUnifiedSearchResponse(response) {
    if (!response || typeof response !== 'object' || response.schemaVersion !== 2
        || response.currency !== 'AED' || !Array.isArray(response.hotels)) {
        throw new Error('aggregate_response_invalid');
    }
    for (const hotel of response.hotels) {
        if (!hotel || !Array.isArray(hotel.offers)) throw new Error('aggregate_response_invalid');
        for (const offer of hotel.offers) {
            if (!offer || !offer.price || typeof offer.price.amount !== 'string'
                || offer.price.currency !== 'AED' || !AED_AMOUNT_PATTERN.test(offer.price.amount)) {
                throw new Error('aggregate_response_invalid');
            }
            if (offer.provider === 'hotelbeds' && offer.publicOfferId !== null
                && (!PUBLIC_OFFER_ID_PATTERN.test(offer.publicOfferId || '')
                    || !TERMS_VERSION_PATTERN.test(offer.termsVersion || ''))) {
                throw new Error('aggregate_response_invalid');
            }
        }
    }
    return response;
}

export function formatAedPrice(amount, currency = 'AED') {
    if (currency !== 'AED' || typeof amount !== 'string' || !AED_AMOUNT_PATTERN.test(amount)) {
        return null;
    }
    return `AED ${amount}`;
}

export function canStartPrepaidCheckout(offer) {
    return Boolean(offer && offer.provider === 'hotelbeds' && offer.paymentFlow === 'PAY_NOW'
        && typeof offer.publicOfferId === 'string'
        && PUBLIC_OFFER_ID_PATTERN.test(offer.publicOfferId)
        && TERMS_VERSION_PATTERN.test(offer.termsVersion || '')
        && formatAedPrice(offer.price?.amount, offer.price?.currency));
}

export function canCreateHotelbedsCheckout(offer) {
    return Boolean(canStartPrepaidCheckout(offer)
        && offer.occupancy?.rooms === 1
        && Number.isSafeInteger(offer.occupancy?.adults)
        && offer.occupancy.adults >= 1
        && offer.occupancy.children === 0);
}

export function hotelbedsCheckoutUnavailableReason(offer) {
    if (!canStartPrepaidCheckout(offer)) return 'payment_flow_unsupported';
    if (offer.occupancy?.rooms !== 1 || !Number.isSafeInteger(offer.occupancy?.adults)
        || offer.occupancy.adults < 1 || offer.occupancy.children !== 0) return 'occupancy_unsupported';
    return null;
}

export function normalizeCheckoutGuestDetails({ firstName, lastName, email, phone, additionalGuests = [] }) {
    const primaryFirstName = typeof firstName === 'string' ? firstName.trim() : '';
    const primaryLastName = typeof lastName === 'string' ? lastName.trim() : '';
    const adults = [
        { firstName: primaryFirstName, lastName: primaryLastName, is_child: false },
        ...additionalGuests.map(guest => ({
            firstName: typeof guest.firstName === 'string' ? guest.firstName.trim() : '',
            lastName: typeof guest.lastName === 'string' ? guest.lastName.trim() : '',
            is_child: false
        }))
    ];
    return {
        firstName: primaryFirstName,
        lastName: primaryLastName,
        email: typeof email === 'string' ? email.trim() : '',
        phone: typeof phone === 'string' ? phone.trim() : '',
        rooms: [{ guests: adults }]
    };
}

export function checkoutIdempotencyStorageKey(publicOfferId) {
    return typeof publicOfferId === 'string' && PUBLIC_OFFER_ID_PATTERN.test(publicOfferId)
        ? `remal_nextgen_checkout_idempotency:${publicOfferId}` : null;
}

export function mapCheckoutStatus(status) {
    switch (status) {
        case 'awaiting_payment':
            return 'verifying_payment';
        case 'payment_verified':
        case 'booking_processing':
        case 'booking_pending':
            return 'booking_pending';
        case 'confirmed':
            return 'confirmed';
        case 'refund_review':
            return 'refund_review';
        case 'outcome_unknown':
        case 'manual_review':
            return 'manual_review';
        default:
            return 'manual_review';
    }
}

export function validateCheckoutSessionResponse(response) {
    if (!response || response.success !== true
        || typeof response.sessionId !== 'string' || !SESSION_ID_PATTERN.test(response.sessionId)
        || typeof response.access_token !== 'string' || !ACCESS_TOKEN_PATTERN.test(response.access_token)
        || response.currency !== 'AED'
        || !Number.isSafeInteger(response.totalAmount) || response.totalAmount < 1
        || response.status !== 'awaiting_payment'
        || typeof response.payment_url !== 'string') {
        throw new Error('checkout_session_response_invalid');
    }
    const paymentUrl = new URL(response.payment_url);
    if (paymentUrl.protocol !== 'https:' || paymentUrl.origin !== 'https://pay.example.test'
        || paymentUrl.username || paymentUrl.password) {
        throw new Error('checkout_payment_url_invalid');
    }
    return { ...response, payment_url: paymentUrl.href };
}

export function sessionAccessTokenFromStorage(sessionId, storage = globalThis.sessionStorage) {
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId) || !storage) return null;
    try {
        const stored = JSON.parse(storage.getItem(`remal_nextgen_checkout:${sessionId}`) || 'null');
        return typeof stored?.accessToken === 'string' && ACCESS_TOKEN_PATTERN.test(stored.accessToken)
            ? stored.accessToken : null;
    } catch {
        return null;
    }
}

export function sessionStorageKey(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return null;
    return `remal_nextgen_checkout:${sessionId}`;
}

export function persistedAccessToken(sessionId, queryToken, storage = globalThis.sessionStorage) {
    const storageKey = sessionStorageKey(sessionId);
    if (!storageKey || !storage) return null;
    const persistedToken = sessionAccessTokenFromStorage(sessionId, storage);
    if (!persistedToken) return null;
    return queryToken === null || queryToken === undefined ? persistedToken
        : typeof queryToken === 'string' && ACCESS_TOKEN_PATTERN.test(queryToken)
            && queryToken === persistedToken ? persistedToken : null;
}

export function privatePaymentStatusUrl(sessionId, storage = globalThis.sessionStorage) {
    const storageKey = sessionStorageKey(sessionId);
    if (!storageKey || !storage) throw new Error('checkout_session_storage_unavailable');
    let credentials;
    try { credentials = JSON.parse(storage.getItem(storageKey) || 'null'); } catch { credentials = null; }
    if (typeof credentials?.accessToken !== 'string' || !ACCESS_TOKEN_PATTERN.test(credentials.accessToken)) {
        throw new Error('checkout_session_storage_unavailable');
    }
    const url = new URL('/payment-status', window.location.origin);
    url.searchParams.set('sessionId', sessionId);
    return url.href;
}

export function acceptMockPaymentRedirect(paymentUrl, returnUrl) {
    const payment = new URL(paymentUrl);
    const status = new URL(returnUrl);
    if (payment.origin !== 'https://pay.example.test' || payment.protocol !== 'https:'
        || !/^\/mock\/[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(payment.pathname)
        || status.origin !== window.location.origin || status.pathname !== '/payment-status'
        || status.searchParams.has('accessToken')) {
        throw new Error('checkout_return_url_invalid');
    }
    const mockPayment = new URL('/mock-payment', window.location.origin);
    mockPayment.searchParams.set('sessionId', payment.pathname.split('/').at(-1));
    mockPayment.searchParams.set('return_url', status.href);
    return mockPayment.href;
}