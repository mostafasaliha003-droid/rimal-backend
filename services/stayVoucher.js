const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml } = require('./hotelbedsVoucherService');

const template = fs.readFileSync(path.join(__dirname, '../templates/pillow-stays-voucher.html'), 'utf8');
const assetDir = path.join(__dirname, '../frontend/public/pillow');
let brandAssets;
function assets() {
    if (brandAssets) return brandAssets;
    const encode = filename => fs.readFileSync(path.join(assetDir, filename)).toString('base64');
    const fontFaces = [['Plex', 'IBMPlexSansArabic'], ['Manrope', 'Manrope']].flatMap(([family, file]) =>
        [['Regular', 400], ['Bold', 700]].map(([style, weight]) =>
            "@font-face{font-family:" + family + ";font-weight:" + weight
            + ";src:url(data:font/ttf;base64," + encode(file + '-' + style + '.ttf') + ") format('truetype')}")).join('');
    brandAssets = { fontFaces, symbol: '<img alt="" src="data:image/svg+xml;base64,' + encode('symbol.svg') + '">' };
    return brandAssets;
}

function supplierConfirmed(booking) {
    return String(booking?.status).toLowerCase() === 'active'
        && String(booking?.supplierStatus).toUpperCase() === 'CONFIRMED';
}

const value = input => '<bdi dir="auto">' + escapeHtml(input) + '</bdi>';
const text = input => typeof input === 'string' && input.trim() ? input.trim() : '';
function stayDay(input) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input || '')) return null;
    const date = new Date(input + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().startsWith(input) ? date : null;
}

function renderStayVoucher(booking, { language, hotelbeds, snapshot, issuedAt = new Date(), sample = false } = {}) {
    if (!supplierConfirmed(booking)) throw new Error('voucher_not_confirmed');
    const lang = language === 'en' ? 'en' : 'ar';
    const ar = lang === 'ar';
    const local = (arabic, english) => ar ? arabic : english;
    const alternate = (arabic, english) => ar ? english : arabic;
    const label = (arabic, english) => '<span class="label">' + local(arabic, english) + '<small>' + alternate(arabic, english) + '</small></span>';
    const cell = (arabic, english, content) => content ? '<div class="cell">' + label(arabic, english) + '<div class="value">' + value(content) + '</div></div>' : '';
    const section = (arabic, english, body) => body ? '<section><div class="section-heading"><h2>' + local(arabic, english)
        + '</h2><small>' + alternate(arabic, english) + '</small></div>' + body + '</section>' : '';
    const note = (arabic, english, content) => content ? '<div class="note"><h3>' + local(arabic, english)
        + '</h3><p>' + value(content) + '</p></div>' : '';
    const formatter = new Intl.DateTimeFormat(ar ? 'ar-AE' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC', calendar: 'gregory' });
    const formatted = day => day ? formatter.format(day) : '';
    const supplier = hotelbeds?.booking;
    const arrival = stayDay(supplier?.checkIn || booking.checkInDate);
    const departure = stayDay(supplier?.checkOut || booking.checkOutDate);
    const nights = arrival && departure && departure > arrival ? String((departure - arrival) / 86400000) : '';
    const dateCell = (a, e, content, time) => content ? '<div>' + label(a, e) + '<b>' + value(content) + '</b>'
        + (typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)
            ? '<small>' + value(time.slice(0, 5)) + ' · ' + local('بتوقيت الفندق', 'property time') + '</small>' : '') + '</div>' : '';
    const rooms = hotelbeds ? supplier.rooms.map((room, index) => ({
        ...room, guests: hotelbeds.passengers.rooms[index].passengers
    })) : snapshot?.rooms || [];
    const lead = hotelbeds?.passengers.leadPassengerName || text(booking.customerName);
    const headcount = rooms.flatMap(room => room.guests);
    const roomLabel = index => local('الغرفة ', 'Room ') + (index + 1);
    const group = (count, a, e) => local(a, e) + ' ' + count;
    const occupancy = rooms.length ? [
        group(rooms.length, 'الغرف', 'Rooms'),
        group(headcount.filter(person => person.type === 'adult').length, 'البالغون', 'Adults'),
        group(headcount.filter(person => person.type === 'child').length, 'الأطفال', 'Children')
    ].join(' · ') : '';
    const facts = cell('حامل الحجز', 'Lead guest', lead) + cell('الغرف والنزلاء', 'Rooms & occupancy', occupancy)
        + cell('نوع الغرفة', 'Room type', !rooms.length ? text(booking.roomType) : '')
        + cell('خطة الوجبات', 'Meal plan', !hotelbeds ? snapshot?.board || text(booking.boardType) : '')
        + cell('مرجع الفندق', 'Hotel confirmation', text(booking.hotelConfirmationNumber));
    const guestRows = rooms.map((room, index) => {
        const description = [roomLabel(index), room.roomType || (!hotelbeds && booking.roomType), room.boardType]
            .filter(Boolean).map(value).join(' · ');
        return '<div class="room-group"><div class="room-title">' + description + '</div><table><thead><tr><th>' + local('اسم النزيل', 'Guest name')
            + '</th><th>' + local('نوع النزيل', 'Guest type') + '</th></tr></thead><tbody>' + room.guests.map(person =>
                '<tr><td>' + value(person.name) + '</td><td>' + (person.type === 'child'
                    ? local('طفل', 'Child') + (Number.isInteger(person.age) ? ' (' + person.age + ')' : '')
                    : local('بالغ', 'Adult')) + '</td></tr>').join('') + '</tbody></table></div>';
    }).join('');
    const references = cell('رقم حجز مخدة', 'Pillow Stays reference', text(booking.bookingReference))
        + (supplier ? cell('مرجع المورد', 'Supplier reference', supplier.hotelbedsBookingReference)
            + cell('مرجع الوكالة', 'Agency reference', supplier.agencyReference)
            : cell('مرجع طلب الشريك', 'Partner order reference', /^pending$/i.test(booking.supplierReference || '') ? '' : text(booking.supplierReference)));
    const contact = [hotelbeds?.hotel.category, hotelbeds?.hotel.address || snapshot?.hotelAddress, hotelbeds?.hotel.phone || snapshot?.hotelPhone]
        .filter(Boolean).map(line => '<p class="contact">' + value(line) + '</p>').join('');
    const conditions = rooms.map((room, index) => note('شروط ' + roomLabel(index), 'Terms · ' + roomLabel(index),
        room.rateComments?.join('\n'))).join('');
    const feeRows = (snapshot?.fees || []).map(fee => [fee.name, fee.amount, fee.currency].filter(Boolean).join(' · '));
    const deadline = snapshot?.freeCancellationBefore;
    const freeUntil = deadline && Number.isFinite(Date.parse(deadline)) ? new Intl.DateTimeFormat(ar ? 'ar-AE' : 'en-GB',
        { calendar: 'gregory', dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(deadline)) + ' UTC' : '';
    const terms = conditions + note('شروط الإلغاء', 'Cancellation terms', text(booking.cancellationPolicy))
        + note('آخر موعد للإلغاء المجاني', 'Free cancellation before', freeUntil)
        + note('يُدفع في الفندق', 'Payable at the property', feeRows.join('\n'))
        + note('طلبات خاصة تخضع لموافقة الفندق', 'Special requests subject to property approval', snapshot?.request);
    const defaultTitle = ['تأكيد حجز فندقي', 'Hotel Booking Voucher'];
    const state = sample ? ['نموذج تصميمي — غير صالح للإقامة', 'DESIGN SAMPLE — NOT VALID FOR CHECK-IN'] : ['مؤكد', 'Confirmed'];
    const replacements = {
        ...assets(), lang, dir: ar ? 'rtl' : 'ltr', title: local(...defaultTitle), subtitle: alternate(...defaultTitle),
        issued: local('تاريخ الإصدار', 'Issued') + ' · ' + formatted(new Date(issuedAt)),
        banner: '<div class="banner' + (sample ? ' sample' : '') + '">' + local(...state) + '<small>' + alternate(...state) + '</small></div>',
        samplePageStyle: sample ? '@page{@bottom-center{content:"' + local(...state)
            + '";font:700 9px Manrope,Plex,Arial,sans-serif;color:#665867}}' : '',
        references, hotel: value(hotelbeds?.hotel.name || text(booking.hotelName)), contact,
        dates: dateCell('الوصول', 'Check-in', formatted(arrival), snapshot?.checkInTime)
            + dateCell('المغادرة', 'Check-out', formatted(departure), snapshot?.checkOutTime)
            + dateCell('عدد الليالي', 'Nights', nights),
        details: section('تفاصيل الإقامة', 'Stay details', facts && '<div class="facts">' + facts + '</div>'),
        guests: section('أسماء النزلاء', 'Guest details', guestRows), terms: section('الشروط والمعلومات المهمة', 'Terms & important information', terms),
        legal: hotelbeds ? '<p class="legal" lang="en" dir="ltr">' + value(hotelbeds.paymentStatement) + '</p>' : '',
        supportTitle: local('دعم النزلاء', 'Guest support'), support: local('اذكر رقم حجز مخدة عند التواصل مع الدعم.',
            'Include your Pillow Stays booking reference when contacting support.') + ' · <bdi>support@pillowstays.app</bdi>'
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => replacements[key]);
}

module.exports = { supplierConfirmed, renderStayVoucher };
