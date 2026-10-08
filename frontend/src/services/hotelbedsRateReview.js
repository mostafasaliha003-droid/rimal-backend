const PUBLIC_OFFER_ID_PATTERN = /^[a-f\d]{64}$/i;
const TERMS_VERSION_PATTERN = /^[a-f\d]{64}$/i;
const REVIEW_ID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const AED_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const RATE_REVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_REVIEW_RESPONSE_BYTES = 128 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIVATE_FIELD_NAMES = new Set([
    'opaquetoken',
    'providerratekey',
    'ratekey',
    'bookingidentity',
    'bookingterms',
    'rateidentity',
    'rateterms',
    'checkratesnapshot'
]);
const REVIEW_IDEMPOTENCY_STORAGE_PREFIX = 'remal_hotelbeds_rate_review_idempotency:';

function validTime(value) {
    const time = value instanceof Date ? value.getTime()
        : typeof value === 'number' ? value
            : typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? time : null;
}

function assertNoPrivateFields(value, seen = new Set()) {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) throw new Error('hotelbeds_rate_review_response_invalid');
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.replace(/[^a-z\d]/gi, '').toLowerCase();
        if (PRIVATE_FIELD_NAMES.has(normalizedKey)) {
            throw new Error('hotelbeds_rate_review_private_field_exposed');
        }
        assertNoPrivateFields(child, seen);
    }
    seen.delete(value);
}

function safeClone(value) {
    if (value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        throw new Error('hotelbeds_rate_review_response_invalid');
    }
}

function validPublicReviewOffer(offer, publicOfferId, termsVersion) {
    return Boolean(offer && typeof offer === 'object' && !Array.isArray(offer)
        && offer.provider === 'hotelbeds'
        && offer.publicOfferId === publicOfferId
        && offer.termsVersion === termsVersion
        && offer.payment?.type === 'AT_HOTEL'
        && ['BOOKABLE', 'RECHECK'].includes(offer.availability?.rateType)
        && offer.price?.customerDisplay
        && typeof offer.price.customerDisplay.amount === 'string'
        && /^\d+(?:\.\d+)?$/.test(offer.price.customerDisplay.amount)
        && typeof offer.price.customerDisplay.currency === 'string'
        && CURRENCY_PATTERN.test(offer.price.customerDisplay.currency)
        && validDateOnly(offer.stay?.checkIn)
        && validDateOnly(offer.stay?.checkOut)
        && offer.stay.checkOut > offer.stay.checkIn
        && offer.occupancy && Number.isSafeInteger(offer.occupancy.rooms)
        && Number.isSafeInteger(offer.occupancy.adults)
        && Number.isSafeInteger(offer.occupancy.children));
}

function validDateOnly(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validate the public, short-lived response returned by POST /offers/review. */
export function validateRateReviewResponse(response, { now = Date.now() } = {}) {
    if (!response || typeof response !== 'object' || Array.isArray(response)
        || response.success !== true
        || typeof response.reviewId !== 'string' || !REVIEW_ID_PATTERN.test(response.reviewId)
        || typeof response.publicOfferId !== 'string' || !PUBLIC_OFFER_ID_PATTERN.test(response.publicOfferId)
        || typeof response.sourceTermsVersion !== 'string' || !TERMS_VERSION_PATTERN.test(response.sourceTermsVersion)
        || typeof response.termsVersion !== 'string' || !TERMS_VERSION_PATTERN.test(response.termsVersion)
        || response.checkRateRequests !== 1 || typeof response.cached !== 'boolean') {
        throw new Error('hotelbeds_rate_review_response_invalid');
    }
    const nowMs = validTime(now);
    const expiresAtMs = validTime(response.expiresAt);
    if (nowMs === null || expiresAtMs === null || expiresAtMs <= nowMs
        || expiresAtMs - nowMs > RATE_REVIEW_TTL_MS
        || !validPublicReviewOffer(response.offer, response.publicOfferId, response.termsVersion)) {
        throw new Error('hotelbeds_rate_review_response_invalid');
    }

    assertNoPrivateFields(response);
    const serialized = JSON.stringify(response);
    if (new TextEncoder().encode(serialized).byteLength > MAX_REVIEW_RESPONSE_BYTES) {
        throw new Error('hotelbeds_rate_review_response_too_large');
    }
    return response;
}

/** Ensure a valid review belongs to the exact offer selected before review. */
export function validateRateReviewForSelectedOffer(response, selectedOffer, options = {}) {
    validateRateReviewResponse(response, options);
    const selectedRateType = selectedOffer?.availability?.rateType || selectedOffer?.rateType;
    if (!canStartDirectHotelbedsBooking(selectedOffer)
        || response.publicOfferId !== selectedOffer.publicOfferId
        || response.sourceTermsVersion !== selectedOffer.termsVersion
        || response.offer.payment?.type !== 'AT_HOTEL'
        || selectedRateType && response.offer.availability?.rateType !== selectedRateType
        || normalizeDecimal(response.offer.price.customerDisplay.amount)
            !== normalizeDecimal(selectedOffer.price.amount)
        || response.offer.price.customerDisplay.currency !== selectedOffer.price.currency
        || response.offer.occupancy.rooms !== selectedOffer.occupancy.rooms
        || response.offer.occupancy.adults !== selectedOffer.occupancy.adults
        || response.offer.occupancy.children !== selectedOffer.occupancy.children
        || response.offer.stay?.checkIn !== selectedOffer.stay.checkIn
        || response.offer.stay?.checkOut !== selectedOffer.stay.checkOut) {
        throw new Error('hotelbeds_rate_review_offer_mismatch');
    }
    return response;
}

function normalizeDecimal(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
    if (!match) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Return the offer-scoped sessionStorage key used to retain review idempotency. */
export function reviewIdempotencyStorageKey(publicOfferId) {
    return typeof publicOfferId === 'string' && PUBLIC_OFFER_ID_PATTERN.test(publicOfferId)
        ? `${REVIEW_IDEMPOTENCY_STORAGE_PREFIX}${publicOfferId}` : null;
}

export function directBookingAttemptStorageKey(publicOfferId) {
    return typeof publicOfferId === 'string' && PUBLIC_OFFER_ID_PATTERN.test(publicOfferId)
        ? `remal_hotelbeds_direct_booking_started:${publicOfferId}` : null;
}

/** Validate client-visible direct-booking eligibility; the server remains authoritative. */
export function canStartDirectHotelbedsBooking(offer) {
    return Boolean(offer && typeof offer === 'object' && !Array.isArray(offer)
        && offer.provider === 'hotelbeds'
        && offer.mock !== true
        && offer.paymentFlow === 'PAY_AT_PROPERTY'
        && ['BOOKABLE', 'RECHECK'].includes(offer.availability?.rateType || offer.rateType)
        && typeof offer.publicOfferId === 'string' && PUBLIC_OFFER_ID_PATTERN.test(offer.publicOfferId)
        && typeof offer.termsVersion === 'string' && TERMS_VERSION_PATTERN.test(offer.termsVersion)
        && validDateOnly(offer.stay?.checkIn) && validDateOnly(offer.stay?.checkOut)
        && offer.stay.checkOut > offer.stay.checkIn
        && typeof offer.price?.amount === 'string' && AED_AMOUNT_PATTERN.test(offer.price.amount)
        && offer.price.currency === 'AED'
        && offer.occupancy?.rooms === 1
        && Number.isSafeInteger(offer.occupancy?.adults)
        && offer.occupancy.adults >= 1 && offer.occupancy.adults <= 2
        && offer.occupancy.children === 0);
}

export function hotelbedsDirectUnavailableReason(offer) {
    if (!offer || offer.provider !== 'hotelbeds' || offer.mock === true
        || offer.paymentFlow !== 'PAY_AT_PROPERTY'
        || !['BOOKABLE', 'RECHECK'].includes(offer.availability?.rateType || offer.rateType)
        || typeof offer.publicOfferId !== 'string' || !PUBLIC_OFFER_ID_PATTERN.test(offer.publicOfferId)
        || typeof offer.termsVersion !== 'string' || !TERMS_VERSION_PATTERN.test(offer.termsVersion)
        || !validDateOnly(offer.stay?.checkIn) || !validDateOnly(offer.stay?.checkOut)
        || offer.stay.checkOut <= offer.stay.checkIn
        || typeof offer.price?.amount !== 'string' || !AED_AMOUNT_PATTERN.test(offer.price.amount)
        || offer.price.currency !== 'AED') return 'direct_booking_unsupported';
    if (offer.occupancy?.rooms !== 1
        || !Number.isSafeInteger(offer.occupancy?.adults)
        || offer.occupancy.adults < 1 || offer.occupancy.adults > 2
        || offer.occupancy.children !== 0) return 'direct_occupancy_unsupported';
    return null;
}

/** Project the reviewed offer to display-only data and derive its remaining consent window. */
export function normalizeReviewOfferForDisplay(review, { now = Date.now() } = {}) {
    validateRateReviewResponse(review, { now });
    const offer = review.offer;
    const expiresAtMs = validTime(review.expiresAt);
    const nowMs = validTime(now);
    const reviewOffer = {
        publicOfferId: review.publicOfferId,
        sourceTermsVersion: review.sourceTermsVersion,
        termsVersion: review.termsVersion,
        reviewId: review.reviewId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresInSeconds: Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000)),
        checkRateRequests: review.checkRateRequests,
        cached: review.cached,
        hotel: safeClone(offer.hotel),
        room: safeClone(offer.room),
        stay: safeClone(offer.stay),
        occupancy: safeClone(offer.occupancy),
        price: safeClone(offer.price.customerDisplay),
        board: safeClone(offer.board),
        availability: safeClone(offer.availability),
        payment: safeClone(offer.payment),
        cancellation: safeClone(offer.cancellation),
        rateComments: safeClone(offer.rateComments || []),
        contractTerms: safeClone(offer.contractTerms),
        taxes: safeClone(offer.taxes),
        promotions: safeClone(offer.promotions || []),
        checkRateTerms: safeClone(offer.checkRateTerms)
    };
    assertNoPrivateFields(reviewOffer);
    return reviewOffer;
}

export function isValidReviewIdempotencyKey(value) {
    return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}