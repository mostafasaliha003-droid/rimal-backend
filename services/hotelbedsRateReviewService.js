const crypto = require('node:crypto');
const HotelbedsRateReview = require('../models/HotelbedsRateReview');
const hotelbedsMockDatabase = require('./hotelbedsMockDatabase');
const defaultOfferCacheService = require('./offerCacheService').hotelbeds;
const defaultClient = require('./hotelbedsClient');
const rateCheck = require('./hotelbedsRateCheckService');
const { normalizeHotelbedsRateComments } = require('./hotelbedsRateComments');
const { hotelbedsScopeFrom, ownerSubjectFrom } = require('./hotelbedsScope');
const { offerTermsVersion, validOfferTermsVersion } = require('./offerTermsVersion');

const RATE_REVIEW_TTL_MS = 5 * 60 * 1000;
const REVIEW_RECORD_TTL_MS = 60 * 60 * 1000;
const MAX_REVIEW_RESPONSE_BYTES = 128 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function fail(code, httpStatus = 503, cause) {
    return Object.assign(new Error(code), { code, httpStatus, ...(cause ? { cause } : {}) });
}

function decimalKey(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match || text.length > 80) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function createHotelbedsRateReviewService({
    Model = HotelbedsRateReview,
    database = hotelbedsMockDatabase,
    client = defaultClient,
    offerCacheService = defaultOfferCacheService,
    env = process.env,
    now = () => new Date(),
    createReviewId = () => crypto.randomUUID(),
    testOnly = false,
    ensureDatabaseReady: testEnsureDatabaseReady
} = {}) {
    if (!Model || typeof Model.create !== 'function' || typeof Model.findOne !== 'function'
        || typeof Model.findOneAndUpdate !== 'function' || !database
        || !client || typeof client.checkRates !== 'function'
        || !offerCacheService || typeof offerCacheService.getRateReviewOffer !== 'function'
        || typeof now !== 'function' || typeof createReviewId !== 'function'
        || testOnly && typeof testEnsureDatabaseReady !== 'function'
        || testOnly && process.env.NODE_ENV === 'production'
        || !testOnly && testEnsureDatabaseReady !== undefined) {
        throw new TypeError('hotelbeds_rate_review_dependencies_invalid');
    }

    let readyPromise;
    async function ensureReady() {
        if (testOnly) {
            await testEnsureDatabaseReady();
            return;
        }
        if (!readyPromise) {
            readyPromise = Promise.resolve().then(async () => {
                await database.ensureModelConnected(Model, {
                    env,
                    expectedConnection: database.connection,
                    errorCode: 'hotelbeds_rate_review_database_unavailable'
                });
                if (typeof Model.init !== 'function') throw new Error('model_indexes_unavailable');
                await Model.init();
            }).catch(error => {
                readyPromise = null;
                throw fail('hotelbeds_rate_review_database_unavailable', 503, error);
            });
        }
        await readyPromise;
    }

    function currentTime() {
        const at = new Date(now());
        if (Number.isNaN(at.getTime())) throw fail('hotelbeds_rate_review_clock_invalid');
        return at;
    }

    function assertEnabled() {
        if (env.HOTELBEDS_ENABLED !== 'true'
            || String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
            throw fail('hotelbeds_test_environment_required');
        }
        if (!testOnly && (env.HOTELBEDS_RATE_REVIEW_ENABLED !== 'true'
            || env.HOTELBEDS_RATE_REVIEW_APPROVED !== 'true')) {
            throw fail('hotelbeds_rate_review_disabled');
        }
    }

    function scopeFor(ownerSubject) {
        let owner;
        let scope;
        try {
            owner = ownerSubjectFrom(ownerSubject, { testOnly });
            scope = hotelbedsScopeFrom(env, { testOnly });
        } catch (error) {
            throw fail(error.code || 'hotelbeds_rate_review_scope_unavailable', error.httpStatus || 401, error);
        }
        return { ...scope, ownerSubject: owner };
    }

    function normalizeIdempotencyKey(value) {
        if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
            throw fail('hotelbeds_rate_review_idempotency_key_invalid', 400);
        }
        return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
    }

    function serializeOffer(offer) {
        if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
            throw fail('hotelbeds_rate_review_offer_invalid', 409);
        }
        let copy;
        try { copy = JSON.parse(JSON.stringify(offer)); }
        catch { throw fail('hotelbeds_rate_review_offer_invalid', 409); }
        if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > MAX_REVIEW_RESPONSE_BYTES) {
            throw fail('hotelbeds_rate_review_response_too_large', 502);
        }
        return copy;
    }

    function assertReviewableOffer(offer, publicOfferId) {
        if (!offer || offer.publicOfferId !== publicOfferId || offer.provider !== 'hotelbeds'
            || offer.origin !== 'live' || offer.environment !== 'test'
            || !validOfferTermsVersion(offer.termsVersion)
            || !offer.publicReviewOffer || offer.publicReviewOffer.publicOfferId !== publicOfferId
            || offer.publicReviewOffer.termsVersion !== offer.termsVersion
            || !['AT_HOTEL', 'AT_WEB'].includes(offer.paymentType)
            || !['BOOKABLE', 'RECHECK'].includes(offer.rateType)
            || !rateCheck.isValidRateIdentity(offer.bookingIdentity)
            || !rateCheck.isValidRateTerms(offer.bookingTerms)
            || offer.bookingIdentity.paymentType !== offer.paymentType
            || offer.bookingIdentity.net !== decimalKey(offer.lockedNetPrice)
            || offer.bookingIdentity.currency !== offer.currency
            || !Number.isInteger(offer.roomCount) || !Number.isInteger(offer.adultCount)
            || !Number.isInteger(offer.childCount)) {
            throw fail('hotelbeds_rate_review_offer_not_reviewable', 409);
        }
        if (offer.paymentType !== 'AT_HOTEL') {
            throw fail('hotelbeds_rate_review_payment_flow_unsupported', 409);
        }
        if (offer.rateType === 'RECHECK' && offer.bookingTerms.rateCommentsResolved !== true) {
            throw fail('hotelbeds_rate_review_terms_unresolved', 409);
        }
    }

    function copyReviewOffer(publicOffer, checked, sourceRateTerms) {
        const offer = serializeOffer(publicOffer);
        const sourceHotel = checked.response.hotels ?? checked.response.hotel;
        const hotel = Array.isArray(sourceHotel) ? sourceHotel[0] : sourceHotel;
        const checkedRate = hotel?.rooms?.[0]?.rates?.[0];
        if (!checkedRate || typeof checkedRate !== 'object') {
            throw fail('hotelbeds_rate_review_checkrate_invalid', 502);
        }
        const checkedRateTerms = rateCheck.rateTermsFromCheckedRate(
            sourceRateTerms,
            checkedRate,
            hotel.currency
        );
        const rawComments = checkedRate.rateComments == null ? []
            : typeof checkedRate.rateComments === 'string' ? [checkedRate.rateComments]
                : Array.isArray(checkedRate.rateComments) ? checkedRate.rateComments : null;
        if (rawComments === null) throw fail('hotelbeds_rate_review_terms_invalid', 502);
        const normalizedComments = normalizeHotelbedsRateComments(rawComments);
        if (normalizedComments === null || rawComments.some(comment =>
            comment && typeof comment === 'object' && (Array.isArray(comment)
                || comment.description === undefined))) {
            throw fail('hotelbeds_rate_review_terms_invalid', 502);
        }
        offer.rateComments = rawComments.map((comment, index) => {
            if (typeof comment === 'string') return normalizedComments[index];
            return {
                description: normalizedComments[index],
                ...(typeof comment.dateStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(comment.dateStart)
                    ? { dateStart: comment.dateStart } : {}),
                ...(typeof comment.dateEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(comment.dateEnd)
                    ? { dateEnd: comment.dateEnd } : {})
            };
        });
        const rawPromotions = checkedRate.promotions ?? [];
        if (!Array.isArray(rawPromotions) || rawPromotions.length > 50
            || rawPromotions.some(item => !item || typeof item !== 'object' || Array.isArray(item)
                || ['code', 'name', 'remark'].some(key => item[key] != null
                    && (typeof item[key] !== 'string' || item[key].length > 2000)))) {
            throw fail('hotelbeds_rate_review_terms_invalid', 502);
        }
        offer.promotions = rawPromotions.map(item => ({
            ...(item.code != null ? { code: item.code.trim() } : {}),
            ...(item.name != null ? { name: item.name.trim() } : {}),
            ...(item.remark != null ? { remark: item.remark.trim() } : {})
        }));
        const cancellationPolicies = checkedRate.cancellationPolicies ?? [];
        if (!Array.isArray(cancellationPolicies) || cancellationPolicies.length > 30) {
            throw fail('hotelbeds_rate_review_terms_invalid', 502);
        }
        if (Array.isArray(checkedRate.cancellationPolicies)) {
            offer.cancellation = {
                ...(offer.cancellation || {}),
                schedule: cancellationPolicies.map(policy => {
                    const source = typeof policy?.from === 'string' ? policy.from : '';
                    const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(source)
                        && Number.isFinite(Date.parse(source))
                        ? { source, utc: new Date(Date.parse(source)).toISOString(), timezoneKnown: true } : null;
                    return {
                        startsAt: timestamp,
                        endsAt: null,
                        penalty: {
                            amount: typeof policy?.amount === 'string' || typeof policy?.amount === 'number'
                                ? String(policy.amount) : null,
                            currency: typeof hotel.currency === 'string' ? hotel.currency.toUpperCase() : null
                        }
                    };
                })
            };
        }
        let publicTaxes = null;
        if (checkedRate.taxes != null) {
            const sourceTaxes = checkedRate.taxes;
            if (!sourceTaxes || typeof sourceTaxes !== 'object' || Array.isArray(sourceTaxes)
                || sourceTaxes.allIncluded != null && typeof sourceTaxes.allIncluded !== 'boolean'
                || sourceTaxes.taxes != null && !Array.isArray(sourceTaxes.taxes)) {
                throw fail('hotelbeds_rate_review_terms_invalid', 502);
            }
            const taxItems = sourceTaxes.taxes || [];
            if (taxItems.length > 50 || taxItems.some(item => !item || typeof item !== 'object'
                || Array.isArray(item) || item.included != null && typeof item.included !== 'boolean')) {
                throw fail('hotelbeds_rate_review_terms_invalid', 502);
            }
            publicTaxes = {
                status: 'provided',
                allIncluded: typeof sourceTaxes.allIncluded === 'boolean' ? sourceTaxes.allIncluded : null,
                items: taxItems.map(item => ({
                    included: typeof item.included === 'boolean' ? item.included : null,
                    type: typeof item.type === 'string' ? item.type.slice(0, 100) : null,
                    subType: typeof item.subType === 'string' ? item.subType.slice(0, 100) : null,
                    amount: item.clientCurrency === 'AED'
                        && /^\d+(?:\.\d+)?$/.test(String(item.clientAmount ?? ''))
                        ? String(item.clientAmount) : null,
                    currency: item.clientCurrency === 'AED'
                        && /^\d+(?:\.\d+)?$/.test(String(item.clientAmount ?? '')) ? 'AED' : null,
                    amountDisplayable: item.clientCurrency === 'AED'
                        && /^\d+(?:\.\d+)?$/.test(String(item.clientAmount ?? ''))
                }))
            };
        }
        offer.taxes = publicTaxes;
        const publicPolicies = cancellationPolicies.map(policy => ({
            amount: String(policy.amount), from: policy.from
        }));
        const safeRate = Object.fromEntries([
            'rateType', 'paymentType', 'rateClass', 'boardCode', 'packaging',
            'rooms', 'adults', 'children', 'cancellationPolicies', 'promotions', 'rateComments', 'taxes'
        ].filter(key => Object.hasOwn(checkedRate, key)).map(key => {
            if (key === 'cancellationPolicies') return [key, publicPolicies];
            if (key === 'promotions') return [key, offer.promotions];
            if (key === 'rateComments') return [key, offer.rateComments];
            if (key === 'taxes') return [key, publicTaxes];
            return [key, checkedRate[key]];
        }));
        offer.checkRateTerms = {
            hotel: {
                code: hotel.code,
                checkIn: hotel.checkIn,
                checkOut: hotel.checkOut,
                currency: hotel.currency,
                paymentDataRequired: hotel.paymentDataRequired ?? null,
                rooms: [{ code: hotel.rooms[0].code, rates: [safeRate] }],
                upselling: hotel.upselling ?? null
            }
        };
        const termsVersion = offerTermsVersion(offer);
        offer.termsVersion = termsVersion;
        return { offer, rateTerms: checkedRateTerms, termsVersion };
    }

    function resultFrom(record, cached) {
        const result = {
            success: true,
            reviewId: record.reviewId,
            publicOfferId: record.publicOfferId,
            sourceTermsVersion: record.sourceTermsVersion,
            termsVersion: record.termsVersion,
            offer: record.offer,
            expiresAt: new Date(record.reviewExpiresAt).toISOString(),
            checkRateRequests: record.checkRateRequests,
            cached: cached === true
        };
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_REVIEW_RESPONSE_BYTES) {
            throw fail('hotelbeds_rate_review_response_too_large', 502);
        }
        return result;
    }

    async function findByIdempotency(scope, idempotencyKeyHash) {
        return Model.findOne({ ...scope, idempotencyKeyHash })
            .select('+idempotencyKeyHash +rateKeyFingerprint +offer +rateIdentity +rateTerms '
                + '+providerRateKey +checkRateSnapshot +checkRateTermsFingerprint +claimExpiresAt')
            .lean().exec();
    }

    async function reserveReview({ scope, publicOfferId, reservationOffer, idempotencyKeyHash, at }) {
        const reviewId = createReviewId();
        if (typeof reviewId !== 'string'
            || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(reviewId)) {
            throw fail('hotelbeds_rate_review_id_invalid');
        }
        const rateKeyFingerprint = crypto.createHash('sha256')
            .update(reservationOffer.opaqueToken, 'utf8').digest('hex');
        const record = {
            ...scope,
            reviewId,
            publicOfferId,
            idempotencyKeyHash,
            sourceTermsVersion: reservationOffer.termsVersion,
            rateType: reservationOffer.rateType,
            rateKeyFingerprint,
            providerRateKey: reservationOffer.opaqueToken,
            checkRateRequests: 0,
            rateIdentity: reservationOffer.bookingIdentity,
            state: 'checking',
            claimExpiresAt: new Date(at.getTime() + RATE_REVIEW_TTL_MS),
            expiresAt: new Date(at.getTime() + REVIEW_RECORD_TTL_MS)
        };
        try {
            const created = await Model.create([record], {
                ordered: true,
                writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
            });
            if (!Array.isArray(created) || created.length !== 1) {
                throw new Error('rate_review_reservation_incomplete');
            }
            return { record: { ...record, ...(created[0]?.toObject?.() || created[0]) }, cached: false };
        } catch (error) {
            if (error?.code !== 11000) throw fail('hotelbeds_rate_review_reservation_unavailable', 503, error);
        }

        const existing = await findByIdempotency(scope, idempotencyKeyHash);
        if (!existing || existing.publicOfferId !== publicOfferId
            || existing.sourceTermsVersion !== reservationOffer.termsVersion
            || existing.rateType !== reservationOffer.rateType
            || existing.rateKeyFingerprint !== rateKeyFingerprint) {
            throw fail('hotelbeds_rate_review_idempotency_conflict', 409);
        }
        if (existing.state === 'pending'
            && existing.reviewExpiresAt instanceof Date && existing.reviewExpiresAt > at
            && existing.expiresAt instanceof Date && existing.expiresAt > at) {
            return { record: existing, cached: true };
        }
        if (existing.state === 'pending') throw fail('hotelbeds_rate_review_expired', 409);
        if (existing.state === 'checking') {
            if (existing.claimExpiresAt instanceof Date && existing.claimExpiresAt > at) {
                throw fail('hotelbeds_rate_review_in_progress', 409);
            }
            if (existing.checkRateRequests !== 0) {
                await Model.findOneAndUpdate({
                    ...scope, idempotencyKeyHash, publicOfferId, reviewId: existing.reviewId,
                    state: 'checking', claimExpiresAt: { $lte: at }
                }, { $set: { state: 'stale' }, $unset: { claimExpiresAt: '' } }, { new: false }).exec();
                throw fail('hotelbeds_rate_review_stale', 409);
            }
            let claimed;
            try {
                claimed = await Model.findOneAndUpdate({
                    ...scope,
                    idempotencyKeyHash,
                    publicOfferId,
                    reviewId: existing.reviewId,
                    state: 'checking',
                    claimExpiresAt: { $lte: at },
                    expiresAt: { $gt: at }
                }, {
                    $set: { claimExpiresAt: new Date(at.getTime() + RATE_REVIEW_TTL_MS) }
                }, { new: true }).select('+providerRateKey +rateIdentity').lean().exec();
            } catch (error) {
                throw fail('hotelbeds_rate_review_reservation_unavailable', 503, error);
            }
            if (!claimed) throw fail('hotelbeds_rate_review_in_progress', 409);
            return { record: claimed, cached: false };
        }
        if (existing.state === 'stale') throw fail('hotelbeds_rate_review_stale', 409);
        if (existing.state === 'consumed') throw fail('hotelbeds_rate_review_already_consumed', 409);
        throw fail('hotelbeds_rate_review_failed', 409);
    }

    async function createReview({ publicOfferId, ownerSubject, idempotencyKey } = {}) {
        assertEnabled();
        if (typeof publicOfferId !== 'string' || !/^[a-f\d]{64}$/i.test(publicOfferId)) {
            throw fail('hotelbeds_rate_review_offer_invalid', 400);
        }
        const scope = scopeFor(ownerSubject);
        const idempotencyKeyHash = normalizeIdempotencyKey(idempotencyKey);
        await ensureReady();
        const offer = await offerCacheService.getRateReviewOffer(publicOfferId);
        if (!offer) throw fail('hotelbeds_rate_review_offer_not_found', 404);
        assertReviewableOffer(offer, publicOfferId);
        const at = currentTime();
        const reservation = await reserveReview({ scope, publicOfferId, reservationOffer: offer, idempotencyKeyHash, at });
        if (reservation.cached) return resultFrom(reservation.record, true);

        try {
            const checkRateStartedAt = currentTime();
            const checkRateClaim = await Model.findOneAndUpdate({
                ...scope, reviewId: reservation.record.reviewId, state: 'checking',
                checkRateRequests: 0,
                claimExpiresAt: { $gt: checkRateStartedAt },
                expiresAt: { $gt: checkRateStartedAt }
            }, { $inc: { checkRateRequests: 1 } }, { new: true }).lean().exec();
            if (!checkRateClaim) throw fail('hotelbeds_rate_review_stale', 409);
            const checked = await rateCheck.checkSelectedRateForReview(
                client, offer.opaqueToken, offer.bookingIdentity, offer.bookingTerms
            );
            const reviewed = copyReviewOffer(offer.publicReviewOffer, checked, offer.bookingTerms);
            const reviewOffer = reviewed.offer;
            const checkRateSnapshot = rateCheck.normalizedCheckRateTerms(checked.response);
            const termsVersion = reviewed.termsVersion;
            const reviewExpiresAt = new Date(Math.min(
                at.getTime() + RATE_REVIEW_TTL_MS,
                new Date(offer.expiresAt).getTime()
            ));
            if (!Number.isFinite(reviewExpiresAt.getTime()) || reviewExpiresAt <= currentTime()) {
                throw fail('hotelbeds_rate_review_offer_expired', 409);
            }
            const pending = await Model.findOneAndUpdate({
                ...scope,
                reviewId: reservation.record.reviewId,
                publicOfferId,
                state: 'checking',
                checkRateRequests: 1,
                claimExpiresAt: { $gt: currentTime() },
                expiresAt: { $gt: currentTime() }
            }, {
                $set: {
                    state: 'pending',
                    termsVersion,
                    rateTerms: reviewed.rateTerms,
                    offer: reviewOffer,
                    checkRateSnapshot,
                    checkRateTermsFingerprint: rateCheck.checkRateTermsFingerprint(checked.response),
                    reviewExpiresAt
                },
                $unset: { claimExpiresAt: '' }
            }, {
                new: true,
                writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
            }).select('+offer +checkRateSnapshot').lean().exec();
            if (!pending) throw fail('hotelbeds_rate_review_expired', 409);
            return resultFrom(pending, false);
        } catch (error) {
            const failedAt = currentTime();
            await Model.findOneAndUpdate({
                ...scope,
                reviewId: reservation.record.reviewId,
                state: 'checking',
                claimExpiresAt: { $gt: failedAt }
            }, {
                $set: { state: 'failed' },
                $unset: { claimExpiresAt: '' }
            }, { new: false }).exec().catch(() => {});
            if (error?.code === 'booking_checkrate_unavailable') {
                throw fail('hotelbeds_rate_review_revalidation_unavailable', 502, error);
            }
            if (typeof error?.code === 'string' && error.code.startsWith('booking_checkrate_')) {
                throw fail('hotelbeds_rate_review_rate_changed', 409, error);
            }
            if (error?.httpStatus) throw error;
            if (typeof error?.code === 'string' && error.code.startsWith('hotelbeds_')) {
                throw error;
            }
            throw fail('hotelbeds_rate_review_unavailable', 502, error);
        }
    }

    async function consumeForBooking({ reviewId, publicOfferId, ownerSubject,
        sourceTermsVersion, acceptedTermsVersion, termsAccepted } = {}) {
        assertEnabled();
        if (typeof reviewId !== 'string'
            || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(reviewId)
            || typeof publicOfferId !== 'string' || !/^[a-f\d]{64}$/i.test(publicOfferId)
            || !validOfferTermsVersion(sourceTermsVersion)
            || !validOfferTermsVersion(acceptedTermsVersion)) {
            throw fail('hotelbeds_rate_review_required', 409);
        }
        const scope = scopeFor(ownerSubject);
        const at = currentTime();
        if (termsAccepted !== true) throw fail('hotelbeds_rate_review_acceptance_required', 409);
        await ensureReady();
        const pending = await Model.findOne({ ...scope, reviewId, publicOfferId, sourceTermsVersion })
            .select('+termsVersion +rateKeyFingerprint +offer +rateIdentity +rateTerms +providerRateKey '
                + '+checkRateSnapshot +checkRateTermsFingerprint +reviewExpiresAt +consumedAt')
            .lean().exec();
        if (!pending || !(pending.reviewExpiresAt instanceof Date) || pending.reviewExpiresAt <= at
            || !(pending.expiresAt instanceof Date) || pending.expiresAt <= at
            || pending.termsVersion !== acceptedTermsVersion) {
            if (pending?.state === 'pending' && (
                !(pending.reviewExpiresAt instanceof Date) || pending.reviewExpiresAt <= at
                || !(pending.expiresAt instanceof Date) || pending.expiresAt <= at
            )) {
                await Model.findOneAndUpdate({
                    ...scope,
                    reviewId,
                    state: 'pending',
                    $or: [
                        { reviewExpiresAt: { $lte: at } },
                        { expiresAt: { $lte: at } }
                    ]
                }, { $set: { state: 'stale' } }, { new: false }).exec();
            }
            throw fail('hotelbeds_rate_review_acceptance_required', 409);
        }
        if (pending.state === 'stale') throw fail('hotelbeds_rate_review_stale', 409);
        if (pending.state === 'consumed') throw fail('hotelbeds_rate_review_already_consumed', 409);
        if (pending.state !== 'pending') throw fail('hotelbeds_rate_review_acceptance_required', 409);

        // Single-CheckRate flow: the review already holds the one authoritative
        // CheckRate snapshot from createReview. Consumption performs a one-time
        // pending -> consumed transition against the stored terms, the review TTL,
        // and the owner scope. It deliberately does not call CheckRate again before
        // Booking (documented flow: Availability -> CheckRate (RECHECK) -> Booking).
        const completedAt = currentTime();
        let record;
        try {
            record = await Model.findOneAndUpdate({
                ...scope,
                reviewId,
                publicOfferId,
                sourceTermsVersion,
                termsVersion: acceptedTermsVersion,
                state: 'pending',
                reviewExpiresAt: { $gt: completedAt },
                expiresAt: { $gt: completedAt },
                checkRateRequests: 1
            }, {
                $set: { state: 'consumed', consumedAt: completedAt }
            }, {
                new: true,
                writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
            }).select('+offer +rateIdentity +rateTerms +providerRateKey +checkRateSnapshot '
                + '+checkRateTermsFingerprint +reviewExpiresAt +expiresAt +consumedAt').lean().exec();
        } catch (error) {
            throw fail('hotelbeds_rate_review_unavailable', 503, error);
        }
        if (!record) {
            const after = await Model.findOne({ ...scope, reviewId })
                .select('+termsVersion +consumedAt').lean().exec();
            if (after?.state === 'consumed') throw fail('hotelbeds_rate_review_already_consumed', 409);
            await Model.findOneAndUpdate({
                ...scope,
                reviewId,
                state: 'pending',
                $or: [
                    { reviewExpiresAt: { $lte: completedAt } },
                    { expiresAt: { $lte: completedAt } }
                ]
            }, { $set: { state: 'stale' } }, { new: false }).exec().catch(() => {});
            throw fail('hotelbeds_rate_review_stale', 409);
        }
        if (!record.offer || !rateCheck.isValidRateIdentity(record.rateIdentity)
            || !rateCheck.isValidRateTerms(record.rateTerms)
            || record.offer.publicOfferId !== publicOfferId
            || record.offer.termsVersion !== acceptedTermsVersion
            || record.checkRateRequests !== 1
            || typeof record.providerRateKey !== 'string' || !record.checkRateSnapshot
            || !(record.consumedAt instanceof Date)) {
            throw fail('hotelbeds_rate_review_state_invalid', 409);
        }
        return {
            reviewId: record.reviewId,
            publicOfferId: record.publicOfferId,
            rateType: record.rateType,
            checkRateRequests: record.checkRateRequests,
            providerRateKey: record.providerRateKey,
            sourceTermsVersion: record.sourceTermsVersion,
            termsVersion: record.termsVersion,
            termsAcceptedAt: new Date(record.consumedAt),
            rateIdentity: record.rateIdentity,
            rateTerms: record.rateTerms,
            checkRateSnapshot: record.checkRateSnapshot,
            offer: record.offer,
            expiresAt: new Date(record.reviewExpiresAt)
        };
    }

    return { createReview, consumeForBooking };
}

module.exports = {
    RATE_REVIEW_TTL_MS,
    REVIEW_RECORD_TTL_MS,
    MAX_REVIEW_RESPONSE_BYTES,
    IDEMPOTENCY_KEY_PATTERN,
    createHotelbedsRateReviewService
};