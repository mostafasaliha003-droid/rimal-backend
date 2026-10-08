const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const HotelbedsHotel = require('./models/HotelbedsHotel');
const {
    createHotelbedsContentService,
    normalizeHotelContent
} = require('./services/hotelbedsContentService');
const { generateVoucher, renderVoucherHtml } = require('./services/hotelbedsVoucherService');
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
    status: 'CONFIRMED',
    bookingReference: 'HBX-REF-123',
    agencyReference: 'RMLREF123456789',
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

test('Hotelbeds legacy content model remains isolated and requires its established fields', () => {
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

test('approved Content API normalization permits missing recommended category and phone', () => {
    const normalized = normalizeHotelContent({
        code: 12345,
        language: 'ENG',
        name: { content: 'Fixture Hotel without recommended fields' },
        address: { content: '1 Fixture Road', city: 'Dubai' }
    }, { provenance: 'hotelbeds_content_api', requirePhone: false, requireCategory: false });
    assert.equal(Object.hasOwn(normalized, 'category'), false);
    assert.equal(Object.hasOwn(normalized, 'phone'), false);
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
    assert.equal(voucher.booking.agencyReference, 'RMLREF123456789');
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

test('voucher omits absent recommended category, phone and agency reference without placeholders', () => {
    const voucher = generateVoucher({
        ...validBooking,
        agencyReference: undefined,
        clientReference: undefined
    }, {
        name: 'Fixture Hotel',
        address: '1 Fixture Road, Dubai, UAE'
    });
    assert.deepEqual(voucher.hotel, {
        name: 'Fixture Hotel',
        address: '1 Fixture Road, Dubai, UAE'
    });
    assert.equal(Object.hasOwn(voucher.booking, 'agencyReference'), false);
    const html = renderVoucherHtml(
        '<div>{{agencyReferenceField}}</div><div>{{hotelCategoryField}}</div><div>{{hotelPhoneField}}</div>', voucher
    );
    assert.equal(html, '<div></div><div></div><div></div>');
});

test('voucher rejects malformed or over-limit rate comments rather than silently dropping them', () => {
    const malformed = structuredClone(validBooking);
    malformed.rooms[0].rateComments = ['   '];
    assert.throws(() => generateVoucher(malformed, validContent), /hotelbeds_voucher_rate_comment_invalid/);
    const oversized = structuredClone(validBooking);
    oversized.rooms[0].rateComments = ['x'.repeat(2001)];
    assert.throws(() => generateVoucher(oversized, validContent), /hotelbeds_voucher_rate_comment_invalid/);
});

test('Hotelbeds voucher HTML escapes supplier data and includes nested rate comments', () => {
    const voucher = generateVoucher({
        booking: {
            reference: 'HBX-HTML-1', clientReference: 'RMLHTMLREFERENCE1', status: 'CONFIRMED',
            holder: { name: 'Ada', surname: 'Lovelace' },
            hotel: {
                checkIn: '2030-06-15', checkOut: '2030-06-16',
                supplier: { name: 'Supplier <script>', vatNumber: 'VAT-1' },
                rooms: [{ name: 'Double Room', paxes: [{ name: 'Ada', surname: 'Lovelace', type: 'AD' }],
                    rates: [{ boardName: 'BED AND BREAKFAST', rateComments: 'Check-in is after 15:00.' }] }]
            }
        }
    }, validContent);
    const html = renderVoucherHtml('<h1>{{hotelName}}</h1>{{roomSections}}<p>{{paymentStatement}}</p>', voucher);
    assert.match(html, /Check-in is after 15:00\./);
    assert.match(html, /BED AND BREAKFAST/);
    assert.match(html, /Supplier &lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});

test('voucher accepts Hotelbeds-style confirmation fields and keeps client reference out of agency reference', () => {
    const confirmation = {
        booking: {
            reference: 'HBX-RSP-1', clientReference: 'RMLRESPONSETST1', status: 'CONFIRMED', holder: { name: 'Lead', surname: 'Passenger' },
            hotel: { checkIn: '2030-06-15', checkOut: '2030-06-16', rooms: [{
            code: 'TWIN', name: 'Twin Room', boardCode: 'RO', boardName: 'ROOM ONLY',
            paxes: [{ name: 'Lead', surname: 'Passenger', type: 'AD' }],
            rates: [{ boardCode: 'RO', boardName: 'ROOM ONLY', rateComments: 'No meals included.' }]
            }] }
        },
        supplier: { name: 'Hotelbeds', vatNumber: 'VAT-54321' }
    };
    const voucher = generateVoucher(confirmation, validContent);
    assert.equal(voucher.booking.hotelbedsBookingReference, 'HBX-RSP-1');
    assert.equal(Object.hasOwn(voucher.booking, 'agencyReference'), false);
    assert.equal(voucher.booking.rooms[0].roomType, 'Twin Room');
    assert.deepEqual(voucher.booking.rooms[0].rateComments, ['No meals included.']);
    assert.equal(renderVoucherHtml('<div>{{agencyReferenceField}}</div>', voucher), '<div></div>');

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

test('voucher omits recommended fields but fails closed for mandatory fields and invalid dates', () => {
    assert.throws(() => generateVoucher({ ...validBooking, bookingReference: '' }, validContent), /hotelbeds_voucher_booking_reference_missing/);
    const optionalContent = { ...validContent, category: undefined, phone: '' };
    const optionalVoucher = generateVoucher({ ...validBooking, agencyReference: undefined }, optionalContent);
    assert.equal(Object.hasOwn(optionalVoucher.hotel, 'category'), false);
    assert.equal(Object.hasOwn(optionalVoucher.hotel, 'phone'), false);
    assert.equal(Object.hasOwn(optionalVoucher.booking, 'agencyReference'), false);
    assert.throws(() => generateVoucher(validBooking, { ...optionalContent, name: '' }), /hotelbeds_voucher_hotel_name_missing/);
    assert.throws(() => generateVoucher(validBooking, { ...optionalContent, address: '' }), /hotelbeds_voucher_hotel_address_missing/);
    assert.throws(() => generateVoucher({ ...validBooking, checkOut: '2030-02-30' }, validContent), /hotelbeds_voucher_check_out_invalid/);
    assert.throws(() => generateVoucher({ ...validBooking, checkOut: '2030-06-14' }, validContent), /hotelbeds_voucher_stay_invalid/);
    assert.throws(() => generateVoucher({ ...validBooking, status: 'ON_REQUEST' }, validContent),
        /hotelbeds_voucher_booking_not_confirmed/);
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