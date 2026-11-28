const crypto = require('node:crypto');
const { minorUnits, formatAmountMinor } = require('./ziinaClient');
const { BRAND, C, FONT_STACK, EMAIL_SYMBOL_CID, embeddedAssets, pdfFontFaces, wordmark, statusPill, footer, companyLegalLine } = require('./documentBrand');

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
        ['مرجع الحجز · Booking reference', details.reference], ['مرجع المورد · Supplier reference', details.supplierReference]
    ];
}

function confirmationCopy(details) {
    return {
        title: details.sandbox ? 'تأكيد الحجز التجريبي · Sandbox confirmation' : 'تأكيد حجزك · Reservation confirmed',
        status: details.sandbox ? 'SANDBOX · تجريبي' : 'CONFIRMED · مؤكد',
        note: details.sandbox
            ? 'حجز تجريبي فقط، غير صالح للإقامة. المرفق تأكيد من مخدة، وليس قسيمة رسمية من المورد. · Sandbox only; not valid for accommodation. The attachment is a Pillow Stays confirmation, not an official supplier voucher.'
            : 'أرفقنا تأكيد مخدة بالمبلغ المدفوع. للمساعدة بشأن شروط الإقامة يرجى التواصل معنا بمرجع الحجز. · Your Pillow Stays confirmation with the amount paid is attached. Please contact us with your reservation reference for assistance with the stay terms.'
    };
}

function detailRows(details) {
    return rows(details).map(([label, value]) => `<tr><td style="padding:13px 0;border-bottom:1px solid ${C.border};color:${C.neutral600};font-size:12px;width:42%;vertical-align:top">${label}</td><td dir="auto" style="padding:13px 0;border-bottom:1px solid ${C.border};font-size:14px;font-weight:700;color:${C.plum900};overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('');
}

// One layout for email and PDF; only the symbol source and fonts differ.
function confirmationDocument(details, { symbolSrc, pdf = false }) {
    const copy = confirmationCopy(details);
    const page = pdf ? `<style>@page{size:A4;margin:14mm}${pdfFontFaces()}</style>` : '';
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${page}</head><body style="margin:0;background:${pdf ? C.white : C.cream};font-family:${FONT_STACK};color:${C.plum900}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:${pdf ? 0 : 32}px ${pdf ? 0 : 12}px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:${pdf ? 760 : 640}px;background:${C.white};border:1px solid ${C.border};border-radius:20px;overflow:hidden"><tr><td style="padding:24px 30px;background:${C.cream};border-bottom:4px solid ${C.plum800}">${wordmark(symbolSrc)}</td></tr><tr><td style="padding:28px 30px">${statusPill(details.sandbox, copy.status)}<h1 style="font-size:23px;line-height:1.6;margin:14px 0 6px;color:${C.plum800}">${copy.title}</h1><p style="font-size:15px;line-height:1.8;margin:0 0 8px">مرحبًا ${escapeHtml(details.guestName)}،<br>تفاصيل حجزك المؤكد موضحة أدناه.<br><span dir="ltr">Your confirmed reservation details are below.</span></p><table width="100%" cellspacing="0" cellpadding="0">${detailRows(details)}</table><p style="margin:22px 0 0;padding:16px;background:${details.sandbox ? C.gold100 : C.lavender50};border:1px solid ${details.sandbox ? C.gold200 : C.lavender100};font-size:12px;line-height:1.9;border-radius:12px">${copy.note}</p></td></tr><tr><td style="padding:20px 30px;background:${C.sand}">${footer({ legal: true })}</td></tr></table></td></tr></table></body></html>`;
}

function renderConfirmationEmail(details) {
    const copy = confirmationCopy(details);
    return { subject: `${details.sandbox ? '[SANDBOX] ' : ''}تأكيد حجزك | ${BRAND.sender} | ${details.reference}`,
        text: [copy.title, ...rows(details).map(([label, value]) => `${label}: ${value}`), '', copy.note, BRAND.support, companyLegalLine()].join('\n'),
        html: confirmationDocument(details, { symbolSrc: `cid:${EMAIL_SYMBOL_CID}` }) };
}

function renderConfirmationPdf(details) {
    return confirmationDocument(details, { symbolSrc: embeddedAssets().symbol, pdf: true });
}

async function generateConfirmationPdf(details, { puppeteer = require('puppeteer') } = {}) {
    return generateHtmlPdf(renderConfirmationPdf(details), { puppeteer });
}

// Confirmation and cancellation-receipt PDFs share the process-wide one-Chrome-at-a-time queue.
async function generateHtmlPdf(html, { puppeteer = require('puppeteer'), withChrome = require('./chromeQueue').withChrome } = {}) {
    return withChrome(async () => {
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
    });
}

module.exports = { confirmationDetails, renderConfirmationEmail, renderConfirmationPdf,
    generateConfirmationPdf, generateHtmlPdf, isKnownBlankSupplierVoucher };
