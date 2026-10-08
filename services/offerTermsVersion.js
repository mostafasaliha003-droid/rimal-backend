const crypto = require('node:crypto');

const TERMS_VERSION_PATTERN = /^[a-f\d]{64}$/i;

function offerTermsVersion(publicOffer) {
    if (!publicOffer || typeof publicOffer !== 'object' || Array.isArray(publicOffer)
        || typeof publicOffer.publicOfferId !== 'string' || !/^[a-f\d]{64}$/i.test(publicOffer.publicOfferId)) {
        throw Object.assign(new Error('offer_terms_snapshot_invalid'), {
            code: 'offer_terms_snapshot_invalid', httpStatus: 503
        });
    }
    const snapshot = {
        version: 1,
        publicOfferId: publicOffer.publicOfferId,
        provider: publicOffer.provider,
        hotel: publicOffer.hotel,
        room: publicOffer.room,
        stay: publicOffer.stay,
        occupancy: publicOffer.occupancy,
        price: publicOffer.price,
        board: publicOffer.board,
        availability: publicOffer.availability,
        payment: publicOffer.payment,
        cancellation: publicOffer.cancellation,
        rateComments: publicOffer.rateComments,
        contractTerms: publicOffer.contractTerms,
        taxes: publicOffer.taxes,
        promotions: publicOffer.promotions,
        ...(Object.hasOwn(publicOffer, 'checkRateTerms')
            ? { checkRateTerms: publicOffer.checkRateTerms } : {})
    };
    return crypto.createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

function normalizeTermsConsent({ termsAccepted, acceptedTermsVersion, expectedTermsVersion,
    now = () => new Date() } = {}) {
    const acceptedAt = new Date(now());
    if (termsAccepted !== true || !validOfferTermsVersion(acceptedTermsVersion)
        || !validOfferTermsVersion(expectedTermsVersion) || acceptedTermsVersion !== expectedTermsVersion
        || Number.isNaN(acceptedAt.getTime())) {
        throw Object.assign(new Error('offer_terms_acceptance_required'), {
            code: 'offer_terms_acceptance_required', httpStatus: 409
        });
    }
    return { acceptedTermsVersion: expectedTermsVersion, termsAcceptedAt: acceptedAt };
}

function validOfferTermsVersion(value) {
    return typeof value === 'string' && TERMS_VERSION_PATTERN.test(value);
}

module.exports = { TERMS_VERSION_PATTERN, offerTermsVersion, validOfferTermsVersion, normalizeTermsConsent };