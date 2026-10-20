const mongoose = require('mongoose');
const Cancellation = require('../models/BookingCancellation');
const Checkout = require('../models/CheckoutAttempt');
const ziina = require('./ziinaClient');
const pdf = require('./reservationConfirmationService');
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
function renderReceipt(details) {
    const status = STATUS[details.refundStatus];
    if (!status) throw new Error('cancellation_receipt_status_invalid');
    const row = (label, value) => `<tr><td style="padding:12px 8px;border-bottom:1px solid #e2eaed;color:#526e7b;font-size:12px">${label}</td><td style="padding:12px 8px;border-bottom:1px solid #e2eaed;font-size:13px;font-weight:bold;overflow-wrap:anywhere">${esc(value)}</td></tr>`;
    const issued = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(details.issuedAt));
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{margin:0;font-family:Arial,sans-serif;color:#173e4b;line-height:1.8}table{width:100%;border-collapse:collapse}p{margin:12px 0}td{vertical-align:top}</style></head><body><div style="max-width:640px;margin:auto;border:1px solid #dce9eb;border-radius:20px;overflow:hidden;background:#fff"><div style="padding:24px 28px;background:#143b49;color:white;border-bottom:4px solid #25a0ab"><strong style="font-size:26px;letter-spacing:4px" dir="ltr">REMAL</strong><div style="font-size:12px">العناية بكل تفاصيل رحلتك · Every detail, considered</div></div><div style="padding:26px"><div style="font-size:12px;color:#227c65;font-weight:bold">تم تأكيد إلغاء الحجز · CANCELLATION CONFIRMED</div><h1 style="font-size:23px;line-height:1.6;margin:14px 0">قسيمة الإلغاء وطلب الاسترداد<br><span dir="ltr" style="font-size:17px">Cancellation & refund request receipt</span></h1>${details.sandbox ? '<p style="padding:10px;background:#fff5df;color:#755c22;font-size:12px">SANDBOX · مستند تجريبي، لا يُثبت حركة أموال حقيقية. Test document; not evidence of a real funds transfer.</p>' : ''}<p style="font-size:13px">تم إلغاء حجزك. احتفظ بهذه القسيمة ومرجع الطلب لمتابعة الاسترداد.<br><span dir="ltr">Your booking is cancelled. Keep this receipt and reference to track your refund.</span></p><div style="background:#edf7f8;border:1px solid #cde5e7;border-radius:12px;padding:18px;margin:18px 0"><strong style="color:#116d7d;font-size:17px">${esc(details.refund)} ${esc(details.currency)}</strong><div style="font-size:13px">${esc(status[0])} · ${esc(status[1])}</div></div><table>${row('مرجع الإلغاء · Cancellation reference', details.cancellationReference)}${row('مرجع الحجز · Booking reference', details.reference)}${details.hotelName ? row('الفندق · Hotel', details.hotelName) : ''}${details.guestName ? row('اسم الضيف · Guest', details.guestName) : ''}${row('المدفوع · Paid', `${details.paid} ${details.currency}`)}${row('الرسوم المخصومة · Fees deducted', `${details.fee} ${details.currency}`)}${row('مبلغ الاسترداد · Refund amount', `${details.refund} ${details.currency}`)}${row('إصدار القسيمة · Issued (Dubai time)', issued)}</table><p style="padding:15px;background:#f5f8fa;font-size:12px;line-height:1.9">هذه القسيمة توثّق الإلغاء وطلب الاسترداد. لا تؤكد وصول المبلغ إلى بطاقتك. يُعاد الاسترداد إلى وسيلة الدفع الأصلية، ويعتمد موعد ظهوره على البنك.<br><span dir="ltr">This receipt documents cancellation and the refund request. It does not confirm credit to your card. Refunds return to the original payment method; bank posting times vary.</span></p><p style="font-size:12px">لا تحتاج إلى تقديم طلب استرداد آخر. يمكنك متابعة الحالة من حسابك.<br><span dir="ltr">No duplicate request is needed. Track the latest status in your account.</span></p><p style="border-top:1px solid #dce9eb;padding-top:16px;font-size:12px">فريق الحجوزات · Reservation support<br><a style="color:#146f7f" href="mailto:management@remaltourismllc.com">management@remaltourismllc.com</a></p></div></div></body></html>`;
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
    return renderReceipt(details).replace('</head>', `<style>@page{size:A4;margin:12mm}body{font-size:11px;line-height:1.5}body>div{max-width:none!important}body>div>div:first-child{padding:16px 22px!important}body>div>div:last-child{padding:16px 22px!important}h1{font-size:20px!important;margin:10px 0!important;line-height:1.4!important}p{margin:8px 0!important;line-height:1.6!important;font-size:11px!important}td{padding:8px 6px!important;font-size:11px!important}tr{break-inside:avoid}</style></head>`);
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
module.exports = { receiptDetails, renderReceipt, renderReceiptPdf, loadReceipt, generateReceipt, sendReceipt, processPendingReceipts };
