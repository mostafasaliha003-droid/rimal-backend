function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function requiredText(value, code, maxLength = 300) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw fail(code);
    }
    return value.trim();
}

function requiredDate(value, code) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(code);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fail(code);
    return value;
}

function fullName(passenger, code) {
    if (!passenger || typeof passenger !== 'object' || Array.isArray(passenger)) throw fail(code);
    const parts = [passenger.firstName || passenger.name, passenger.lastName || passenger.surname]
        .filter(value => typeof value === 'string' && value.trim())
        .map(value => value.trim());
    return requiredText(parts.join(' '), code, 200);
}

function categoryName(category) {
    if (typeof category === 'string') return requiredText(category, 'hotelbeds_voucher_hotel_category_missing', 100);
    return requiredText(category?.name, 'hotelbeds_voucher_hotel_category_missing', 100);
}

function mapPassenger(passenger) {
    const name = fullName(passenger, 'hotelbeds_voucher_passenger_name_missing');
    const isChild = passenger.isChild === true
        || Number.isInteger(passenger.age)
        || ['CH', 'CHILD'].includes(String(passenger.type || '').toUpperCase());
    if (isChild && (!Number.isInteger(passenger.age) || passenger.age < 0 || passenger.age > 17)) {
        throw fail('hotelbeds_voucher_child_age_missing');
    }
    return {
        name,
        ...(isChild ? { type: 'child', age: passenger.age } : { type: 'adult' })
    };
}

function bookingReferenceFrom(confirmation) {
    const booking = confirmation.booking && typeof confirmation.booking === 'object'
        ? confirmation.booking : confirmation;
    return booking.bookingReference || confirmation.bookingReference || booking.reference
        || confirmation.reference || confirmation.hotel?.reference;
}

function hotelBookingFrom(confirmation) {
    if (confirmation.hotel && typeof confirmation.hotel === 'object') return confirmation.hotel;
    if (confirmation.booking?.hotel && typeof confirmation.booking.hotel === 'object') {
        return confirmation.booking.hotel;
    }
    const hotels = confirmation.hotels?.hotels || confirmation.booking?.hotels?.hotels;
    if (Array.isArray(hotels) && hotels.length === 1) return hotels[0];
    return {};
}

function roomsFrom(confirmation, hotelBooking) {
    if (Array.isArray(confirmation.rooms)) return confirmation.rooms;
    if (Array.isArray(hotelBooking.rooms)) return hotelBooking.rooms;
    return [];
}

function rateCommentsFrom(room) {
    if (room.rateComments !== undefined) return room.rateComments;
    const rate = room.rates?.[0];
    if (typeof rate?.rateComments === 'string') return rate.rateComments;
    if (Array.isArray(rate?.rateComments)) return rate.rateComments;
    return [];
}

function generateVoucher(bookingConfirmation, hotelContent) {
    if (!bookingConfirmation || typeof bookingConfirmation !== 'object' || Array.isArray(bookingConfirmation)) {
        throw fail('hotelbeds_voucher_booking_confirmation_invalid');
    }
    if (!hotelContent || typeof hotelContent !== 'object' || Array.isArray(hotelContent)) {
        throw fail('hotelbeds_voucher_hotel_content_invalid');
    }

    const bookingReference = requiredText(bookingReferenceFrom(bookingConfirmation), 'hotelbeds_voucher_booking_reference_missing', 100);
    const hotelName = requiredText(hotelContent.name, 'hotelbeds_voucher_hotel_name_missing', 200);
    const hotelCategory = categoryName(hotelContent.category);
    const hotelAddress = requiredText(hotelContent.address, 'hotelbeds_voucher_hotel_address_missing', 500);
    const hotelPhone = requiredText(hotelContent.phone, 'hotelbeds_voucher_hotel_phone_missing', 80);
    const hotelBooking = hotelBookingFrom(bookingConfirmation);
    const booking = bookingConfirmation.booking && typeof bookingConfirmation.booking === 'object'
        ? bookingConfirmation.booking : bookingConfirmation;
    const holder = bookingConfirmation.holder || booking.holder || hotelBooking.holder;
    const leadPassengerName = fullName(holder, 'hotelbeds_voucher_lead_passenger_missing');
    const checkIn = requiredDate(bookingConfirmation.checkIn || hotelBooking.checkIn, 'hotelbeds_voucher_check_in_invalid');
    const checkOut = requiredDate(bookingConfirmation.checkOut || hotelBooking.checkOut, 'hotelbeds_voucher_check_out_invalid');
    if (checkOut <= checkIn) throw fail('hotelbeds_voucher_stay_invalid');
    const sourceRooms = roomsFrom(bookingConfirmation, hotelBooking);
    if (sourceRooms.length < 1) {
        throw fail('hotelbeds_voucher_rooms_missing');
    }

    const rooms = sourceRooms.map((room, index) => {
        if (!room || typeof room !== 'object' || Array.isArray(room)) {
            throw fail('hotelbeds_voucher_room_invalid');
        }
        let passengers = room.passengers || room.paxes;
        if (passengers === undefined && sourceRooms.length === 1 && index === 0) {
            passengers = [holder];
        }
        if (!Array.isArray(passengers) || passengers.length === 0) {
            throw fail('hotelbeds_voucher_room_passenger_missing');
        }
        const comments = rateCommentsFrom(room);
        const rateComments = comments == null ? []
            : Array.isArray(comments) ? comments : [comments];
        const roomType = room.roomType || room.roomName || room.name || room.code;
        const boardType = room.boardType || room.boardName || room.boardCode;
        return {
            roomNumber: index + 1,
            roomType: requiredText(roomType, 'hotelbeds_voucher_room_type_missing', 200),
            boardType: requiredText(boardType, 'hotelbeds_voucher_board_type_missing', 100),
            passengers: passengers.map(mapPassenger),
            rateComments: rateComments.map(comment => requiredText(
                comment, 'hotelbeds_voucher_rate_comment_invalid', 2000
            ))
        };
    });

    const supplier = bookingConfirmation.supplier || {};
    const supplierName = requiredText(bookingConfirmation.supplierName || supplier.name,
        'hotelbeds_voucher_supplier_name_missing', 200);
    const supplierVatNumber = requiredText(bookingConfirmation.supplierVatNumber || supplier.vatNumber,
        'hotelbeds_voucher_supplier_vat_missing', 100);
    const paymentStatement = `Payable through ${supplierName}, acting as agent for the service operating company, details of which can be provided upon request. VAT: ${supplierVatNumber} Reference: ${bookingReference}`;

    return {
        hotel: {
            name: hotelName,
            category: hotelCategory,
            address: hotelAddress,
            phone: hotelPhone
        },
        passengers: {
            leadPassengerName,
            rooms: rooms.map(room => ({ roomNumber: room.roomNumber, passengers: room.passengers }))
        },
        booking: {
            hotelbedsBookingReference: bookingReference,
            ...((bookingConfirmation.agencyReference || booking.clientReference)
                ? { agencyReference: requiredText(bookingConfirmation.agencyReference || booking.clientReference,
                    'hotelbeds_voucher_agency_reference_invalid', 100) }
                : {}),
            checkIn,
            checkOut,
            rooms: rooms.map(({ roomNumber, roomType, boardType, rateComments }) => ({
                roomNumber, roomType, boardType, rateComments
            }))
        },
        paymentStatement
    };
}

module.exports = { generateVoucher };