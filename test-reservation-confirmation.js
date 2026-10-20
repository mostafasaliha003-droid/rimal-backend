const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('./services/reservationConfirmationService');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

const booking = () => ({ bookingReference: 'fixture-reference', supplierReference: 'fixture-supplier',
    provider: 'ratehawk', status: 'active', supplierStatus: 'CONFIRMED', email: 'guest@example.test',
    hotelName: 'Hotel <script>alert(1)</script>', roomType: 'Double room', customerName: 'Test Guest',
    checkInDate: '2099-10-23', checkOutDate: '2099-10-24', price: 27.82, priceCurrency: 'USD' });
const input = () => ({ reference: 'fixture-reference', supplierReference: 'fixture-supplier',
    ownerSubject: 'fixture-owner', realm: 'fixture-staging', email: 'guest@example.test',
    amountMinor: 2782, currency: 'USD', sandbox: true, pdfBuffer: Buffer.from('%PDF-1.4\nsupplier-original') });

test('confirmation contains actual reservation facts and escapes HTML without inventing policies', () => {
    const details = service.confirmationDetails(booking(), input());
    const email = service.renderConfirmationEmail(details);
    const pdf = service.renderConfirmationPdf(details);
    for (const html of [email.html, pdf]) {
        assert.match(html, /2099-10-23/);
        assert.match(html, /2099-10-24/);
        assert.match(html, /27.82 USD/);
        assert.match(html, /fixture-supplier/);
        assert.match(html, /Sandbox only/);
        assert.doesNotMatch(html, /<script>/);
        assert.doesNotMatch(html, /\{\{/);
    }
    for (const changes of [{ status: 'cancelled' }, { supplierReference: 'other' },
        { price: 28 }, { email: 'other@example.test' }]) {
        assert.throws(() => service.confirmationDetails({ ...booking(), ...changes }, input()));
    }
});

for (const [name, sandbox, blank] of [
    ['sandbox replaces the known blank placeholder with a marked Remal confirmation', true, true],
    ['production preserves the original supplier PDF alongside the Remal confirmation', false, false],
    ['production refuses the known blank supplier placeholder', false, true]
]) test(name, async context => {
    const oldUser = process.env.SMTP_USER, oldPassword = process.env.SMTP_PASSWORD;
    process.env.SMTP_USER = 'sender@example.test'; process.env.SMTP_PASSWORD = 'fixture-only';
    context.after(() => {
        if (oldUser === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = oldUser;
        if (oldPassword === undefined) delete process.env.SMTP_PASSWORD; else process.env.SMTP_PASSWORD = oldPassword;
    });
    const oldModel = mongoose.models.Booking;
    mongoose.models.Booking = { findOne: filter => {
        assert.equal(filter.ownerSubject, 'fixture-owner'); assert.equal(filter.realm, 'fixture-staging');
        assert.equal(filter.supplierStatus, 'CONFIRMED');
        return { lean: async () => booking() };
    } };
    context.after(() => { if (oldModel) mongoose.models.Booking = oldModel; else delete mongoose.models.Booking; });
    let message;
    context.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async value => {
        message = value; return { messageId: 'fixture-message', accepted: [value.to] };
    } }));
    context.mock.method(service, 'isKnownBlankSupplierVoucher', () => blank);
    context.mock.method(service, 'generateConfirmationPdf', async () => Buffer.from('%PDF-1.4\nremal-confirmation'));
    delete require.cache[require.resolve('./services/notificationService')];
    context.after(() => { delete require.cache[require.resolve('./services/notificationService')]; });
    const notification = require('./services/notificationService');
    const value = { ...input(), sandbox };
    if (!sandbox && blank) {
        await assert.rejects(notification.sendVoucherConfirmation(value), /supplier_voucher_blank/);
        assert.equal(message, undefined); return;
    }
    await notification.sendVoucherConfirmation(value);
    assert.equal(message.attachments.length, blank ? 1 : 2);
    assert.match(message.attachments[0].filename, /^Remal-Confirmation-/);
    if (!blank) assert.equal(message.attachments[1].content, value.pdfBuffer);
    assert.match(message.html, /Double room/);
    assert.equal(message.replyTo, 'management@remaltourismllc.com');
});
