const {
    validateHotelId,
    validateRegionId,
    validateGeoCoordinates
} = require('./ratehawkSearchValidation');

const DISPLAY_LANGUAGES = new Set(['ar', 'en', 'es']);

function invalid(code) {
    return Object.assign(new TypeError(code), { code, ratehawkError: 'invalid_params' });
}

function displayLanguage(body) {
    const value = body.display_language ?? body.language ?? 'en';
    if (typeof value !== 'string' || !DISPLAY_LANGUAGES.has(value)) throw invalid('invalid_language');
    return value;
}

function validateRatehawkPublicSearchCriteria(kind, input, ratehawkService) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('invalid_search_criteria');
    if (!ratehawkService || typeof ratehawkService.validatedSearchParams !== 'function') {
        throw new TypeError('ratehawk_search_validator_unavailable');
    }

    const requestedLanguage = displayLanguage(input);
    const criteria = ratehawkService.validatedSearchParams(input);
    const supplierLanguage = input.language === undefined ? 'en' : input.language;
    if (typeof supplierLanguage !== 'string' || !DISPLAY_LANGUAGES.has(supplierLanguage)) throw invalid('invalid_language');

    if (kind === 'hotel_ids') {
        if (!Array.isArray(input.hids) || input.hids.length < 1 || input.hids.length > 100) throw invalid('invalid_hids');
        return { ...criteria, hids: input.hids.map(hid => validateHotelId(hid, 'hid')), requestedLanguage };
    }
    if (kind === 'geo') {
        return { ...criteria, ...validateGeoCoordinates(input), requestedLanguage };
    }
    if (kind === 'region') {
        return { ...criteria, region_id: validateRegionId(input.region_id), requestedLanguage };
    }
    if (kind === 'hotelpage') {
        const hid = validateHotelId(input.hid);
        const matchHash = input.match_hash;
        if (matchHash !== undefined && (typeof matchHash !== 'string' || !matchHash.trim() || matchHash.length > 200)) {
            throw invalid('invalid_match_hash');
        }
        return { ...criteria, hid, requestedLanguage, ...(matchHash ? { match_hash: matchHash } : {}) };
    }
    throw new TypeError(`unsupported_ratehawk_search_kind:${kind}`);
}

module.exports = { validateRatehawkPublicSearchCriteria };