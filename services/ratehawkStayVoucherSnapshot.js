const { encryptBookingRecordPayload, decryptBookingRecordPayload } = require('./bookingRecordPersistence');
// The checkout permits nine rooms, each with six adults and four children.
const maxVoucherCiphertext = 131072;

function ratePlan(prebook, details, validated) {
    const hotels = prebook?.hotels || [prebook?.hotel];
    const hotel = hotels.find(item => String(item?.hid || item?.id) === String(details.hid));
    const rate = hotel?.rates?.find(item => item.book_hash === validated.book_hash);
    const payment = rate?.payment_options?.payment_types?.find(option => option.type === 'deposit'
        && option.currency_code === validated.currency && Number(option.amount) === validated.amount);
    if (!payment) throw new Error('prebook_snapshot_payment_mismatch');
    const fees = (Array.isArray(payment.tax_data?.taxes) ? payment.tax_data.taxes : [])
        .filter(tax => tax?.included_by_supplier === false && /^\d+(?:\.\d+)?$/.test(String(tax.amount))
            && /^[A-Z]{3}$/.test(tax.currency_code))
        .map(tax => ({ name: typeof tax.name === 'string' ? tax.name : '', amount: String(tax.amount), currency: tax.currency_code }));
    const deadline = payment.cancellation_penalties?.free_cancellation_before;
    const freeCancellationBefore = typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(deadline)
        && Number.isFinite(Date.parse(deadline)) ? new Date(deadline).toISOString() : undefined;
    return { version: 1, room: rate.room_name || '', board: typeof rate.meal === 'string' ? rate.meal : '', fees, freeCancellationBefore };
}

function makeVoucherSnapshot(record, details, property = {}, env = process.env) {
    const rooms = details.rooms.map(room => ({
        roomType: record.prebook_snapshot?.room || details.roomName,
        guests: room.guests.map(guest => ({
            name: [guest.first_name, guest.last_name].join(' '),
            type: guest.is_child ? 'child' : 'adult',
            ...(guest.is_child && Number.isInteger(guest.age) ? { age: guest.age } : {})
        }))
    }));
    const expiresAt = new Date(Date.parse(details.checkout + 'T00:00:00Z') + 5 * 86400000);
    const payload = { reference: record.reference, owner: record.ownerSubject, realm: record.realm,
        order: record.partner_order_id, checkout: details.checkout, rooms,
        board: record.prebook_snapshot?.board, fees: record.prebook_snapshot?.fees,
        freeCancellationBefore: record.prebook_snapshot?.freeCancellationBefore,
        request: details.user?.comment,
        hotelAddress: typeof property?.address === 'string' ? property.address : undefined,
        hotelPhone: typeof property?.phone === 'string' ? property.phone : undefined,
        checkInTime: property?.check_in_time, checkOutTime: property?.check_out_time };
    return { stayVoucherEncrypted: encryptBookingRecordPayload(payload, env), stayVoucherExpiresAt: expiresAt };
}

function readVoucherSnapshot(booking, now, env) {
    if (!booking.stayVoucherEncrypted || !(new Date(booking.stayVoucherExpiresAt) > now)) return undefined;
    const data = decryptBookingRecordPayload(booking.stayVoucherEncrypted, env, maxVoucherCiphertext);
    if (data.reference !== booking.bookingReference || data.owner !== booking.ownerSubject
        || data.realm !== booking.realm || data.order !== booking.supplierReference || data.checkout !== booking.checkOutDate
        || !Array.isArray(data.rooms) || !data.rooms.length) throw new Error('voucher_snapshot_mismatch');
    return data;
}

module.exports = { maxVoucherCiphertext, ratePlan, makeVoucherSnapshot, readVoucherSnapshot };
