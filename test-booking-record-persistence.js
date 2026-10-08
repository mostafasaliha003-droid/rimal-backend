const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBookingRecordPersistence } = require('./services/bookingRecordPersistence');

function memoryBookingModel(existing = null) {
    const writes = [];
    return {
        writes,
        findOneAndUpdate(filter, update, options) {
            return { lean: async () => {
                writes.push({ filter, update, options });
                if (existing && (existing.bookingReference !== filter.bookingReference
                    || existing.ownerSubject !== filter.ownerSubject || existing.realm !== filter.realm
                    || existing.provider !== filter.provider)) {
                    if (options.upsert) throw Object.assign(new Error('duplicate key'), { code: 11000 });
                    return null;
                }
                if (options.upsert === false && filter.status?.$nin
                    && filter.status.$nin.includes(String(existing?.status).toLowerCase())) return null;
                if (existing) Object.assign(existing, update.$set || {});
                else existing = { ...(update.$setOnInsert || {}), ...(update.$set || {}) };
                return existing;
            } };
        },
        findOne(filter) {
            return { lean: async () => existing?.bookingReference === filter.bookingReference ? existing : null };
        }
    };
}

const base = {
    bookingReference: 'HBX-BOOKING-1', ownerSubject: 'user-1',
    guestDetails: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '+971500000000' },
    bookingStatus: 'CONFIRMED', paymentMethod: 'hotel', clientReference: 'RMLABCDEFGHIJKL',
    offer: { providerHotelCode: '74001', lockedSellAmount: '495.25', lockedSellCurrency: 'AED',
        bookingMetadata: { hotelName: 'Fixture Hotel', roomName: 'Double room', boardName: 'Breakfast',
            checkIn: '2026-11-10', checkOut: '2026-11-12' } }
};

test('confirmed bookings are durably linked to the authenticated owner and safe booking projection', async () => {
    const BookingModel = memoryBookingModel();
    const saved = await createBookingRecordPersistence({ BookingModel, realm: 'fixture-realm' }).persist(base);
    assert.equal(saved.ownerSubject, 'user-1');
    assert.equal(saved.realm, 'fixture-realm');
    assert.equal(saved.provider, 'hotelbeds');
    assert.equal(saved.status, 'active');
    assert.equal(saved.providerHotelCode, '74001');
    assert.equal(saved.price, 495.25);
    assert.equal(saved.priceCurrency, 'AED');
    assert.equal(saved.email, 'ada@example.test');
    assert.equal(saved.checkInDate, '2026-11-10');
    assert.equal(saved.checkOutDate, '2026-11-12');
    assert.equal(BookingModel.writes[0].options.upsert, true);
    assert.equal(BookingModel.writes[0].options.writeConcern.w, 'majority');
    assert.equal(Object.hasOwn(BookingModel.writes[0].update.$setOnInsert, 'cardNumber'), false);
});

test('confirmed supplier result promotes an owner-matched pending booking without changing identity', async () => {
    const BookingModel = memoryBookingModel({ bookingReference: base.bookingReference, ownerSubject: base.ownerSubject,
        realm: 'fixture-realm', provider: 'hotelbeds', status: 'pending', supplierStatus: 'ON_REQUEST' });
    const saved = await createBookingRecordPersistence({ BookingModel, realm: 'fixture-realm' }).persist(base);
    assert.equal(saved.status, 'active');
    assert.equal(saved.supplierStatus, 'CONFIRMED');
    assert.equal(saved.ownerSubject, base.ownerSubject);
    assert.deepEqual(BookingModel.writes[0].filter, { bookingReference: base.bookingReference,
        ownerSubject: base.ownerSubject, realm: 'fixture-realm', provider: 'hotelbeds' });
});

test('pending supplier outcomes remain pending and never become confirmed customer bookings', async () => {
    const BookingModel = memoryBookingModel();
    const saved = await createBookingRecordPersistence({ BookingModel, realm: 'fixture-realm' })
        .persist({ ...base, bookingStatus: 'ON_REQUEST' });
    assert.equal(saved.status, 'pending');
    assert.equal(saved.supplierStatus, 'ON_REQUEST');
});

test('booking persistence rejects missing owners and duplicate references owned by another account', async () => {
    const persistence = createBookingRecordPersistence({ BookingModel: memoryBookingModel({
        bookingReference: base.bookingReference, ownerSubject: 'other-user', realm: 'fixture-realm', provider: 'hotelbeds'
    }), realm: 'fixture-realm' });
    await assert.rejects(persistence.persist({ ...base, ownerSubject: undefined }), /booking_record_identity_invalid/);
    await assert.rejects(persistence.persist(base), error =>
        error.code === 'booking_record_owner_conflict' && error.httpStatus === 409);
});

test('late pending supplier delivery cannot downgrade a previously confirmed owned booking', async () => {
    const BookingModel = memoryBookingModel({ bookingReference: base.bookingReference, ownerSubject: base.ownerSubject,
        realm: 'fixture-realm', provider: 'hotelbeds', status: 'active', supplierStatus: 'CONFIRMED' });
    const saved = await createBookingRecordPersistence({ BookingModel, realm: 'fixture-realm' })
        .persist({ ...base, bookingStatus: 'ON_REQUEST' });
    assert.equal(saved.status, 'active');
    assert.equal(saved.supplierStatus, 'CONFIRMED');
});

test('cancelled booking is never resurrected by a late supplier confirmation', async () => {
    const BookingModel = memoryBookingModel({ bookingReference: base.bookingReference, ownerSubject: base.ownerSubject,
        realm: 'fixture-realm', provider: 'hotelbeds', status: 'cancelled', supplierStatus: 'CONFIRMED' });
    const persistence = createBookingRecordPersistence({ BookingModel, realm: 'fixture-realm' });
    await assert.rejects(persistence.persist(base), error =>
        error.code === 'booking_record_terminal_state_conflict' && error.httpStatus === 409);
});

test('confirmed voucher snapshot is saved with its hotel identity and processed marker', async () => {
    const encryptedSnapshot = { iv: 'a'.repeat(24), tag: 'b'.repeat(32), ciphertext: 'YQ==' };
    const BookingModel = memoryBookingModel();
    const saved = await createBookingRecordPersistence({ BookingModel, realm: 'fixture-realm' }).persist({
        ...base,
        hotelbedsVoucherSnapshotEncrypted: encryptedSnapshot,
        hotelbedsVoucherSnapshotProcessed: true
    });
    assert.equal(saved.providerHotelCode, '74001');
    assert.deepEqual(saved.hotelbedsVoucherSnapshotEncrypted, encryptedSnapshot);
    assert.equal(saved.hotelbedsVoucherSnapshotProcessed, true);
    assert.equal(BookingModel.writes[0].update.$setOnInsert.providerHotelCode, '74001');
});

test('missing, empty, malformed and whitespace-only realms fail closed before a booking write', async () => {
    const invalidRealms = [undefined, '', '  ', ' realm ', 'realm with spaces', 'x'.repeat(101)];
    for (const realm of invalidRealms) {
        const options = { BookingModel: memoryBookingModel(), env: {} };
        if (realm !== undefined) options.realm = realm;
        const persistence = createBookingRecordPersistence(options);
        await assert.rejects(persistence.persist(base), error =>
            error.code === 'booking_record_scope_unavailable' && error.httpStatus === 503);
    }
});

test('configured canonical realm scopes durable booking identity', async () => {
    const BookingModel = memoryBookingModel();
    const saved = await createBookingRecordPersistence({ BookingModel, realm: 'production:main' }).persist(base);
    assert.equal(saved.realm, 'production:main');
    assert.equal(BookingModel.writes[0].filter.realm, 'production:main');
});
