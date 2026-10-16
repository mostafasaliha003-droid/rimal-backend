const { normalizeHotelbedsRateComments } = require('./hotelbedsRateComments');

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
    const value = typeof category === 'string' ? category : category?.name;
    return optionalText(value, 100);
}

function optionalText(value, maxLength) {
    return typeof value === 'string' && value.trim() && value.trim().length <= maxLength
        && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}

function optionalField(label, value) {
    return value ? `<div class="item"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>` : '';
}

function mapPassenger(passenger) {
    const name = fullName(passenger, 'hotelbeds_voucher_passenger_name_missing');
    const type = String(passenger.type || '').trim().toUpperCase();
    if (passenger.age !== undefined
        && (!Number.isInteger(passenger.age) || passenger.age < 0 || passenger.age > 99)) {
        throw fail('hotelbeds_voucher_passenger_age_invalid');
    }
    const isChild = ['CH', 'CHILD'].includes(type)
        || !type && Number.isInteger(passenger.age) && passenger.age < 18;
    if (isChild && (!Number.isInteger(passenger.age) || passenger.age < 0 || passenger.age > 99)) {
        throw fail('hotelbeds_voucher_child_age_missing');
    }
    if (type && !['AD', 'CH', 'ADULT', 'CHILD'].includes(type)) throw fail('hotelbeds_voucher_passenger_type_invalid');
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
    if (room && Object.hasOwn(room, 'rateComments') && room.rateComments != null) {
        return { available: true, value: room.rateComments };
    }
    const rate = room.rates?.[0];
    if (rate && Object.hasOwn(rate, 'rateComments') && rate.rateComments != null) {
        return { available: true, value: rate.rateComments };
    }
    if (rate?.rateCommentsSource === 'accepted_checkrate') {
        return { available: true, value: rate.rateComments ?? [] };
    }
    return { available: false, value: undefined };
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function voucherRoomsHtml(rooms) {
    if (!Array.isArray(rooms) || rooms.length === 0) throw fail('hotelbeds_voucher_rooms_missing');
    return rooms.map((room, index) => {
        const passengers = room.passengers.map(passenger =>
            `<tr><td>${escapeHtml(passenger.name)}</td><td>${escapeHtml(passenger.type === 'child'
                ? `Child (${passenger.age})` : 'Adult')}</td></tr>`).join('');
        const comments = room.rateComments.length
            ? `<p class="muted">${room.rateComments.map(escapeHtml).join('<br>')}</p>` : '';
        return `<div class="room"><p class="room-title">Room ${index + 1}: ${escapeHtml(room.roomType)}</p>
            <p>Board: ${escapeHtml(room.boardType)}</p>${comments}
            <table><thead><tr><th>Guest</th><th>Passenger type</th></tr></thead><tbody>${passengers}</tbody></table></div>`;
    }).join('');
}

function generateVoucher(bookingConfirmation, hotelContent) {
    if (!bookingConfirmation || typeof bookingConfirmation !== 'object' || Array.isArray(bookingConfirmation)) {
        throw fail('hotelbeds_voucher_booking_confirmation_invalid');
    }
    if (!hotelContent || typeof hotelContent !== 'object' || Array.isArray(hotelContent)) {
        throw fail('hotelbeds_voucher_hotel_content_invalid');
    }
    const bookingStatus = bookingConfirmation.status || bookingConfirmation.booking?.status;
    if (typeof bookingStatus !== 'string' || bookingStatus.trim().toUpperCase() !== 'CONFIRMED') {
        throw fail('hotelbeds_voucher_booking_not_confirmed');
    }

    const bookingReference = requiredText(bookingReferenceFrom(bookingConfirmation), 'hotelbeds_voucher_booking_reference_missing', 100);
    const hotelName = requiredText(hotelContent.name, 'hotelbeds_voucher_hotel_name_missing', 200);
    const hotelCategory = categoryName(hotelContent.category);
    const hotelAddress = requiredText(hotelContent.address, 'hotelbeds_voucher_hotel_address_missing', 500);
    const hotelPhone = optionalText(hotelContent.phone, 80);
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
        const rate = room.rates?.[0];
        const comments = rateCommentsFrom(room);
        if (!comments.available) throw fail('hotelbeds_voucher_rate_comments_unverified');
        const rateComments = normalizeHotelbedsRateComments(comments.value);
        if (rateComments === null) throw fail('hotelbeds_voucher_rate_comment_invalid');
        const roomType = room.roomType || room.roomName || room.name || room.code;
        const boardType = room.boardType || room.boardName || room.boardCode || rate?.boardName || rate?.boardCode;
        return {
            roomNumber: index + 1,
            roomType: requiredText(roomType, 'hotelbeds_voucher_room_type_missing', 200),
            boardType: requiredText(boardType, 'hotelbeds_voucher_board_type_missing', 100),
            passengers: passengers.map(mapPassenger),
            rateComments
        };
    });

    const agencyReference = optionalText(booking.agencyReference || bookingConfirmation.agencyReference, 100);
    const supplier = hotelBooking.supplier || bookingConfirmation.supplier || {};
    const supplierName = requiredText(bookingConfirmation.supplierName || supplier.name,
        'hotelbeds_voucher_supplier_name_missing', 200);
    const supplierVatNumber = requiredText(bookingConfirmation.supplierVatNumber || supplier.vatNumber,
        'hotelbeds_voucher_supplier_vat_missing', 100);
    const paymentStatement = `Payable through ${supplierName}, acting as agent for the service operating company, details of which can be provided upon request. VAT: ${supplierVatNumber} Reference: ${bookingReference}`;

    return {
        hotel: {
            name: hotelName,
            ...(hotelCategory ? { category: hotelCategory } : {}),
            address: hotelAddress,
            ...(optionalText(hotelPhone, 80) ? { phone: optionalText(hotelPhone, 80) } : {})
        },
        passengers: {
            leadPassengerName,
            rooms: rooms.map(room => ({ roomNumber: room.roomNumber, passengers: room.passengers }))
        },
        booking: {
            hotelbedsBookingReference: bookingReference,
            ...(agencyReference ? { agencyReference } : {}),
            checkIn,
            checkOut,
            rooms: rooms.map(({ roomNumber, roomType, boardType, rateComments }) => ({
                roomNumber, roomType, boardType, rateComments
            }))
        },
        paymentStatement
    };
}

function renderVoucherHtml(template, voucher) {
    if (typeof template !== 'string' || !voucher || typeof voucher !== 'object') {
        throw fail('hotelbeds_voucher_template_invalid');
    }
    const rooms = voucher.booking.rooms.map((room, index) => ({
        ...room,
        passengers: voucher.passengers.rooms[index]?.passengers || []
    }));
    const replacements = {
        bookingReference: voucher.booking.hotelbedsBookingReference,
        bookingStatus: 'CONFIRMED',
        customerName: voucher.passengers.leadPassengerName,
        checkInDate: voucher.booking.checkIn,
        checkOutDate: voucher.booking.checkOut,
        hotelName: voucher.hotel.name,
        hotelAddress: voucher.hotel.address,
        paymentStatement: voucher.paymentStatement,
        roomSections: voucherRoomsHtml(rooms)
    };
    replacements.agencyReferenceField = optionalField('Agency reference', voucher.booking.agencyReference);
    replacements.hotelCategoryField = optionalField('Category', voucher.hotel.category);
    replacements.hotelPhoneField = optionalField('Telephone', voucher.hotel.phone);
    let output = template;
    for (const [key, value] of Object.entries(replacements)) {
        output = output.replaceAll(`{{${key}}}`,
            key === 'roomSections' || key.endsWith('Field') ? value : escapeHtml(value));
    }
    if (/\{\{[A-Za-z][A-Za-z0-9]*\}\}/.test(output)) throw fail('hotelbeds_voucher_template_incomplete');
    return output;
}

module.exports = { escapeHtml, generateVoucher, renderVoucherHtml };