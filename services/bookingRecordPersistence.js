const crypto = require('node:crypto');

function fail(code, httpStatus = 503) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function encryptionKey(env = process.env) {
    const value = typeof env?.PAYMENT_BOOKING_ENCRYPTION_KEY === 'string'
        ? env.PAYMENT_BOOKING_ENCRYPTION_KEY : '';
    if (!/^[a-f\d]{64}$/i.test(value)) throw fail('booking_record_encryption_unavailable', 503);
    return Buffer.from(value, 'hex');
}

function createEncryptedBookingRecordPayloadSchema(mongooseInstance) {
    if (!mongooseInstance?.Schema) throw new TypeError('booking_record_schema_factory_invalid');
    return new mongooseInstance.Schema({
        iv: { type: String, required: true, match: /^[a-f\d]{24}$/i },
        tag: { type: String, required: true, match: /^[a-f\d]{32}$/i },
        ciphertext: { type: String, required: true, minlength: 1, maxlength: 65536 }
    }, { _id: false, strict: 'throw' });
}

function validEncryptedBookingRecordPayload(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || !/^[a-f\d]{24}$/i.test(envelope.iv || '')
        || !/^[a-f\d]{32}$/i.test(envelope.tag || '')
        || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 1
        || envelope.ciphertext.length > 65536 || envelope.ciphertext.length % 4 !== 0
        || !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(envelope.ciphertext)) return false;
    try { return Buffer.from(envelope.ciphertext, 'base64').toString('base64') === envelope.ciphertext; }
    catch { return false; }
}

function encryptBookingRecordPayload(payload, env = process.env) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('booking_record_payload_invalid', 400);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(env), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') };
}

function decryptBookingRecordPayload(envelope, env = process.env) {
    if (!validEncryptedBookingRecordPayload(envelope)) {
        throw fail('booking_record_payload_unavailable', 503);
    }
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(envelope.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
        const payload = JSON.parse(plaintext);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload_invalid');
        return payload;
    } catch {
        throw fail('booking_record_payload_unavailable', 503);
    }
}

function safeText(value, fallback = '', maxLength = 200) {
    if (typeof value !== 'string') return fallback;
    const text = value.trim();
    if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return fallback;
    return text;
}

function contactFrom(details) {
    const email = safeText(details?.email, '', 254).toLowerCase();
    const customerName = [details?.firstName, details?.lastName].map(value => safeText(value)).filter(Boolean).join(' ');
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !customerName) {
        throw fail('booking_record_contact_invalid', 409);
    }
    return { email, customerName, phone: safeText(details?.phone, '', 40) };
}

function amountFrom(offer) {
    const amount = offer?.lockedSellAmount;
    if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount)
        || !/^[A-Z]{3}$/.test(offer?.lockedSellCurrency || '')) return {};
    const number = Number(amount);
    return Number.isFinite(number) ? { price: number, priceCurrency: offer.lockedSellCurrency } : {};
}

function createBookingRecordPersistence(options = {}) {
    const { BookingModel, env = process.env } = options;
    const realm = options.realm === undefined ? env?.RIMAL_AUTH_REALM : options.realm;
    if (!BookingModel || typeof BookingModel.findOneAndUpdate !== 'function'
        || typeof BookingModel.findOne !== 'function'
        || !env || typeof env !== 'object' || Array.isArray(env)) {
        throw new TypeError('booking_record_persistence_dependencies_invalid');
    }
    const activeRealm = typeof realm === 'string' && realm === realm.trim()
        && /^[a-z0-9:_-]{1,100}$/i.test(realm) ? realm : null;

    async function persist({ bookingReference, ownerSubject, guestDetails, offer, bookingStatus, paymentMethod,
        clientReference, hotelbedsVoucherSnapshotEncrypted, hotelbedsVoucherSnapshotProcessed = false } = {}) {
        if (!activeRealm) throw fail('booking_record_scope_unavailable', 503);
        const reference = safeText(bookingReference, '', 200);
        const owner = safeText(ownerSubject, '', 254);
        const status = typeof bookingStatus === 'string' ? bookingStatus.trim().toUpperCase() : '';
        if (!reference || !owner || !['CONFIRMED', 'ON_REQUEST', 'PENDING'].includes(status)) {
            throw fail('booking_record_identity_invalid', 409);
        }
        const contact = contactFrom(guestDetails);
        const metadata = offer?.bookingMetadata || {};
        const providerHotelCode = safeText(offer?.providerHotelCode, '', 20);
        if (providerHotelCode && !/^\d{1,10}$/.test(providerHotelCode)) {
            throw fail('booking_record_hotel_code_invalid', 409);
        }
        if (hotelbedsVoucherSnapshotEncrypted !== undefined
            && !validEncryptedBookingRecordPayload(hotelbedsVoucherSnapshotEncrypted)) {
            throw fail('booking_record_voucher_snapshot_invalid', 409);
        }
        if (typeof hotelbedsVoucherSnapshotProcessed !== 'boolean'
            || hotelbedsVoucherSnapshotEncrypted && !hotelbedsVoucherSnapshotProcessed) {
            throw fail('booking_record_voucher_snapshot_invalid', 409);
        }
        const identity = {
            bookingReference: reference,
            ownerSubject: owner,
            realm: activeRealm,
            provider: 'hotelbeds'
        };
        const document = {
            supplierReference: reference,
            email: contact.email,
            customerName: contact.customerName,
            phone: contact.phone,
            hotelName: safeText(metadata.hotelName, `Hotel ${safeText(offer?.providerHotelCode, 'unknown', 100)}`),
            roomType: safeText(metadata.roomName, 'Hotel room'),
            boardType: safeText(metadata.boardName, 'Not specified'),
            paymentMethod: paymentMethod === 'ziina' ? 'visa' : 'hotel',
            status: status === 'CONFIRMED' ? 'active' : 'pending',
            supplierStatus: status,
            supplierPaymentType: safeText(metadata.paymentType, 'unknown', 40),
            cancellationPolicy: safeText(metadata.cancellationPolicy, 'Supplier terms apply', 2000),
            bookingClientReference: safeText(clientReference, '', 100),
            hotelbedsVoucherSnapshotProcessed,
            ...(providerHotelCode ? { providerHotelCode } : {}),
            ...(hotelbedsVoucherSnapshotEncrypted ? { hotelbedsVoucherSnapshotEncrypted } : {}),
            ...amountFrom(offer),
            ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {})
        };
        if (typeof metadata.checkIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.checkIn)) {
            document.checkInDate = metadata.checkIn;
        }
        if (typeof metadata.checkOut === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.checkOut)) {
            document.checkOutDate = metadata.checkOut;
        }
        if (!document.bookingClientReference) delete document.bookingClientReference;

        const options = {
            upsert: true,
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
        };

        let record;
        try {
            record = await BookingModel.findOneAndUpdate(identity, {
                $setOnInsert: { ...identity, ...document }
            }, options).lean();
        } catch (error) {
            if (error?.code !== 11000) {
                throw fail('booking_record_persistence_unavailable', 503);
            }
            try { record = await BookingModel.findOne({ bookingReference: reference }).lean(); }
            catch { throw fail('booking_record_persistence_unavailable', 503); }
            if (!record || record.ownerSubject !== owner || record.realm !== activeRealm
                || record.provider !== 'hotelbeds') {
                throw fail('booking_record_owner_conflict', 409);
            }
        }

        if (!record || record.ownerSubject !== owner || record.realm !== activeRealm
            || record.provider !== 'hotelbeds') {
            throw fail('booking_record_owner_conflict', 409);
        }
        if (['cancelled', 'canceled'].includes(String(record.status).toLowerCase())) {
            throw fail('booking_record_terminal_state_conflict', 409);
        }

        // Supplier PENDING/ON_REQUEST notifications may arrive after confirmation.
        // They may create a pending record, but may never downgrade an existing one.
        if (status !== 'CONFIRMED') return record;

        try {
            const confirmed = await BookingModel.findOneAndUpdate({
                ...identity,
                status: { $nin: ['cancelled', 'canceled'] }
            }, { $set: document }, { ...options, upsert: false }).lean();
            if (confirmed) return confirmed;
        } catch {
            // Read below: the confirmation write may have succeeded despite a
            // transient driver error. Never turn that uncertainty into another
            // supplier request; this path only reconciles our local booking row.
        }

        let current;
        try { current = await BookingModel.findOne({ bookingReference: reference }).lean(); }
        catch { throw fail('booking_record_persistence_unavailable', 503); }
        if (!current || current.ownerSubject !== owner || current.realm !== activeRealm
            || current.provider !== 'hotelbeds'
            || ['cancelled', 'canceled'].includes(String(current.status).toLowerCase())) {
            throw fail('booking_record_terminal_state_conflict', 409);
        }
        if (current.status === 'active' && current.supplierStatus === 'CONFIRMED') return current;
        throw fail('booking_record_persistence_unavailable', 503);
    }

    return { persist };
}

module.exports = {
    createBookingRecordPersistence,
    createEncryptedBookingRecordPayloadSchema,
    encryptBookingRecordPayload,
    decryptBookingRecordPayload,
    validEncryptedBookingRecordPayload,
    safeText,
    contactFrom,
    amountFrom
};