const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const HotelbedsHotel = require('./models/HotelbedsHotel');
const {
    createHotelbedsContentService,
    normalizeHotelContent
} = require('./services/hotelbedsContentService');
const { generateVoucher } = require('./services/hotelbedsVoucherService');
const { getMockCertificationFlow } = require('./services/hotelbedsMockCertificationService');
const createHotelbedsMockCertificationRouter = require('./services/hotelbedsMockCertificationRoutes');

const validContent = {
    hotelCode: 12345,
    language: 'ENG',
    name: 'Fixture Hotel',
    category: { code: '4EST', name: '4 STARS' },
    address: '1 Fixture Road, Dubai, UAE',
    phone: '+971-4-555-0100',
    sourceUpdatedAt: '2026-09-30T12:00:00.000Z'
};

const validBooking = {
    bookingReference: 'HBX-REF-123',
    agencyReference: 'RIMAL-REF-123',
    checkIn: '2030-06-15',
    checkOut: '2030-06-17',
    supplierName: 'Example Supplier',
    supplierVatNumber: 'VAT-12345',
    holder: { firstName: 'Lead', lastName: 'Passenger' },
    rooms: [{
        roomType: 'Double Room',
        boardType: 'BED AND BREAKFAST',
        passengers: [
            { firstName: 'Lead', lastName: 'Passenger', type: 'AD' },
            { name: 'Child Passenger', type: 'CH', age: 7 }
        ],
        rateComments: ['Breakfast included.']
    }]
};

test('Hotelbeds hotel model is isolated and strictly requires voucher content fields', () => {
    assert.equal(HotelbedsHotel.modelName, 'HotelbedsHotel');
    assert.equal(HotelbedsHotel.collection.name, 'hotelbedshotels');
    const valid = new HotelbedsHotel(validContent);
    assert.equal(valid.validateSync(), undefined);
    const missingAddress = new HotelbedsHotel({ ...validContent, address: undefined });
    assert.ok(missingAddress.validateSync().errors.address);
    const missingPhone = new HotelbedsHotel({ ...validContent, phone: undefined });
    assert.ok(missingPhone.validateSync().errors.phone);
    assert.ok(HotelbedsHotel.schema.path('name'));
    assert.ok(HotelbedsHotel.schema.path('category'));
    assert.throws(() => new HotelbedsHotel({ ...validContent, rateHawkHid: 'must-not-be-stored' }),
        /rateHawkHid.*not in schema/);
});

test('content normalizer accepts common Content API name/category/address/phone representations', () => {
    const result = normalizeHotelContent({
        code: 12345,
        language: 'ENG',
        name: { content: 'Fixture Hotel' },
        categoryCode: '4EST',
        categoryName: '4 STARS',
        address: { content: '1 Fixture Road', city: 'Dubai', country: 'UAE' },
        phones: [{ phoneNumber: '+971-4-555-0100' }]
    });
    assert.deepEqual(result.category, { code: '4EST', name: '4 STARS' });
    assert.equal(result.name, 'Fixture Hotel');
    assert.equal(result.address, '1 Fixture Road, Dubai, UAE');
    assert.equal(result.phone, '+971-4-555-0100');
    assert.throws(() => normalizeHotelContent({ ...validContent, name: '' }), /hotelbeds_content_name_invalid/);
});

test('mock content sync deduplicates IDs and upserts into its isolated model', async () => {
    const calls = [];
    const mockModel = {
        bulkWrite: async (operations, options) => {
            calls.push({ operations, options });
            return { upsertedCount: operations.length, modifiedCount: 0 };
        }
    };
    let fetchCalls = 0;
    const service = createHotelbedsContentService({
        HotelModel: mockModel,
        fetchContent: async (hotelCode, language) => {
            fetchCalls += 1;
            return { ...validContent, hotelCode, language };
        },
        testOnly: true,
        ensureModelConnected: async () => {},
        now: () => new Date('2026-10-01T10:00:00.000Z')
    });

    const result = await service.syncMockHotels({ hotelCodes: [12345, '12345'], language: 'eng' });
    assert.equal(fetchCalls, 1);
    assert.equal(result.syncedCount, 1);
    assert.equal(result.hotels[0].language, 'ENG');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.ordered, true);
    assert.equal(calls[0].operations[0].updateOne.filter.hotelCode, 12345);
    assert.equal(calls[0].operations[0].updateOne.filter.language, 'ENG');
    assert.equal(calls[0].operations[0].updateOne.upsert, true);
    assert.equal(calls[0].operations[0].updateOne.update.$set.name, 'Fixture Hotel');
});

test('mock content sync rejects invalid source data without writing partial results', async () => {
    let writes = 0;
    const service = createHotelbedsContentService({
        HotelModel: { bulkWrite: async () => { writes += 1; } },
        testOnly: true,
        ensureModelConnected: async () => {},
        fetchContent: async hotelCode => hotelCode === 1
            ? validContent : { ...validContent, hotelCode, address: '' }
    });
    await assert.rejects(service.syncMockHotels({ hotelCodes: [1, 2] }), /hotelbeds_content_address_invalid/);
    assert.equal(writes, 0);
    await assert.rejects(service.syncMockHotels({ hotelCodes: [1], language: '../ENG' }), /hotelbeds_content_language_invalid/);
    await assert.rejects(service.syncMockHotels({ hotelCodes: [2], language: 'ENG' }), /hotelbeds_content_address_invalid/);
});

test('content sync refuses a missing required voucher phone before writing', async () => {
    let writes = 0;
    const service = createHotelbedsContentService({
        HotelModel: { bulkWrite: async () => { writes += 1; } },
        testOnly: true,
        ensureModelConnected: async () => {},
        fetchContent: async () => ({ ...validContent, phone: '' })
    });
    await assert.rejects(service.syncMockHotels({ hotelCodes: [12345] }), /hotelbeds_content_phone_invalid/);
    assert.equal(writes, 0);
});

test('voucher contains the required hotel, passenger, booking and exact dynamic payment statement', () => {
    const voucher = generateVoucher(validBooking, validContent);
    assert.deepEqual(voucher.hotel, {
        name: 'Fixture Hotel', category: '4 STARS',
        address: '1 Fixture Road, Dubai, UAE', phone: '+971-4-555-0100'
    });
    assert.equal(voucher.passengers.leadPassengerName, 'Lead Passenger');
    assert.deepEqual(voucher.passengers.rooms[0].passengers, [
        { name: 'Lead Passenger', type: 'adult' },
        { name: 'Child Passenger', type: 'child', age: 7 }
    ]);
    assert.equal(voucher.booking.hotelbedsBookingReference, 'HBX-REF-123');
    assert.equal(voucher.booking.agencyReference, 'RIMAL-REF-123');
    assert.equal(voucher.booking.checkIn, '2030-06-15');
    assert.equal(voucher.booking.checkOut, '2030-06-17');
    assert.deepEqual(voucher.booking.rooms[0], {
        roomNumber: 1,
        roomType: 'Double Room',
        boardType: 'BED AND BREAKFAST',
        rateComments: ['Breakfast included.']
    });
    assert.equal(voucher.paymentStatement,
        'Payable through Example Supplier, acting as agent for the service operating company, details of which can be provided upon request. VAT: VAT-12345 Reference: HBX-REF-123');
    assert.equal(JSON.stringify(voucher).includes('100.00'), false, 'voucher must not invent or expose a booking price');
});

test('voucher accepts Hotelbeds-style booking confirmation fields and requires a passenger in every room', () => {
    const confirmation = {
        booking: {
            reference: 'HBX-RSP-1', clientReference: 'AGENCY-1', holder: { name: 'Lead Passenger' },
            hotel: { checkIn: '2030-06-15', checkOut: '2030-06-16', rooms: [{
            name: 'Twin Room', boardName: 'ROOM ONLY', paxes: [{ name: 'Lead Passenger', type: 'AD' }],
            rates: [{ rateComments: 'No meals included.' }]
            }] }
        },
        supplier: { name: 'Hotelbeds', vatNumber: 'VAT-54321' }
    };
    const voucher = generateVoucher(confirmation, validContent);
    assert.equal(voucher.booking.hotelbedsBookingReference, 'HBX-RSP-1');
    assert.equal(voucher.booking.agencyReference, 'AGENCY-1');
    assert.equal(voucher.booking.rooms[0].roomType, 'Twin Room');
    assert.deepEqual(voucher.booking.rooms[0].rateComments, ['No meals included.']);

    const missingRoomPax = structuredClone(validBooking);
    missingRoomPax.rooms.push({ roomType: 'Second Room', boardType: 'ROOM ONLY', passengers: [] });
    assert.throws(() => generateVoucher(missingRoomPax, validContent), /hotelbeds_voucher_room_passenger_missing/);
    const missingChildAge = structuredClone(validBooking);
    missingChildAge.rooms[0].passengers[1].age = undefined;
    assert.throws(() => generateVoucher(missingChildAge, validContent), /hotelbeds_voucher_child_age_missing/);
    const childAgeWithoutType = structuredClone(validBooking);
    childAgeWithoutType.rooms[0].passengers[1].type = undefined;
    const normalizedChild = generateVoucher(childAgeWithoutType, validContent).passengers.rooms[0].passengers[1];
    assert.deepEqual(normalizedChild, { name: 'Child Passenger', type: 'child', age: 7 });
});

test('voucher fails closed for missing required fields and invalid dates', () => {
    assert.throws(() => generateVoucher({ ...validBooking, bookingReference: '' }, validContent), /hotelbeds_voucher_booking_reference_missing/);
    assert.throws(() => generateVoucher(validBooking, { ...validContent, phone: '' }), /hotelbeds_voucher_hotel_phone_missing/);
    assert.throws(() => generateVoucher({ ...validBooking, checkOut: '2030-02-30' }, validContent), /hotelbeds_voucher_check_out_invalid/);
    assert.throws(() => generateVoucher({ ...validBooking, checkOut: '2030-06-14' }, validContent), /hotelbeds_voucher_stay_invalid/);
});

test('mock certification flow returns Availability, successful CheckRate and a voucher without supplier requests', async () => {
    const result = await getMockCertificationFlow();
    assert.equal(result.success, true);
    assert.equal(result.mock, true);
    assert.equal(result.supplierRequestsSent, 0);
    assert.equal(result.availability.operation, 'availability');
    assert.equal(result.availability.data.hotels.hotels[0].rooms[0].rates[0].rateType, 'RECHECK');
    assert.equal(result.checkRate.operation, 'checkrates');
    assert.equal(result.checkRate.data.hotel.rooms[0].rates[0].rateType, 'BOOKABLE');
    assert.equal(result.booking.data.booking.status, 'CONFIRMED');
    assert.equal(result.booking.data.booking.reference, result.voucher.booking.hotelbedsBookingReference);
    assert.equal(result.voucher.booking.hotelbedsBookingReference, 'HBX-MOCK-BOOKING-900001');
    assert.equal(result.voucher.hotel.name, result.hotelContent.name);
});

test('mock certification route is opt-in, public for mock UI, and non-cacheable', async context => {
    let serviceCalls = 0;
    const previousHotelbedsFlag = process.env.HOTELBEDS_ENABLED;
    process.env.HOTELBEDS_ENABLED = 'false';
    context.after(() => {
        if (previousHotelbedsFlag === undefined) delete process.env.HOTELBEDS_ENABLED;
        else process.env.HOTELBEDS_ENABLED = previousHotelbedsFlag;
    });
    const app = express();
    app.use('/api/hotelbeds', createHotelbedsMockCertificationRouter({
        service: { getMockCertificationFlow: async () => { serviceCalls += 1; return getMockCertificationFlow(); } },
        enabled: () => true
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
    }));
    const url = `http://127.0.0.1:${server.address().port}/api/hotelbeds/mock-certification-flow`;

    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    const body = await response.json();
    assert.equal(body.mock, true);
    assert.equal(body.supplierRequestsSent, 0);
    assert.ok(body.availability && body.checkRate && body.booking && body.voucher);
    assert.match(body.voucher.paymentStatement, /MOCK-VAT-NOT-VALID/);
    assert.equal(serviceCalls, 1);

    const disabledApp = express().use('/api/hotelbeds', createHotelbedsMockCertificationRouter({
        service: { getMockCertificationFlow: async () => { throw new Error('should not run'); } },
        enabled: () => false
    }));
    const disabledServer = await new Promise(resolve => {
        const instance = disabledApp.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => {
        disabledServer.closeAllConnections?.();
        disabledServer.close(() => resolve());
    }));
    const disabled = await fetch(`http://127.0.0.1:${disabledServer.address().port}/api/hotelbeds/mock-certification-flow`);
    assert.equal(disabled.status, 404);
});