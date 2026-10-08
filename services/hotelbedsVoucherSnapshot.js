const crypto = require('node:crypto');

const MAX_ROOMS = 9;
const MAX_PASSENGERS = 36;
const MAX_RATES_PER_ROOM = 10;
const { normalizeHotelbedsRateComments } = require('./hotelbedsRateComments');

function fail(code, httpStatus = 409) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function boundedText(value, maxLength) {
    return typeof value === 'string' && value.trim() && value.length <= maxLength
        && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeCustomerName(value) {
    return typeof value === 'string'
        ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : '';
}

function customerFingerprint(value) {
    const normalized = normalizeCustomerName(value);
    if (!normalized || normalized.length > 401 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return crypto.createHash('sha256').update(`hotelbeds-voucher-customer-v1:${normalized}`, 'utf8').digest('hex');
}

function normalizedRateComments(value) {
    return normalizeHotelbedsRateComments(value);
}

function hotelbedsVoucherSnapshotFromResponse(response, {
    bookingReference,
    clientReference,
    ownerSubject,
    realm,
    accountId,
    hotelCode,
    contentLanguage,
    customerName,
    roomCode: expectedRoomCode,
    boardCode: expectedBoardCode,
    checkIn,
    checkOut,
    roomCount,
    adultCount,
    childCount,
    expectedHolder,
    expectedPassengers,
    acceptedRateComments
} = {}) {
    const booking = response?.data?.booking;
    if (!response?.ok || !booking || typeof booking !== 'object' || Array.isArray(booking)) return null;
    const hotel = booking.hotel;
    if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) return null;

    const reference = boundedText(booking.reference, 200);
    const supplierClientReference = boundedText(booking.clientReference, 20);
    const status = typeof booking.status === 'string' ? booking.status.trim().toUpperCase() : '';
    const resolvedHotelCode = Number(hotelCode);
    const expectedHotelCode = Number.isSafeInteger(resolvedHotelCode) && resolvedHotelCode > 0
        ? resolvedHotelCode : null;
    const returnedHotelCode = booking.hotel?.code;
    const holder = booking.holder;
    const holderName = boundedText(holder?.name, 50);
    const holderSurname = boundedText(holder?.surname, 50);
    const expectedOwner = boundedText(ownerSubject, 254);
    const expectedRealm = boundedText(realm, 100);
    const expectedAccountId = typeof accountId === 'string' && /^[a-f\d]{64}$/i.test(accountId)
        ? accountId.toLowerCase() : null;
    const expectedContentLanguage = typeof contentLanguage === 'string' && /^[A-Z]{2,12}$/i.test(contentLanguage.trim())
        ? contentLanguage.trim().toUpperCase() : null;
    const expectedCustomerFingerprint = customerFingerprint(customerName);
    const holderFingerprint = customerFingerprint([holderName, holderSurname].filter(Boolean).join(' '));
    const acceptedCommentsProvided = acceptedRateComments !== undefined;
    const normalizedAcceptedComments = acceptedCommentsProvided
        ? normalizedRateComments(acceptedRateComments) : null;
    if (acceptedCommentsProvided && normalizedAcceptedComments === null) return null;

    if (!reference || reference !== bookingReference
        || !supplierClientReference || supplierClientReference !== clientReference
        || !['CONFIRMED', 'ON_REQUEST', 'PENDING'].includes(status)
        || !expectedHotelCode || !Number.isSafeInteger(returnedHotelCode) || returnedHotelCode !== expectedHotelCode
        || !expectedOwner || !expectedRealm || !expectedAccountId || !expectedContentLanguage
        || !boundedText(expectedRoomCode, 200) || !boundedText(expectedBoardCode, 80)
        || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn
        || roomCount !== 1
        || !Number.isSafeInteger(adultCount) || adultCount < 1 || adultCount > MAX_PASSENGERS
        || !Number.isSafeInteger(childCount) || childCount < 0 || childCount > MAX_PASSENGERS
        || !expectedHolder || typeof expectedHolder.name !== 'string'
        || typeof expectedHolder.surname !== 'string'
        || normalizeCustomerName(holderName) !== normalizeCustomerName(expectedHolder.name)
        || normalizeCustomerName(holderSurname) !== normalizeCustomerName(expectedHolder.surname)
        || !Array.isArray(expectedPassengers) || expectedPassengers.length !== adultCount + childCount
        || !holderName || !holderSurname
        || !expectedCustomerFingerprint || holderFingerprint !== expectedCustomerFingerprint) return null;

    if (hotel.checkIn !== checkIn || hotel.checkOut !== checkOut
        || !Array.isArray(hotel.rooms) || hotel.rooms.length !== roomCount) return null;

    const rooms = [];
    let passengerCount = 0;
    for (const room of hotel.rooms) {
        if (!room || typeof room !== 'object' || Array.isArray(room)
            || typeof room.status === 'string' && room.status.trim().toUpperCase() !== 'CONFIRMED'
            || !Array.isArray(room.paxes) || room.paxes.length < 1
            || !Array.isArray(room.rates) || room.rates.length !== 1
            || room.rates.length > MAX_RATES_PER_ROOM) return null;
        passengerCount += room.paxes.length;
        if (passengerCount > MAX_PASSENGERS) return null;

        const roomName = boundedText(room.name, 200);
        const roomCode = boundedText(room.code, 100);
        if (!roomName && !roomCode || !roomCode || roomCode !== expectedRoomCode) return null;

        const paxes = [];
        for (const pax of room.paxes) {
            const name = boundedText(pax?.name, 50);
            const type = typeof pax?.type === 'string' ? pax.type.trim().toUpperCase() : '';
            const surname = typeof pax?.surname === 'string' ? boundedText(pax.surname, 50) : undefined;
            if (!name || !['AD', 'CH'].includes(type)
                || pax?.surname !== undefined && (typeof pax.surname !== 'string' || pax.surname.trim().length > 50
                    || /[\u0000-\u001f\u007f]/.test(pax.surname))
                || pax?.age !== undefined && (!Number.isSafeInteger(pax.age) || pax.age < 0 || pax.age > 99)
                || type === 'CH' && !Number.isSafeInteger(pax.age)) return null;
            paxes.push({
                type,
                name,
                ...(surname ? { surname } : {}),
                ...(pax.age === undefined ? {} : { age: pax.age })
            });
        }
        const expectedRoomPassengers = expectedPassengers.filter(passenger => passenger?.roomId === 1);
        if (expectedRoomPassengers.length !== paxes.length || paxes.some((pax, index) => {
            const expected = expectedRoomPassengers[index];
            return !expected || pax.type !== expected.type || pax.name !== expected.name
                || (pax.surname || '') !== (expected.surname || '')
                || pax.age !== expected.age;
        })) return null;

        const rates = [];
        for (const rate of room.rates) {
            if (!rate || typeof rate !== 'object' || Array.isArray(rate)) return null;
            const boardCode = boundedText(rate.boardCode, 80);
            const boardName = boundedText(rate.boardName, 120);
            const hasConfirmationComments = Object.hasOwn(rate, 'rateComments')
                && rate.rateComments !== undefined && rate.rateComments !== null;
            const confirmationComments = normalizedRateComments(rate.rateComments);
            if (confirmationComments === null || !acceptedCommentsProvided && !hasConfirmationComments) return null;
            const rateComments = acceptedCommentsProvided
                ? normalizedAcceptedComments
                : confirmationComments;
            const sameComments = !acceptedCommentsProvided || !hasConfirmationComments
                || JSON.stringify([...confirmationComments].sort())
                    === JSON.stringify([...normalizedAcceptedComments].sort());
            if (!boardCode || boardCode.trim().toUpperCase() !== expectedBoardCode.trim().toUpperCase()
                || !boardName || !sameComments) return null;
            rates.push({
                ...(boardCode ? { boardCode } : {}),
                ...(boardName ? { boardName } : {}),
                ...(rateComments.length ? { rateComments } : {}),
                rateCommentsSource: acceptedCommentsProvided
                    ? hasConfirmationComments ? 'booking_confirmation' : 'accepted_checkrate'
                    : 'booking_confirmation'
            });
        }

        rooms.push({
            ...(roomName ? { name: roomName } : {}),
            ...(roomCode ? { code: roomCode } : {}),
            paxes,
            rates
        });
    }

    const bookingPaxes = rooms.flatMap(room => room.paxes);
    if (bookingPaxes.length !== adultCount + childCount
        || bookingPaxes.filter(pax => pax.type === 'AD').length !== adultCount
        || bookingPaxes.filter(pax => pax.type === 'CH').length !== childCount) return null;

    const supplier = hotel.supplier;
    const supplierName = boundedText(supplier?.name, 200);
    const supplierVatNumber = boundedText(supplier?.vatNumber, 100);
    const confirmation = {
        reference,
        clientReference: supplierClientReference,
        status,
        holder: { name: holderName, surname: holderSurname },
        hotel: {
            code: expectedHotelCode,
            checkIn: hotel.checkIn,
            checkOut: hotel.checkOut,
            ...(supplierName || supplierVatNumber ? {
                supplier: {
                    ...(supplierName ? { name: supplierName } : {}),
                    ...(supplierVatNumber ? { vatNumber: supplierVatNumber } : {})
                }
            } : {}),
            rooms
        }
    };

    return {
        version: 1,
        binding: {
            ownerSubject: expectedOwner,
            realm: expectedRealm,
            accountId: expectedAccountId,
            contentLanguage: expectedContentLanguage,
            customerName: customerName.trim().replace(/\s+/g, ' '),
            bookingReference: reference,
            clientReference: supplierClientReference,
            hotelCode: expectedHotelCode,
            customerFingerprint: holderFingerprint
        },
        confirmation
    };
}

function hotelbedsVoucherSnapshotMatchesBooking(snapshot, booking, { accountId } = {}) {
    const binding = snapshot?.binding;
    const confirmation = snapshot?.confirmation;
    const confirmationHotel = confirmation?.hotel;
    const expectedHotelCode = Number(booking?.providerHotelCode);
    return snapshot?.version === 1
        && Boolean(binding && confirmation && confirmationHotel)
        && binding.bookingReference === booking?.bookingReference
        && confirmation.reference === booking?.bookingReference
        && (!confirmation.clientReference || binding.clientReference === booking?.bookingClientReference
            && confirmation.clientReference === booking?.bookingClientReference)
        && binding.ownerSubject === booking?.ownerSubject
        && binding.realm === booking?.realm
        && binding.accountId === accountId
        && Number.isSafeInteger(expectedHotelCode) && expectedHotelCode > 0
        && binding.hotelCode === expectedHotelCode
        && confirmationHotel.code === expectedHotelCode
        && confirmationHotel.checkIn === booking?.checkInDate
        && confirmationHotel.checkOut === booking?.checkOutDate
        && customerFingerprint(booking?.customerName) === binding.customerFingerprint
        && confirmation.status === booking?.supplierStatus
        && confirmation.status === 'CONFIRMED'
        && booking?.status === 'active'
        && ['cancelled', 'canceled'].includes(String(booking?.status).toLowerCase()) === false;
}

module.exports = {
    customerFingerprint,
    hotelbedsVoucherSnapshotFromResponse,
    hotelbedsVoucherSnapshotMatchesBooking
};