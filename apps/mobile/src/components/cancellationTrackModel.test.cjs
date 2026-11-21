/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const m = load(path.resolve(__dirname, './cancellationTrackModel.ts'));
const api = load(path.resolve(__dirname, '../api/cancellation.ts'));

const view = (status, refund, extra = {}) => api.normalizeTracking({ status, customer_refund_status: refund,
  customer_refund: { amount: '1191.96', currency_code: 'USD' }, customer_fee: { amount: '132.44', currency_code: 'USD' },
  cancellation_reference: 'CAN-AB12CD34EF56', receipt_status: 'not_requested', ...extra });

test('a cancellation is called done only when the hotel confirms, and refunded only when the refund completes', () => {
  const pending = m.cancellationTrackModel(view('cancel_pending', 'not_processed'), 'ar', 10);
  assert.equal(pending.tone, 'working'); assert.equal(pending.live, true);
  assert.deepEqual(pending.stages.map(s => s.state), ['done', 'active', 'waiting', 'waiting']);
  assert.ok(!/تم إلغاء/.test(pending.title));
  const refunding = m.cancellationTrackModel(view('cancelled', 'pending'), 'ar', 10);
  assert.deepEqual(refunding.stages.map(s => s.state), ['done', 'done', 'active', 'waiting']);
  assert.match(refunding.expectation, /5 إلى 10 أيام عمل/);
  assert.match(refunding.body, /USD\s1,191\.96/);
  const done = m.cancellationTrackModel(view('cancelled', 'completed'), 'en', 10);
  assert.equal(done.tone, 'success'); assert.deepEqual(done.stages.map(s => s.state), ['done', 'done', 'done', 'done']);
  const none = m.cancellationTrackModel(view('cancelled', 'not_due'), 'en', 10);
  assert.match(none.body, /no refund/);
  const failed = m.cancellationTrackModel(view('cancel_failed', 'not_processed'), 'ar', 10);
  assert.equal(failed.tone, 'attention'); assert.match(failed.body, /ما زال قائماً/);
  assert.match(m.cancellationTrackModel(view('cancel_pending', 'not_processed'), 'en', 200).expectation, /longer than usual/);
});

test('polling follows the hotel, then the refund, and stops', () => {
  assert.equal(m.cancellationPollDelay(view('cancelling', 'not_processed'), 10_000), 3_000);
  assert.equal(m.cancellationPollDelay(view('cancel_pending', 'not_processed'), 2 * 60_000), 6_000);
  assert.equal(m.cancellationPollDelay(view('cancelled', 'pending'), 30_000), 5_000);
  assert.equal(m.cancellationPollDelay(view('cancelled', 'pending'), 11 * 60_000), null);
  assert.equal(m.cancellationPollDelay(view('cancelled', 'completed'), 1_000), null);
  assert.equal(m.cancellationPollDelay(view('cancel_pending', 'not_processed'), 31 * 60_000), null);
});

test('cancellation responses: a signed quote, support when it cannot be automatic, and unknown states rejected', () => {
  const quote = api.normalizeCancellationOffer({ reference: 'MKH-1', mode: 'automatic', policy: 'p', penalty: { amount: '36.00', currency_code: 'USD' },
    fee: { amount: '132.44', currency_code: 'USD' }, refund: { amount: '1191.96', currency_code: 'USD' }, expires_at: 1900000000000, quote_token: 'a.b' }, 'MKH-1');
  assert.equal(quote.mode, 'automatic'); assert.deepEqual(quote.refund, { amount: '1191.96', currency: 'USD' });
  assert.equal(api.normalizeCancellationOffer({ reference: 'MKH-1', mode: 'automatic', policy: '' }, 'MKH-1').mode, 'support');
  assert.equal(api.normalizeCancellationOffer({ reference: 'MKH-1', mode: 'checking', retry_after_ms: 1 }, 'MKH-1').retryAfterMs, 1500);
  assert.throws(() => api.normalizeCancellationOffer({ reference: 'OTHER', mode: 'support' }, 'MKH-1'));
  assert.throws(() => api.normalizeTracking({ status: 'refunded_somehow' }));
  assert.equal(api.validReference('../x'), false);
});
