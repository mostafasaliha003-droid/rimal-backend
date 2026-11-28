'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const documentBrand = require('../services/documentBrand');

const SERVICE = require.resolve('../services/notificationService');

// Loads notificationService with a transport that records each message instead of sending it.
function loadNotifications(context) {
    const sent = [];
    const previous = { user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD };
    process.env.SMTP_USER = 'mailbox@example.test';
    process.env.SMTP_PASSWORD = 'fixture';
    context.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async message => {
        sent.push(message);
        return { messageId: `fixture-${sent.length}`, accepted: [message.to, message.bcc].filter(Boolean) };
    } }));
    delete require.cache[SERVICE];
    context.after(() => {
        delete require.cache[SERVICE];
        for (const [key, value] of [['SMTP_USER', previous.user], ['SMTP_PASSWORD', previous.password]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    });
    return { notification: require(SERVICE), sent };
}

const supportSender = { name: 'Pillow Stays', address: 'support@pillowstays.app' };

test('document file names carry the booking reference and the UAE issue date', () => {
    // 21:30 UTC on 28 Nov is already 29 Nov in Dubai (UTC+4).
    assert.equal(documentBrand.documentFileName('Confirmation', 'RB-123', new Date('2026-11-28T21:30:00Z')),
        'PillowStays-Confirmation-RB-123-20261129.pdf');
    assert.equal(documentBrand.documentFileName('CancellationReceipt', 'RB 9/../x', new Date('2026-01-05T08:00:00Z')),
        'PillowStays-CancellationReceipt-RB-9-x-20260105.pdf');
    assert.throws(() => documentBrand.documentFileName('Confirmation', '///'), /document_reference_invalid/);
    assert.throws(() => documentBrand.documentFileName('../x', 'RB-1'), /document_kind_invalid/);
    assert.throws(() => documentBrand.dubaiDateStamp('not a date'), /document_date_invalid/);
});

test('customer e-mails come from and reply to support@; only invoice e-mails copy accounts@', () => {
    assert.equal(documentBrand.BRAND.support, 'support@pillowstays.app');
    assert.deepEqual(documentBrand.customerMailHeaders(), { from: supportSender, replyTo: 'support@pillowstays.app' });
    assert.deepEqual(documentBrand.customerMailHeaders({ withAccountsCopy: true }),
        { from: supportSender, replyTo: 'support@pillowstays.app', bcc: 'accounts@pillowstays.app' });
});

test('the refund e-mail is sent from support@ with a blind copy to accounts@ and marks sandbox refunds', async context => {
    const { notification, sent } = loadNotifications(context);
    const refund = { email: 'guest@example.test', guestName: 'Test Guest', reference: 'RB-1', amountMinor: 4000, currency: 'USD' };
    await notification.sendRefundConfirmation({ ...refund, sandbox: true });
    await notification.sendRefundConfirmation(refund);
    for (const message of sent) {
        assert.deepEqual(message.from, supportSender);
        assert.equal(message.replyTo, 'support@pillowstays.app');
        assert.equal(message.bcc, 'accounts@pillowstays.app');
        assert.equal(message.to, 'guest@example.test');
    }
    assert.match(sent[0].subject, /^\[SANDBOX\] .*refund confirmation \| RB-1$/);
    assert.doesNotMatch(sent[1].subject, /SANDBOX/);
});

test('the cancellation receipt goes from support@, copies accounts@ and names its PDF by reference and date', async context => {
    const { notification, sent } = loadNotifications(context);
    const details = { email: 'guest@example.test', reference: 'RB-2', cancellationReference: 'CAN-ABC', guestName: 'Test Guest',
        hotelName: 'Fixture Hotel', currency: 'USD', paid: '40.00', fee: '0.00', refund: '40.00', refundStatus: 'pending',
        sandbox: true, issuedAt: '2026-11-28T10:00:00.000Z', requestedAt: '2026-11-28T09:59:00.000Z' };
    await notification.sendCancellationReceipt({ details, buffer: Buffer.from('%PDF-1.4 fixture') });
    const [message] = sent;
    assert.deepEqual(message.from, supportSender);
    assert.equal(message.replyTo, 'support@pillowstays.app');
    assert.equal(message.bcc, 'accounts@pillowstays.app');
    assert.match(message.subject, /^\[SANDBOX\] .*\| RB-2$/);
    assert.equal(message.attachments[0].filename, 'PillowStays-CancellationReceipt-RB-2-20261128.pdf');
    assert.equal(message.attachments[0].contentType, 'application/pdf');
});

test('receipts carry the licensed company details; the TRN appears once COMPANY_TRN is set', () => {
    const { companyLegalLine, footer, COMPANY } = documentBrand;
    assert.equal(COMPANY.name, 'REMAL GROUP L.L.C-FZ');
    assert.equal(COMPANY.nameAr, 'مجموعة ريمال ش.ذ.م.م-منطقة حرة');
    assert.equal(companyLegalLine({}),
        'مجموعة ريمال ش.ذ.م.م-منطقة حرة · REMAL GROUP L.L.C-FZ · Licence 2312342.01 · Meydan Grandstand, 6th floor, Meydan Road, Nad Al Sheba, Dubai, UAE');
    assert.match(companyLegalLine({ COMPANY_TRN: '100 1234 5678 9003' }), / · TRN 100123456789003$/);
    assert.doesNotMatch(companyLegalLine({ COMPANY_TRN: '12345' }), /TRN/, 'an invalid TRN is never printed');
    assert.match(footer({ legal: true, env: {} }), /REMAL GROUP L\.L\.C-FZ/);
    assert.doesNotMatch(footer(), /REMAL|ريمال/, 'other e-mails carry only the support contact');
});
