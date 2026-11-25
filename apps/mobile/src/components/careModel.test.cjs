/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const care = load(path.resolve(__dirname, './careModel.ts'));
const change = load(path.resolve(__dirname, './changeModel.ts'));
const support = load(path.resolve(__dirname, '../api/support.ts'));
const transport = load(path.resolve(__dirname, '../api/transport.ts'));
const cancellation = load(path.resolve(__dirname, '../api/cancellation.ts'));

const id = 'a'.repeat(64);

test('the app may only list, open, read and write its own support conversations', () => {
  assert.equal(transport.allowedRoute('GET', '/support/conversations'), true);
  assert.equal(transport.allowedRoute('POST', '/support/conversations'), true);
  assert.equal(transport.allowedRoute('GET', `/support/conversations/${id}`), true);
  assert.equal(transport.allowedRoute('POST', `/support/conversations/${id}/messages`), true);
  assert.equal(transport.allowedRoute('GET', `/support/conversations/${id}/messages`), false);
  assert.equal(transport.allowedRoute('POST', `/support/conversations/${id}`), false);
  assert.equal(transport.allowedRoute('GET', '/support/conversations/not-an-id'), false);
  assert.equal(transport.allowedRoute('GET', `/support/conversations/${id}/cancellation-receipt`), false);
});

test('conversations and messages are read defensively', () => {
  const row = support.normalizeConversation({ id, reference: 'abc-123', hotelName: 'Hotel', topic: 'weird', status: 'waiting', unread: true, updatedAt: '2026-11-25T10:00:00.000Z' });
  assert.equal(row.topic, 'booking'); assert.equal(row.status, 'waiting'); assert.equal(row.unread, true);
  assert.throws(() => support.normalizeConversation({ id: 'short', reference: 'abc' }));
  const messages = support.normalizeMessages([{ id: '1', body: 'hi', role: 'user', createdAt: '2026-11-25T10:00:00.000Z' },
    { id: '2', body: 'hello', role: 'admin', createdAt: '2026-11-25T10:01:00.000Z' }, { id: '3', body: 'note', role: 'system' }, { id: '4', body: '  ', role: 'user' }]);
  assert.deepEqual(messages.map(m => [m.id, m.mine]), [['1', true], ['2', false]]);
  assert.equal(support.cleanMessage('  hello\r\n '), 'hello');
  assert.equal(support.cleanMessage('x'.repeat(2001)), '');
  assert.equal(support.cleanMessage('bad\u0007'), '');
});

test('the chat groups by day and joins runs from the same side', () => {
  const now = new Date('2026-11-25T18:00:00');
  const at = (h, m) => new Date(2026, 10, 25, h, m).toISOString();
  const rows = care.careRows([
    { id: 'a', body: 'one', mine: true, createdAt: new Date(2026, 10, 24, 9, 0).toISOString() },
    { id: 'b', body: 'two', mine: true, createdAt: at(9, 0) },
    { id: 'c', body: 'three', mine: true, createdAt: at(9, 1) },
    { id: 'd', body: 'four', mine: false, createdAt: at(9, 5) },
  ], 'en', now);
  assert.deepEqual(rows.map(r => r.kind === 'day' ? r.label : `${r.key}:${r.first ? 'F' : ''}${r.last ? 'L' : ''}`),
    ['Yesterday', 'a:FL', 'Today', 'b:F', 'c:L', 'd:FL']);
  assert.equal(care.carePollDelay(10_000), 5_000);
  assert.equal(care.carePollDelay(20 * 60_000), 30_000);
  assert.equal(care.serverTopic('change'), 'booking');
  assert.equal(care.careIntent('nonsense'), 'booking');
  assert.ok(care.quickReplies('change', 'ar').some(item => /تواريخ/.test(item)));
  const sorted = care.sortConversations([{ id: 1, unread: false, updatedAt: '2026-11-25T10:00:00Z' }, { id: 2, unread: true, updatedAt: '2026-11-20T10:00:00Z' }]);
  assert.equal(sorted[0].id, 2);
});

test('a change says what cancelling the old booking costs right now', () => {
  const offer = (fee, refund) => cancellation.normalizeCancellationOffer({ reference: 'R1', mode: 'automatic', policy: '', expires_at: Date.now() + 60000,
    quote_token: 'x.y', penalty: { amount: fee, currency_code: 'AED' }, fee: { amount: fee, currency_code: 'AED' }, refund: { amount: refund, currency_code: 'AED' } }, 'R1');
  assert.deepEqual([change.changeTerms(offer('0.00', '188.62'), 'en').tone, change.changeTerms(offer('0.00', '188.62'), 'en').canCancel], ['success', true]);
  const fee = change.changeTerms(offer('50.00', '138.62'), 'en');
  assert.equal(fee.tone, 'warning'); assert.match(fee.text, /AED\s50\.00/); assert.match(fee.text, /AED\s138\.62/);
  assert.equal(change.changeTerms(offer('188.62', '0.00'), 'ar').canCancel, false);
  assert.equal(change.changeTerms(null, 'en').canCancel, false);
  const supportOnly = cancellation.normalizeCancellationOffer({ reference: 'R1', mode: 'support', policy: '' }, 'R1');
  assert.match(change.changeTerms(supportOnly, 'en').text, /our team/);
});

test('the cancellation quote carries where the refund goes', () => {
  const base = { reference: 'R1', mode: 'automatic', policy: '', expires_at: Date.now() + 60000, quote_token: 'x.y',
    penalty: { amount: '0', currency_code: 'AED' }, fee: { amount: '0', currency_code: 'AED' }, refund: { amount: '10', currency_code: 'AED' } };
  assert.equal(cancellation.normalizeCancellationOffer({ ...base, refund_method: 'tabby' }, 'R1').refundTo, 'tabby');
  assert.equal(cancellation.normalizeCancellationOffer(base, 'R1').refundTo, 'card');
  assert.equal(cancellation.normalizeCancellationOffer({ ...base, refund_method: 'bitcoin' }, 'R1').refundTo, 'card');
});

test('each message keeps its own reading direction', () => {
  assert.equal(care.messageDirection('Thanks, we have this.'), 'ltr');
  assert.equal(care.messageDirection('شكراً، وصلنا طلبك'), 'rtl');
  assert.equal(care.messageDirection('123 — أريد تعديل'), 'rtl');
  assert.equal(care.messageDirection('MKH-QA-24816 رقم الحجز'), 'ltr');
});
