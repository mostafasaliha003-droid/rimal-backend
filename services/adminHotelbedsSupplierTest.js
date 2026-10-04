const { pilotConfigurationFrom } = require('./hotelbedsAvailabilityService');
const { isVerifiedHotelbedsContent, projectVerifiedHotelContent } = require('./hotelbedsContentPolicy');

const INPUT_FIELDS = new Set(['hotelCode', 'checkIn', 'checkOut', 'adults']);

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 120
        || /[\u0000-\u001f\u007f]/.test(value)) return null;
    return value.trim();
}

function configuredPilotHotels(env) {
    if (String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
        throw fail('hotelbeds_test_environment_required', 503);
    }
    let pilot;
    try { pilot = pilotConfigurationFrom(env); }
    catch (error) { throw fail(error.code || 'hotelbeds_supplier_test_unavailable', error.httpStatus || 503); }
    return {
        success: true,
        environment: 'test',
        configured: pilot.codes.length > 0,
        hotels: pilot.codes.map(providerHotelId => ({
            providerHotelId: String(providerHotelId),
            label: `Hotelbeds ID ${providerHotelId}`
        }))
    };
}

function createAdminHotelbedsSupplierTestService({ availabilityService, env = process.env,
    now = () => new Date() } = {}) {
    if (!availabilityService || typeof availabilityService.searchAvailability !== 'function'
        || !env || typeof env !== 'object' || typeof now !== 'function') {
        throw new TypeError('admin_hotelbeds_supplier_test_dependencies_invalid');
    }

    function listHotels() {
        return configuredPilotHotels(env);
    }

    async function run(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => !INPUT_FIELDS.has(key))) {
            throw fail('hotelbeds_supplier_test_request_invalid', 400);
        }
        if (String(env.HOTELBEDS_ENV || '').trim().toLowerCase() !== 'test') {
            throw fail('hotelbeds_test_environment_required', 503);
        }

        let pilot;
        try { pilot = pilotConfigurationFrom(env); }
        catch (error) { throw fail(error.code || 'hotelbeds_supplier_test_unavailable', error.httpStatus || 503); }

        const rawHotelCode = typeof input.hotelCode === 'string'
            || typeof input.hotelCode === 'number' && Number.isSafeInteger(input.hotelCode)
            ? String(input.hotelCode).trim() : '';
        if (!/^\d{1,10}$/.test(rawHotelCode)) {
            throw fail('hotelbeds_pilot_hotel_code_invalid', 400);
        }
        const hotelCode = Number(rawHotelCode);
        if (!Number.isSafeInteger(hotelCode) || !pilot.codes.includes(hotelCode)) {
            throw fail('hotelbeds_pilot_hotel_not_allowed', 403);
        }
        if (!validDate(input.checkIn) || !validDate(input.checkOut) || input.checkOut <= input.checkIn) {
            throw fail('hotelbeds_stay_invalid', 400);
        }
        const current = new Date(now());
        if (!Number.isFinite(current.getTime()) || input.checkIn < current.toISOString().slice(0, 10)) {
            throw fail('hotelbeds_check_in_invalid', 400);
        }
        if (!Number.isSafeInteger(input.adults) || input.adults < 1 || input.adults > 6) {
            throw fail('hotelbeds_occupancy_invalid', 400);
        }

        let availability;
        try {
            availability = await availabilityService.searchAvailability({
                checkIn: input.checkIn,
                checkOut: input.checkOut,
                hotelCodes: [hotelCode],
                occupancies: [{ rooms: 1, adults: input.adults, children: 0 }]
            });
        } catch (error) {
            throw fail(error?.code || 'hotelbeds_supplier_test_unavailable', error?.httpStatus || 502);
        }
        if (!availability || availability.pricePolicy !== 'supplier-raw-internal-only'
            || availability.supplierRequests !== 1 || !Array.isArray(availability.hotels)) {
            throw fail('hotelbeds_supplier_test_response_invalid', 502);
        }

        const hotels = availability.hotels.map(hotel => {
            const code = Number(hotel?.code);
            if (!Number.isSafeInteger(code) || code !== hotelCode) {
                throw fail('hotelbeds_availability_unexpected_hotel_code', 502);
            }
            const rooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
            const rates = rooms.flatMap(room => Array.isArray(room?.rates) ? room.rates : []);
            const contentVerified = isVerifiedHotelbedsContent(hotel, {
                hotelCode: code, language: pilot.language, now: current
            });
            const content = contentVerified ? projectVerifiedHotelContent(hotel, {
                hotelCode: code, language: pilot.language, now: current
            }) : null;
            return {
                providerHotelId: String(code),
                name: contentVerified ? safeName(content?.name) : null,
                contentVerified,
                available: rates.length > 0,
                roomCount: rooms.length,
                rateCount: rates.length,
                resolvedRateTermsCount: rates.filter(rate => rate.rateCommentsResolved === true).length,
                unresolvedRateTermsCount: rates.filter(rate => rate.rateCommentsResolved === false).length
            };
        });

        return {
            success: true,
            environment: 'test',
            mode: 'availability_only',
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            adults: input.adults,
            supplierRequests: 1,
            checkRateRequests: 0,
            bookingRequests: 0,
            paymentRequests: 0,
            hotelCount: hotels.length,
            hotels
        };
    }

    return { run, listHotels };
}

module.exports = { createAdminHotelbedsSupplierTestService };