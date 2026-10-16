const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    hotelbedsVoucherSnapshotFromResponse,
    hotelbedsVoucherSnapshotMatchesBooking
} = require('./services/hotelbedsVoucherSnapshot');

const options = {
    bookingReference: 'HBX-SNAPSHOT-1',
    clientReference: 'RMLSNAPSHOTTEST1',
    ownerSubject: 'owner-1',
    realm: 'snapshot-fixture-realm',
    accountId: 'a'.repeat(64),
    hotelCode: '74001',
    contentLanguage: 'ENG',
    customerName: 'Ada Lovelace',
    roomCode: 'DBL.ST',
    boardCode: 'BB',
    checkIn: '2026-11-10',
    checkOut: '2026-11-12',
    roomCount: 1,
    adultCount: 1,
    childCount: 0,
    expectedHolder: { name: 'Ada', surname: 'Lovelace' },
    expectedPassengers: [{ roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' }]
};

function supplierResponse(overrides = {}) {
    const booking = {
        reference: options.bookingReference,
        clientReference: options.clientReference,
        status: 'CONFIRMED',
        holder: { name: 'Ada', surname: 'Lovelace' },
        hotel: {
            code: 74001,
            checkIn: options.checkIn,
            checkOut: options.checkOut,
            supplier: { name: 'Fixture Supplier', vatNumber: 'FIXTURE-VAT' },
            rooms: [{
                code: 'DBL.ST',
                name: 'Double Standard',
                paxes: [{ name: 'Ada', surname: 'Lovelace', type: 'AD' }],
                rates: [{ boardCode: 'BB', boardName: 'Bed and Breakfast',
                    rateComments: [{ description: 'Check-in after 15:00.' }] }]
            }]
        },
        ...overrides
    };
    return { ok: true, data: { booking } };
}

test('confirmed Hotelbeds response becomes a bounded owner-bound voucher snapshot', () => {
    const snapshot = hotelbedsVoucherSnapshotFromResponse(supplierResponse(), options);
    assert.ok(snapshot);
    assert.equal(snapshot.binding.ownerSubject, options.ownerSubject);
    assert.equal(snapshot.binding.accountId, options.accountId);
    assert.equal(snapshot.confirmation.hotel.code, 74001);
    assert.deepEqual(snapshot.confirmation.hotel.rooms[0].rates[0].rateComments, ['Check-in after 15:00.']);

    const booking = {
        bookingReference: options.bookingReference,
        bookingClientReference: options.clientReference,
        ownerSubject: options.ownerSubject,
        realm: options.realm,
        providerHotelCode: '74001',
        customerName: options.customerName,
        checkInDate: options.checkIn,
        checkOutDate: options.checkOut,
        supplierStatus: 'CONFIRMED',
        status: 'active'
    };
    assert.equal(hotelbedsVoucherSnapshotMatchesBooking(snapshot, booking, {
        accountId: options.accountId
    }), true);
    assert.equal(hotelbedsVoucherSnapshotMatchesBooking(snapshot, {
        ...booking,
        ownerSubject: 'another-owner'
    }, { accountId: options.accountId }), false);
    assert.equal(hotelbedsVoucherSnapshotMatchesBooking(snapshot, {
        ...booking,
        checkOutDate: '2026-11-13'
    }, { accountId: options.accountId }), false);
});

test('snapshot rejects mismatched hotel, board, stay, passenger and oversized supplier comments', () => {
    const cases = [
        [supplierResponse({ hotel: { ...supplierResponse().data.booking.hotel, code: 74002 } }), options],
        [supplierResponse({ hotel: { ...supplierResponse().data.booking.hotel, checkIn: '2026-11-11' } }), options],
        [supplierResponse({ hotel: { ...supplierResponse().data.booking.hotel, rooms: [{
            ...supplierResponse().data.booking.hotel.rooms[0],
            paxes: [{ name: 'Grace', surname: 'Hopper', type: 'AD' }]
        }] } }), options],
        [supplierResponse({ hotel: { ...supplierResponse().data.booking.hotel, rooms: [{
            ...supplierResponse().data.booking.hotel.rooms[0],
            rates: [{ boardCode: 'RO', boardName: 'Room only' }]
        }] } }), options],
        [supplierResponse({ hotel: { ...supplierResponse().data.booking.hotel, rooms: [{
            ...supplierResponse().data.booking.hotel.rooms[0],
            rates: [{ boardCode: 'BB', boardName: 'Bed and Breakfast', rateComments: 'x'.repeat(2001) }]
        }] } }), options]
    ];
    for (const [response, expected] of cases) {
        assert.equal(hotelbedsVoucherSnapshotFromResponse(response, expected), null);
    }
});

test('snapshot preserves accepted CheckRate comments when confirmation omits them and rejects conflicts', () => {
    const acceptedRateComments = ['Check-in after 15:00.', 'Local fee payable at property.'];
    const responseWithoutComments = structuredClone(supplierResponse());
    delete responseWithoutComments.data.booking.hotel.rooms[0].rates[0].rateComments;
    const snapshot = hotelbedsVoucherSnapshotFromResponse(responseWithoutComments, {
        ...options,
        acceptedRateComments
    });
    assert.ok(snapshot);
    assert.deepEqual(snapshot.confirmation.hotel.rooms[0].rates[0].rateComments, acceptedRateComments);
    assert.equal(snapshot.confirmation.hotel.rooms[0].rates[0].rateCommentsSource, 'accepted_checkrate');

    const matchingResponse = supplierResponse({
        hotel: {
            ...supplierResponse().data.booking.hotel,
            rooms: [{
                ...supplierResponse().data.booking.hotel.rooms[0],
                rates: [{ boardCode: 'BB', boardName: 'Bed and Breakfast', rateComments: acceptedRateComments }]
            }]
        }
    });
    const matching = hotelbedsVoucherSnapshotFromResponse(matchingResponse, {
        ...options,
        acceptedRateComments
    });
    assert.ok(matching);
    assert.equal(matching.confirmation.hotel.rooms[0].rates[0].rateCommentsSource, 'booking_confirmation');

    const conflictingResponse = supplierResponse({
        hotel: {
            ...supplierResponse().data.booking.hotel,
            rooms: [{
                ...supplierResponse().data.booking.hotel.rooms[0],
                rates: [{ boardCode: 'BB', boardName: 'Bed and Breakfast', rateComments: ['A different condition.'] }]
            }]
        }
    });
    assert.equal(hotelbedsVoucherSnapshotFromResponse(conflictingResponse, {
        ...options,
        acceptedRateComments
    }), null);
});

test('snapshot refuses to interpret absent confirmation RateComments as an empty list without accepted terms', () => {
    const response = structuredClone(supplierResponse());
    delete response.data.booking.hotel.rooms[0].rates[0].rateComments;
    assert.equal(hotelbedsVoucherSnapshotFromResponse(response, options), null);
});

test('snapshot comment payload is bounded for the encrypted booking record', () => {
    const excessive = Array.from({ length: 13 }, (_, index) => `${index}:${'x'.repeat(1990)}`);
    assert.equal(hotelbedsVoucherSnapshotFromResponse(supplierResponse(), {
        ...options,
        acceptedRateComments: excessive
    }), null);
});

test('snapshot follows Hotelbeds confirmation age bounds and rejects cancelled room statuses', () => {
    const childOptions = {
        ...options,
        adultCount: 1,
        childCount: 1,
        customerName: 'Ada Lovelace',
        expectedHolder: { name: 'Ada', surname: 'Lovelace' },
        expectedPassengers: [
            { roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' },
            { roomId: 1, type: 'CH', age: 20, name: 'Older Child', surname: 'Fixture' }
        ]
    };
    const responseWithChild = {
        ...supplierResponse(),
        data: { booking: {
            ...supplierResponse().data.booking,
            hotel: {
                ...supplierResponse().data.booking.hotel,
                rooms: [{
                    status: 'CONFIRMED',
                    ...supplierResponse().data.booking.hotel.rooms[0],
                    paxes: [
                        { roomId: 1, type: 'AD', name: 'Ada', surname: 'Lovelace' },
                        { roomId: 1, type: 'CH', age: 20, name: 'Older Child', surname: 'Fixture' }
                    ]
                }]
            }
        } }
    };
    assert.ok(hotelbedsVoucherSnapshotFromResponse(responseWithChild, childOptions));

    const cancelledRoomResponse = {
        ...responseWithChild,
        data: { booking: {
            ...responseWithChild.data.booking,
            hotel: {
                ...responseWithChild.data.booking.hotel,
                rooms: [{ ...responseWithChild.data.booking.hotel.rooms[0], status: 'CANCELLED' }]
            }
        } }
    };
    assert.equal(hotelbedsVoucherSnapshotFromResponse(cancelledRoomResponse, childOptions), null);
});