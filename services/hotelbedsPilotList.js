const MAX_PILOT_HOTELS = 5;
const { pilotConfigurationFrom } = require('./hotelbedsAvailabilityService');

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function configuredHotelbedsPilotCodes(env = process.env) {
    const raw = String(env.HOTELBEDS_PILOT_HOTEL_CODES || '').trim();
    if (!raw) return [];

    const codes = raw.split(',').map(value => {
        const text = value.trim();
        if (!/^\d{1,10}$/.test(text)) throw fail('hotelbeds_pilot_hotel_codes_invalid');
        const code = Number(text);
        if (!Number.isSafeInteger(code) || code < 1) throw fail('hotelbeds_pilot_hotel_codes_invalid');
        return String(code);
    });
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length > MAX_PILOT_HOTELS) throw fail('hotelbeds_pilot_hotel_limit_exceeded');
    return uniqueCodes;
}

function pilotListFrom(env = process.env) {
    const approved = env.HOTELBEDS_ENABLED === 'true'
        && String(env.HOTELBEDS_ENV || '').trim().toLowerCase() === 'test'
        && env.HOTELBEDS_AVAILABILITY_PILOT_ENABLED === 'true'
        && env.HOTELBEDS_PILOT_APPROVED === 'true';

    if (!approved) {
        return { success: true, environment: 'test', configured: false, hotels: [] };
    }

    const hotelCodes = configuredHotelbedsPilotCodes(env);

    // Reuse the Availability service's complete preflight, including language,
    // raw-price policy, operator key, and shared daily budget validation.
    let operationalCodes;
    try {
        operationalCodes = pilotConfigurationFrom(env).codes.map(String);
    } catch {
        throw fail('hotelbeds_pilot_list_preflight_unavailable');
    }
    if (hotelCodes.length !== operationalCodes.length
        || hotelCodes.some((code, index) => code !== operationalCodes[index])) {
        throw fail('hotelbeds_pilot_list_configuration_mismatch');
    }
    return {
        success: true,
        environment: 'test',
        configured: hotelCodes.length > 0,
        hotels: hotelCodes.map(providerHotelId => ({
            providerHotelId,
            label: `Hotelbeds ID ${providerHotelId}`
        }))
    };
}

module.exports = { MAX_PILOT_HOTELS, configuredHotelbedsPilotCodes, pilotListFrom };