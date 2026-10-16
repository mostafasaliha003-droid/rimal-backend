const crypto = require('node:crypto');
const { normalizeHotelbedsRateComments } = require('./hotelbedsRateComments');

function fail(code) {
    return Object.assign(new Error(code), { code });
}

function decimal(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match || text.length > 80) return null;
    const whole = match[1].replace(/^0+(?=\d)/, '');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function currency(value) {
    return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim())
        ? value.trim().toUpperCase() : null;
}

function identifier(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === 'string' && value.trim() && value.trim().length <= 200) return value.trim();
    return null;
}

function dateOnly(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
    if (!match) return null;
    const date = new Date(`${match[1]}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) return null;
    if (value !== match[1] && !Number.isFinite(Date.parse(value))) return null;
    return match[1];
}

function safeInteger(value) {
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const result = Number(value);
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeTimestamp(value) {
    if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function cancellationTerms(value, amountCurrency, normalized = false) {
    const source = normalized ? value?.schedule : value;
    if (source == null) return [];
    if (!Array.isArray(source)) return null;
    const result = [];
    for (const policy of source) {
        const from = normalized ? policy?.startsAt?.utc : policy?.from;
        const amount = normalized ? policy?.penalty?.amount : policy?.amount;
        const policyCurrency = normalized ? currency(policy?.penalty?.currency) : amountCurrency;
        const at = normalizeTimestamp(from);
        const net = decimal(amount);
        if (!at || net === null || !policyCurrency) return null;
        result.push({ from: at, amount: net, currency: policyCurrency });
    }
    return result.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function promotionTerms(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) return null;
    const result = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        for (const field of ['code', 'name', 'remark']) {
            if (item[field] !== undefined && item[field] !== null
                && (typeof item[field] !== 'string' || item[field].length > 2000)) return null;
        }
        result.push({
            code: item.code?.trim() ?? null,
            name: item.name?.trim() ?? null,
            remark: item.remark?.trim() ?? null
        });
    }
    return result.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function commentTerms(value, normalized = false) {
    const comments = normalizeHotelbedsRateComments(value);
    return comments === null ? null : comments.sort();
}

function identityFromNormalizedOffer(offer) {
    const netCurrency = currency(offer?.price?.supplierAmount?.currency);
    const identity = {
        hotelCode: identifier(offer?.providerHotelId ?? offer?.hotel?.providerHotelId ?? offer?.hotel?.code),
        roomCode: typeof offer?.room?.providerCode === 'string' ? offer.room.providerCode.trim() : null,
        checkIn: dateOnly(offer?.stay?.checkIn),
        checkOut: dateOnly(offer?.stay?.checkOut),
        net: decimal(offer?.price?.supplierAmount?.amount),
        currency: netCurrency,
        rateClass: typeof offer?.availability?.rateClass === 'string'
            ? offer.availability.rateClass.trim().toUpperCase() : null,
        boardCode: typeof offer?.board?.supplierCode === 'string'
            ? offer.board.supplierCode.trim().toUpperCase() : null,
        packaging: typeof offer?.availability?.packaging === 'boolean'
            ? offer.availability.packaging : null,
        roomCount: safeInteger(offer?.occupancy?.rooms),
        adultCount: safeInteger(offer?.occupancy?.adults),
        childCount: safeInteger(offer?.occupancy?.children),
        paymentType: typeof offer?.payment?.type === 'string'
            ? offer.payment.type.trim().toUpperCase() : null
    };
    return isValidRateIdentity(identity) ? identity : null;
}

function termsFromNormalizedOffer(offer) {
    const netCurrency = currency(offer?.price?.supplierAmount?.currency);
    const cancellation = cancellationTerms(offer?.cancellation, netCurrency, true);
    const promotions = promotionTerms(offer?.promotions);
    const comments = commentTerms(offer?.rateComments, true);
    if (!cancellation || !promotions || !comments) return null;
    return {
        cancellationFingerprint: fingerprint(cancellation),
        promotionsFingerprint: fingerprint(promotions),
        rateCommentsFingerprint: fingerprint(comments),
        rateCommentsResolved: offer?.contractTerms?.rateCommentsResolved === true
            && offer?.availability?.rateCommentsResolved === true
    };
}

function isValidRateIdentity(identity) {
    return Boolean(identity && identity.hotelCode && identity.roomCode && identity.checkIn && identity.checkOut
        && identity.net !== null && identity.currency && identity.rateClass && identity.boardCode
        && typeof identity.packaging === 'boolean' && Number.isSafeInteger(identity.roomCount)
        && identity.roomCount > 0 && Number.isSafeInteger(identity.adultCount) && identity.adultCount > 0
        && Number.isSafeInteger(identity.childCount) && identity.childCount >= 0 && identity.paymentType);
}

function isValidRateTerms(terms) {
    return Boolean(terms && typeof terms.rateCommentsResolved === 'boolean'
        && /^[a-f\d]{64}$/i.test(terms.cancellationFingerprint || '')
        && /^[a-f\d]{64}$/i.test(terms.promotionsFingerprint || '')
        && /^[a-f\d]{64}$/i.test(terms.rateCommentsFingerprint || ''));
}

function singleton(value) {
    if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function matchCheckedRate(response, expected, availabilityRateKey, expectedTerms,
    { allowCommentChanges = false, allowTermsChanges = false } = {}) {
    if (!isValidRateIdentity(expected)) throw fail('booking_rate_identity_unavailable');
    if (!isValidRateTerms(expectedTerms)) {
        throw fail('booking_rate_terms_unavailable');
    }
    if (!expectedTerms.rateCommentsResolved && !allowCommentChanges) throw fail('booking_rate_terms_unavailable');
    if (!response || response.error != null) throw fail('booking_checkrate_unavailable');
    const hotel = singleton(response.hotels ?? response.hotel);
    if (!hotel || identifier(hotel.code) !== expected.hotelCode
        || dateOnly(hotel.checkIn) !== expected.checkIn
        || dateOnly(hotel.checkOut) !== expected.checkOut
        || currency(hotel.currency) !== expected.currency || hotel.paymentDataRequired === true
        || !Array.isArray(hotel.rooms) || hotel.rooms.length !== 1
        || hotel.upselling != null && (typeof hotel.upselling !== 'object'
            || Array.isArray(hotel.upselling)
            || Array.isArray(hotel.upselling.rooms) && hotel.upselling.rooms.length > 0)) {
        throw fail('booking_checkrate_hotel_mismatch');
    }

    const candidates = [];
    for (const room of hotel.rooms) {
        if (!room || identifier(room.code) !== expected.roomCode || !Array.isArray(room.rates)
            || room.rates.length !== 1) throw fail('booking_checkrate_room_mismatch');
        for (const rate of room.rates) {
            if (!rate || typeof rate !== 'object' || Array.isArray(rate)
                || typeof rate.rateKey !== 'string' || !rate.rateKey.trim() || rate.rateKey.length > 8192) {
                throw fail('booking_checkrate_rate_ambiguous');
            }
            if (rate.rateType !== 'BOOKABLE'
                || String(rate.paymentType || '').trim().toUpperCase() !== expected.paymentType
                || String(rate.rateClass || '').trim().toUpperCase() !== expected.rateClass
                || String(rate.boardCode || '').trim().toUpperCase() !== expected.boardCode
                || rate.packaging !== expected.packaging
                || safeInteger(rate.rooms) !== expected.roomCount
                || safeInteger(rate.adults) !== expected.adultCount
                || safeInteger(rate.children) !== expected.childCount
                || decimal(rate.net) !== expected.net) continue;
            candidates.push(rate);
        }
    }
    if (candidates.length !== 1) {
        throw fail(candidates.length > 1
            ? 'booking_checkrate_rate_ambiguous' : 'booking_checkrate_rate_changed');
    }
    const rate = candidates[0];
    const cancellation = cancellationTerms(rate.cancellationPolicies, expected.currency);
    const promotions = promotionTerms(rate.promotions);
    if (!cancellation || !promotions || !allowTermsChanges
        && (fingerprint(cancellation) !== expectedTerms.cancellationFingerprint
            || fingerprint(promotions) !== expectedTerms.promotionsFingerprint)) {
        throw fail('booking_checkrate_terms_changed');
    }
    if (expectedTerms.rateCommentsResolved && !allowCommentChanges) {
        const comments = commentTerms(rate.rateComments);
        if (!comments || fingerprint(comments) !== expectedTerms.rateCommentsFingerprint) {
            throw fail('booking_checkrate_terms_changed');
        }
    } else if (expectedTerms.rateCommentsResolved) {
        if (commentTerms(rate.rateComments) === null) throw fail('booking_checkrate_terms_changed');
    }
    if (availabilityRateKey !== undefined
        && (typeof availabilityRateKey !== 'string' || !availabilityRateKey.trim())) {
        throw fail('booking_checkrate_rate_key_invalid');
    }
    if (availabilityRateKey !== undefined && rate.rateKey !== availabilityRateKey) {
        // The public schema has no separate request-key correlation field. An
        // opaque changed key cannot be proven to belong to the accepted rate.
        throw fail('booking_checkrate_rate_key_changed');
    }
    return { rateKey: rate.rateKey, rate };
}

async function checkSelectedRate(client, rateKey, rateIdentity, rateTerms) {
    if (!client || typeof client.checkRates !== 'function'
        || typeof rateKey !== 'string' || !rateKey.trim()) {
        throw fail('booking_checkrate_request_invalid');
    }
    const response = await client.checkRates({ rooms: [{ rateKey }], upselling: false });
    if (!response?.ok || !response.data || response.data.error != null) {
        throw fail('booking_checkrate_unavailable');
    }
    return matchCheckedRate(response.data, rateIdentity, rateKey, rateTerms);
}

async function checkSelectedRateForReview(client, rateKey, rateIdentity, rateTerms) {
    if (!client || typeof client.checkRates !== 'function'
        || typeof rateKey !== 'string' || !rateKey.trim()) {
        throw fail('booking_checkrate_request_invalid');
    }
    const response = await client.checkRates({ rooms: [{ rateKey }], upselling: false });
    if (!response?.ok || !response.data || response.data.error != null) {
        throw fail('booking_checkrate_unavailable');
    }
    const matched = matchCheckedRate(response.data, rateIdentity, rateKey, rateTerms, {
        allowCommentChanges: true,
        allowTermsChanges: true
    });
    return { ...matched, response: response.data };
}

function rateTermsWithCheckedComments(rateTerms, value) {
    if (!isValidRateTerms(rateTerms) || rateTerms.rateCommentsResolved !== true) {
        throw fail('booking_rate_terms_unavailable');
    }
    const comments = commentTerms(value);
    if (!comments) throw fail('booking_checkrate_terms_changed');
    return { ...rateTerms, rateCommentsFingerprint: fingerprint(comments) };
}

function rateTermsFromCheckedRate(rateTerms, rate, rateCurrency) {
    if (!isValidRateTerms(rateTerms)
        || !rate || typeof rate !== 'object' || Array.isArray(rate)) {
        throw fail('booking_rate_terms_unavailable');
    }
    const cancellation = cancellationTerms(rate.cancellationPolicies, rateCurrency);
    const promotions = promotionTerms(rate.promotions);
    const comments = commentTerms(rate.rateComments);
    if (!cancellation || !promotions || !comments) throw fail('booking_checkrate_terms_changed');
    return {
        ...rateTerms,
        rateCommentsResolved: true,
        cancellationFingerprint: fingerprint(cancellation),
        promotionsFingerprint: fingerprint(promotions),
        rateCommentsFingerprint: fingerprint(comments)
    };
}

function normalizedCheckRateTerms(response) {
    if (!response || response.error != null) throw fail('booking_checkrate_unavailable');
    let snapshot;
    try { snapshot = JSON.parse(JSON.stringify(response)); }
    catch { throw fail('booking_checkrate_terms_invalid'); }
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 128 * 1024) {
        throw fail('booking_checkrate_terms_too_large');
    }
    const hotel = singleton(snapshot.hotels ?? snapshot.hotel);
    const rate = hotel?.rooms?.[0]?.rates?.[0];
    if (!rate || typeof rate !== 'object' || Array.isArray(rate)) throw fail('booking_checkrate_terms_invalid');
    return snapshot;
}

function checkRateTermsFingerprint(response) {
    const normalized = normalizedCheckRateTerms(response);
    const hotel = singleton(normalized.hotels ?? normalized.hotel);
    if (!hotel || !Array.isArray(hotel.rooms) || hotel.rooms.length !== 1
        || !hotel.rooms[0] || !Array.isArray(hotel.rooms[0].rates) || hotel.rooms[0].rates.length !== 1) {
        throw fail('booking_checkrate_terms_invalid');
    }
    const selectedTerms = {
        hotel: {
            code: hotel.code,
            checkIn: hotel.checkIn,
            checkOut: hotel.checkOut,
            currency: hotel.currency,
            paymentDataRequired: hotel.paymentDataRequired ?? null,
            rooms: [{ code: hotel.rooms[0].code, rates: hotel.rooms[0].rates }],
            upselling: hotel.upselling ?? null
        }
    };
    const stable = value => {
        if (Array.isArray(value)) return value.map(stable);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort()
                .map(key => [key, stable(value[key])]));
        }
        return value;
    };
    return crypto.createHash('sha256')
        .update(JSON.stringify(stable(selectedTerms)), 'utf8').digest('hex');
}

module.exports = {
    identityFromNormalizedOffer,
    isValidRateIdentity,
    termsFromNormalizedOffer,
    isValidRateTerms,
    matchCheckedRate,
    checkSelectedRate,
    checkSelectedRateForReview,
    rateTermsWithCheckedComments,
    rateTermsFromCheckedRate,
    normalizedCheckRateTerms,
    checkRateTermsFingerprint
};