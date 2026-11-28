const mongoose = require('mongoose');
const Cancellation = require('../models/BookingCancellation');
const Checkout = require('../models/CheckoutAttempt');
const ziina = require('./ziinaClient');
const pdf = require('./reservationConfirmationService');
const { C, FONT_STACK, EMAIL_SYMBOL_CID, embeddedAssets, pdfFontFaces, wordmark, statusPill, footer, BRAND, companyLegalLine } = require('./documentBrand');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = {
    pending: ['الاسترداد قيد المعالجة', 'Refund processing'],
    completed: ['أكدت بوابة الدفع اكتمال الاسترداد', 'Refund confirmed by payment gateway'],
    not_due: ['لا يوجد مبلغ مستحق للاسترداد', 'No refund due'],
    review: ['الاسترداد يحتاج إلى متابعة', 'Refund requires review']
};
function receiptDetails(cancellation, checkout, booking, now = new Date()) {
    if (!cancellation || cancellation.state !== 'cancelled' || !checkout || !booking
        || String(cancellation.checkout_attempt_id) !== String(checkout._id) || checkout.partner_order_id !== cancellation._id
        || checkout.cancellation_request_hash !== cancellation.request_hash || !checkout.payment_verified_at
        || booking.bookingReference !== checkout.reference || booking.supplierReference !== cancellation._id
        || booking.ownerSubject !== checkout.ownerSubject || booking.realm !== checkout.realm
        || booking.provider !== 'ratehawk' || booking.status !== 'cancelled'
        || !Number.isSafeInteger(cancellation.customer_refund_amount_minor) || cancellation.customer_refund_amount_minor < 0
        || cancellation.customer_refund_amount_minor > checkout.amount_minor
        || checkout.refund_amount_minor !== cancellation.customer_refund_amount_minor) throw new Error('cancellation_receipt_binding_invalid');
    const refundStatus = checkout.state === 'refund_completed' && checkout.refund_verified_at ? 'completed'
        : cancellation.customer_refund_amount_minor === 0 && checkout.refund_status === 'not_due' ? 'not_due'
            : ['refund_review', 'manual_review'].includes(checkout.state) ? 'review' : 'pending';
    const amount = minor => ziina.formatAmountMinor(minor, checkout.currency);
    return { reference: checkout.reference, cancellationReference: `CAN-${cancellation.request_hash.slice(0, 12).toUpperCase()}`,
        guestName: String(booking.customerName || ''), email: booking.email, owner: checkout.ownerSubject, realm: checkout.realm,
        hotelName: /^hotel$|^unknown$/i.test(booking.hotelName || '') ? '' : String(booking.hotelName || ''),
        currency: checkout.currency, paid: amount(checkout.amount_minor),
        fee: amount(checkout.amount_minor - cancellation.customer_refund_amount_minor), refund: amount(cancellation.customer_refund_amount_minor),
        refundStatus, sandbox: checkout.ziina_test === true,
        issuedAt: now.toISOString(), requestedAt: cancellation.createdAt ? new Date(cancellation.createdAt).toISOString() : null };
}
// Email by default (inline cid symbol); the PDF embeds the symbol and font.
function renderReceipt(details, { pdf = false, symbolSrc = pdf ? embeddedAssets().symbol : `cid:${EMAIL_SYMBOL_CID}` } = {}) {
    const status = STATUS[details.refundStatus];
    if (!status) throw new Error('cancellation_receipt_status_invalid');
    const row = (label, value) => `<tr><td style="padding:11px 8px;border-bottom:1px solid ${C.border};color:${C.neutral600};font-size:12px;vertical-align:top">${label}</td><td dir="auto" style="padding:11px 8px;border-bottom:1px solid ${C.border};font-size:13px;font-weight:700;color:${C.plum900};overflow-wrap:anywhere">${esc(value)}</td></tr>`;
    const issued = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(details.issuedAt));
    const page = pdf ? `<style>@page{size:A4;margin:12mm}${pdfFontFaces()}tr{break-inside:avoid}</style>` : '';
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${page}</head><body style="margin:0;background:${pdf ? C.white : C.cream};font-family:${FONT_STACK};color:${C.plum900};line-height:1.7"><div style="max-width:${pdf ? 760 : 640}px;margin:${pdf ? 0 : '32px'} auto;border:1px solid ${C.border};border-radius:20px;overflow:hidden;background:${C.white}"><div style="padding:22px 28px;background:${C.cream};border-bottom:4px solid ${C.plum800}">${wordmark(symbolSrc)}</div><div style="padding:${pdf ? 20 : 26}px 28px">${statusPill(false, 'تم تأكيد إلغاء الحجز · CANCELLATION CONFIRMED')}<h1 style="font-size:${pdf ? 20 : 23}px;line-height:1.5;margin:12px 0;color:${C.plum800}">قسيمة الإلغاء وطلب الاسترداد<br><span dir="ltr" style="font-size:16px">Cancellation &amp; refund request receipt</span></h1>${details.sandbox ? `<p style="padding:10px 12px;background:${C.gold100};border:1px solid ${C.gold200};color:${C.gold700};font-size:12px;border-radius:10px">SANDBOX · مستند تجريبي، لا يُثبت حركة أموال حقيقية. Test document; not evidence of a real funds transfer.</p>` : ''}<p style="font-size:13px">تم إلغاء حجزك. احتفظ بهذه القسيمة ومرجع الطلب لمتابعة الاسترداد.<br><span dir="ltr">Your booking is cancelled. Keep this receipt and reference to track your refund.</span></p><div style="background:${C.lavender50};border:1px solid ${C.lavender100};border-radius:12px;padding:16px 18px;margin:16px 0"><strong style="color:${C.plum800};font-size:18px">${esc(details.refund)} ${esc(details.currency)}</strong><div style="font-size:13px;color:${C.plum600}">${esc(status[0])} · ${esc(status[1])}</div></div><table style="width:100%;border-collapse:collapse">${row('مرجع الإلغاء · Cancellation reference', details.cancellationReference)}${row('مرجع الحجز · Booking reference', details.reference)}${details.hotelName ? row('الفندق · Hotel', details.hotelName) : ''}${details.guestName ? row('اسم الضيف · Guest', details.guestName) : ''}${row('المدفوع · Paid', `${details.paid} ${details.currency}`)}${row('الرسوم المخصومة · Fees deducted', `${details.fee} ${details.currency}`)}${row('مبلغ الاسترداد · Refund amount', `${details.refund} ${details.currency}`)}${row('إصدار القسيمة · Issued (Dubai time)', issued)}</table><p style="padding:14px 16px;background:${C.sand};border-radius:12px;font-size:12px;line-height:1.9">هذه القسيمة توثّق الإلغاء وطلب الاسترداد. لا تؤكد وصول المبلغ إلى بطاقتك. يُعاد الاسترداد إلى وسيلة الدفع الأصلية، ويُقدَّر ظهوره خلال 5 إلى 14 يوم عمل بعد تأكيد بوابة الدفع معالجة الاسترداد. هذه مدة إرشادية تختلف حسب البنك، ولا تشمل عطلاته. إذا لم يظهر المبلغ بعد هذه المدة، تواصل معنا بمرجع الطلب.<br><span dir="ltr">This receipt documents cancellation and the refund request. It does not confirm credit to your card. Refunds return to the original payment method; the estimated card-credit time is 5–14 business days after the gateway confirms refund processing. This is an indicative estimate, varies by bank, and excludes bank non-working days. Contact us with your reference if the credit has not appeared after this period.</span></p><p style="font-size:12px">لا تحتاج إلى تقديم طلب استرداد آخر. يمكنك متابعة الحالة من حسابك.<br><span dir="ltr">No duplicate request is needed. Track the latest status in your account.</span></p><div style="border-top:1px solid ${C.border};padding-top:14px">${footer({ legal: true })}</div></div></div></body></html>`;
}
async function loadReceipt(partnerId) {
    const cancellation = await Cancellation.findById(partnerId).lean();
    const checkout = cancellation?.checkout_attempt_id && await Checkout.findById(cancellation.checkout_attempt_id).lean();
    if (!checkout || checkout.realm !== process.env.RIMAL_AUTH_REALM || checkout.ziina_test !== (process.env.ZIINA_TEST_MODE === 'true')
        || checkout.supplier_identity !== require('./paymentService').supplierIdentity()) throw new Error('cancellation_receipt_environment_mismatch');
    const Booking = mongoose.models.Booking;
    if (!Booking) throw new Error('cancellation_receipt_booking_unavailable');
    const booking = await Booking.findOne({ bookingReference: checkout.reference, supplierReference: partnerId,
        ownerSubject: checkout.ownerSubject, realm: checkout.realm, status: 'cancelled', provider: 'ratehawk' }).lean();
    return { cancellation, details: receiptDetails(cancellation, checkout, booking) };
}
async function generateReceipt(partnerId) {
    const { details } = await loadReceipt(partnerId);
    return { details, buffer: await pdf.generateHtmlPdf(renderReceiptPdf(details)) };
}
function renderReceiptPdf(details) {
    // Compact print sizes so the receipt fits one A4 page.
    return renderReceipt(details, { pdf: true }).replace('</head>', '<style>body{font-size:11px;line-height:1.5}p{margin:8px 0!important;line-height:1.6!important;font-size:11px!important}td{padding:7px 6px!important;font-size:11px!important}</style></head>');
}
async function sendReceipt(partnerId, { generate = generateReceipt,
    send = input => require('./notificationService').sendCancellationReceipt(input) } = {}) {
    const record = await Cancellation.findById(partnerId).lean();
    if (!record || record.state !== 'cancelled' || record.receipt_status !== 'pending') return false;
    const { details, buffer } = await generate(partnerId);
    if (typeof details.email !== 'string' || details.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) throw new Error('cancellation_receipt_email_invalid');
    const claimed = await Cancellation.findOneAndUpdate({ _id: partnerId, state: 'cancelled', receipt_status: 'pending' },
        { $set: { receipt_status: 'sending', receipt_attempted_at: new Date() } }, { new: true }).lean();
    if (!claimed) return false;
    try {
        const result = await send({ details, buffer });
        await Cancellation.updateOne({ _id: partnerId, receipt_status: 'sending' }, { $set: {
            receipt_status: 'sent', receipt_sent_at: new Date(), receipt_message_id: result.messageId }, $unset: { receipt_next_check_at: '' } });
        return true;
    } catch {
        await Cancellation.updateOne({ _id: partnerId, receipt_status: 'sending' }, { $set: { receipt_status: 'unknown' }, $unset: { receipt_next_check_at: '' } });
        return false;
    }
}
async function processPendingReceipts() {
    await Cancellation.updateMany({ receipt_status: 'sending', receipt_attempted_at: { $lte: new Date(Date.now() - 120000) } }, { $set: { receipt_status: 'unknown' } });
    const records = await Cancellation.find({ state: 'cancelled', receipt_status: 'pending', receipt_next_check_at: { $lte: new Date() } }).select('_id').limit(3).lean();
    for (const record of records) {
        try { await sendReceipt(record._id); }
        catch {
            const failed = await Cancellation.findOneAndUpdate({ _id: record._id, receipt_status: 'pending' }, {
                $inc: { receipt_generation_attempts: 1 }, $set: { receipt_next_check_at: new Date(Date.now() + 60000) }
            }, { new: true }).lean();
            if (failed?.receipt_generation_attempts >= 3) await Cancellation.updateOne({ _id: record._id, receipt_status: 'pending' }, {
                $set: { receipt_status: 'review' }, $unset: { receipt_next_check_at: '' } });
        }
    }
}
// Plain-text part of the receipt e-mail: Arabic then English, with the same legal details as the HTML.
function renderReceiptText(details, env = process.env) {
    const status = STATUS[details.refundStatus];
    if (!status) throw new Error('cancellation_receipt_status_invalid');
    return [
        ...(details.sandbox ? ['SANDBOX · مستند تجريبي · Test document', ''] : []),
        'تم تأكيد إلغاء حجزك.',
        `مرجع الحجز: ${details.reference} · مرجع الإلغاء: ${details.cancellationReference}`,
        `حالة الاسترداد: ${status[0]} · المبلغ: ${details.refund} ${details.currency}`,
        'يُقدَّر ظهور المبلغ في بطاقتك خلال 5 إلى 14 يوم عمل بعد تأكيد بوابة الدفع معالجة الاسترداد، حسب البنك ودون احتساب عطلاته. قسيمة الإلغاء مرفقة.',
        '',
        'Your booking is cancelled.',
        `Booking reference: ${details.reference} · Cancellation reference: ${details.cancellationReference}`,
        `Refund status: ${status[1]} · Amount: ${details.refund} ${details.currency}`,
        'Estimated card-credit time: 5–14 business days after the gateway confirms refund processing, depending on your bank and excluding bank non-working days. Your cancellation receipt is attached.',
        '',
        BRAND.support,
        companyLegalLine(env),
    ].join('\n');
}

module.exports = { receiptDetails, renderReceipt, renderReceiptText, renderReceiptPdf, loadReceipt, generateReceipt, sendReceipt, processPendingReceipts };
