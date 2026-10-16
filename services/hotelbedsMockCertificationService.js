const { fetchMockHotelContent } = require('./hotelbedsContentService');
const { generateVoucher } = require('./hotelbedsVoucherService');

const MOCK_RATE_KEY = 'MOCK-OPAQUE-HOTELBEDS-RATE-KEY-NOT-A-SUPPLIER-KEY';

async function getMockCertificationFlow() {
    const hotel = await fetchMockHotelContent(900001, 'ENG');
    const availability = {
        ok: true,
        mock: true,
        operation: 'availability',
        data: {
            hotels: {
                hotels: [{
                    code: hotel.hotelCode,
                    name: hotel.name,
                    categoryCode: hotel.category.code,
                    categoryName: hotel.category.name,
                    rooms: [{
                        code: 'MOCK-DBL',
                        name: 'Mock Double Room',
                        rates: [{
                            rateKey: MOCK_RATE_KEY,
                            rateType: 'RECHECK',
                            boardCode: 'BB',
                            boardName: 'BED AND BREAKFAST',
                            net: '100.00',
                            currency: 'USD'
                        }]
                    }]
                }]
            }
        }
    };
    const checkRate = {
        ok: true,
        mock: true,
        operation: 'checkrates',
        request: { rooms: [{ rateKey: MOCK_RATE_KEY }] },
        data: {
            hotel: {
                rooms: [{
                    rates: [{
                        rateKey: MOCK_RATE_KEY,
                        rateType: 'BOOKABLE',
                        net: '100.00',
                        currency: 'USD',
                        rateComments: 'Mock rate comment for certification UI.'
                    }]
                }]
            }
        }
    };
    const bookingConfirmation = {
        bookingReference: 'HBX-MOCK-BOOKING-900001',
        status: 'CONFIRMED',
        clientReference: 'RMLMOCKAGENCY001',
        checkIn: '2030-06-15',
        checkOut: '2030-06-17',
        supplierName: 'Hotelbeds Mock Supplier',
        supplierVatNumber: 'MOCK-VAT-NOT-VALID',
        holder: { name: 'Mock Lead Passenger', surname: 'Guest' },
        rooms: [{
            roomType: 'Mock Double Room',
            boardType: 'BED AND BREAKFAST',
            passengers: [
                { name: 'Mock Lead Passenger', surname: 'Guest', type: 'AD' },
                { name: 'Mock Child', surname: 'Guest', type: 'CH', age: 7 }
            ],
            rateComments: ['Mock rate comment for certification UI.']
        }]
    };
    const voucher = generateVoucher(bookingConfirmation, hotel);
    const booking = {
        ok: true,
        mock: true,
        operation: 'booking',
        data: {
            booking: {
                reference: bookingConfirmation.bookingReference,
                clientReference: bookingConfirmation.agencyReference,
                status: 'CONFIRMED'
            }
        }
    };

    return {
        success: true,
        mock: true,
        supplierRequestsSent: 0,
        availability,
        checkRate,
        booking,
        bookingConfirmation: { ...bookingConfirmation, mock: true },
        hotelContent: hotel,
        voucher
    };
}

module.exports = { MOCK_RATE_KEY, getMockCertificationFlow };