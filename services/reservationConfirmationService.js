const crypto = require('node:crypto');
const { minorUnits, formatAmountMinor } = require('./ziinaClient');

// ETG Sandbox's known placeholder: one empty page, titled "Blank PDF Document".
const BLANK_SANDBOX_PDF = '0622971147486e1900037eff229d921d14f5b51aac7171729b2b66f81cdf6585';
function isKnownBlankSupplierVoucher(buffer) {
    return Buffer.isBuffer(buffer) && crypto.createHash('sha256').update(buffer).digest('hex') === BLANK_SANDBOX_PDF;
}
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function confirmationDetails(booking, input) {
    if (!booking || booking.status !== 'active' || booking.supplierStatus !== 'CONFIRMED'
        || booking.provider !== 'ratehawk' || booking.bookingReference !== input.reference
        || booking.supplierReference !== input.supplierReference || booking.email !== input.email
        || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0
        || minorUnits(booking.price, input.currency) !== input.amountMinor || booking.priceCurrency !== input.currency
        || !/^[A-Z]{3}$/.test(input.currency) || typeof input.sandbox !== 'boolean'
        || !booking.hotelName || !booking.roomType || !booking.customerName
        || !/^\d{4}-\d{2}-\d{2}$/.test(booking.checkInDate || '')
        || !/^\d{4}-\d{2}-\d{2}$/.test(booking.checkOutDate || '')) throw new Error('confirmed_reservation_details_unavailable');
    return { reference: input.reference, supplierReference: input.supplierReference, sandbox: input.sandbox,
        guestName: booking.customerName, hotelName: booking.hotelName, roomName: booking.roomType,
        checkin: booking.checkInDate, checkout: booking.checkOutDate,
        amount: formatAmountMinor(input.amountMinor, input.currency), currency: input.currency };
}

function rows(details) {
    return [
        ['الفندق · Hotel', details.hotelName], ['الغرفة · Room', details.roomName],
        ['اسم الضيف · Guest', details.guestName], ['الوصول · Check-in', details.checkin],
        ['المغادرة · Check-out', details.checkout], ['المبلغ المدفوع · Paid', `${details.amount} ${details.currency}`],
        ['مرجع رمال · Remal reference', details.reference], ['مرجع المورد · Supplier reference', details.supplierReference]
    ];
}

function renderConfirmationEmail(details, { supplierVoucherAttached = false } = {}) {
    const title = details.sandbox ? 'تأكيد الحجز التجريبي · Sandbox confirmation' : 'تأكيد حجزك · Reservation confirmed';
    const table = rows(details).map(([label, value]) => `<tr><td style="padding:14px 0;border-bottom:1px solid #e5edf0;color:#58717c;font-size:12px;width:42%">${label}</td><td dir="auto" style="padding:14px 0;border-bottom:1px solid #e5edf0;font-size:14px;font-weight:bold;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('');
    const note = details.sandbox
        ? 'حجز تجريبي فقط، غير صالح للإقامة. المرفق تأكيد من رمال، وليس قسيمة رسمية من المورد. · Sandbox only; not valid for accommodation. The attachment is a Remal confirmation, not an official supplier voucher.'
        : 'أرفقنا تأكيد رمال وقسيمة المورد الأصلية. يرجى مراجعة شروط المورد في القسيمة. · Your Remal confirmation and original supplier voucher are attached. Please review the supplier terms in the voucher.';
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#eef3f5;font-family:Arial,Tahoma,sans-serif;color:#14313d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:white;border-radius:20px;overflow:hidden"><tr><td style="padding:30px;background:#14313d;color:white;border-bottom:5px solid #09a2b3"><div style="font-size:30px;font-weight:bold;letter-spacing:4px" dir="ltr">REMAL</div><div style="margin-top:8px;color:#a9dce0;font-size:13px">رمال · Travel &amp; stays</div></td></tr><tr><td style="padding:30px"><div style="color:#087d68;font-size:12px;font-weight:bold">${details.sandbox ? 'SANDBOX · تجريبي' : 'CONFIRMED · مؤكد'}</div><h1 style="font-size:24px;line-height:1.6;margin:12px 0">${title}</h1><p style="font-size:15px;line-height:1.8">مرحبًا ${escapeHtml(details.guestName)}،<br>تفاصيل حجزك المؤكد موضحة أدناه.<br><span dir="ltr">Your confirmed reservation details are below.</span></p><table width="100%" cellspacing="0" cellpadding="0">${table}</table><p style="margin:24px 0 0;padding:16px;background:${details.sandbox ? '#fff6df' : '#edf8f7'};font-size:12px;line-height:1.9;border-radius:10px">${note}${details.sandbox && supplierVoucherAttached ? '<br>أُرفق أيضًا مستند المورد التجريبي. · The supplier sandbox document is also attached.' : ''}</p></td></tr><tr><td style="padding:22px 30px;background:#f5f8fa;font-size:12px;line-height:1.8">للمساعدة · Reservation support<br><a href="mailto:management@remaltourismllc.com" style="color:#087c8b">management@remaltourismllc.com</a><br>احتفظ بمرجع الحجز عند التواصل معنا. · Please include your reservation reference.</td></tr></table></td></tr></table></body></html>`;
    return { subject: `${details.sandbox ? '[SANDBOX] ' : ''}تأكيد حجزك | Remal | ${details.reference}`,
        text: `${title}\n${rows(details).map(([label, value]) => `${label}: ${value}`).join('\n')}\n\n${note}\nmanagement@remaltourismllc.com`, html };
}

function renderConfirmationPdf(details) {
    const data = rows(details).map(([label, value]) => `<tr><th>${label}</th><td dir="auto">${escapeHtml(value)}</td></tr>`).join('');
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:14px Arial,Tahoma,sans-serif;color:#14313d;margin:0}header{background:#14313d;color:white;padding:24px;border-bottom:5px solid #09a2b3}.brand{font-size:32px;font-weight:bold;letter-spacing:5px}h1{font-size:24px;margin:26px 0 8px}.status{color:#087d68;font-weight:bold}.notice{background:#fff6df;padding:14px;line-height:1.8;border:1px solid #f0d797;margin:22px 0}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{padding:14px 8px;text-align:right;border-bottom:1px solid #dce7eb;vertical-align:top;overflow-wrap:anywhere}th{width:40%;font-size:12px;color:#58717c;font-weight:normal}td{font-weight:bold}footer{font-size:11px;line-height:1.8;margin-top:26px;border-top:2px solid #09a2b3;padding-top:14px}.muted{color:#58717c}</style></head><body><header><div class="brand" dir="ltr">REMAL</div><div>رمال · Reservation confirmation</div></header><h1>تأكيد الحجز · Reservation confirmation</h1><div class="status">${details.sandbox ? 'SANDBOX · تأكيد تجريبي' : 'CONFIRMED · مؤكد'}</div>${details.sandbox ? '<div class="notice"><strong>للاختبار فقط — غير صالح للإقامة</strong><br>Sandbox only — not valid for accommodation.<br>هذا تأكيد تجريبي من رمال، وليس قسيمة رسمية من المورد.</div>' : '<p class="muted">تأكيد صادر من رمال. تُرفق قسيمة المورد الأصلية بصورة مستقلة.<br>Issued by Remal. The official supplier voucher is provided separately.</p>'}<table>${data}</table><footer>للمساعدة · Reservation support<br>management@remaltourismllc.com<br>يرجى الاحتفاظ بمرجع الحجز. · Please retain your reservation reference.</footer></body></html>`;
}

async function generateConfirmationPdf(details, { puppeteer = require('puppeteer') } = {}) {
    return generateHtmlPdf(renderConfirmationPdf(details), { puppeteer });
}

async function generateHtmlPdf(html, { puppeteer = require('puppeteer') } = {}) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', request => request.abort().catch(() => {}));
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => document.fonts.ready);
        return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
    } finally { if (browser) await browser.close(); }
}

module.exports = { confirmationDetails, renderConfirmationEmail, renderConfirmationPdf,
    generateConfirmationPdf, generateHtmlPdf, isKnownBlankSupplierVoucher };
