/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { livePaymentModel, livePollDelay, LIVE_STATUSES, SLOW_AFTER_SECONDS } = load(path.resolve(__dirname, './livePaymentModel.ts'));

const states = view => view.stages.map(stage => stage.state).join(',');

test('only the server status decides: nothing is confirmed until booking_confirmed', () => {
  for (const status of ['awaiting_payment', 'intent_unknown', 'payment_verified', 'booking_pending']) {
    const view = livePaymentModel(status, 'en', 10);
    assert.equal(view.tone, 'working', status);
    assert.doesNotMatch(view.title, /confirmed/i, status);
    assert.notEqual(view.stages[3].state, 'done', status);
  }
  const done = livePaymentModel('booking_confirmed', 'en', 10);
  assert.equal(done.tone, 'success'); assert.equal(states(done), 'done,done,done,done'); assert.equal(done.live, false);
});

test('payment and hotel confirmation are separate stages', () => {
  assert.equal(states(livePaymentModel('awaiting_payment', 'ar', 0)), 'done,active,waiting,waiting');
  assert.equal(states(livePaymentModel('payment_verified', 'ar', 0)), 'done,done,active,waiting');
  assert.equal(states(livePaymentModel('payment_failed', 'ar', 0)), 'done,failed,waiting,waiting');
  assert.equal(states(livePaymentModel('booking_failed', 'ar', 0)), 'done,done,failed,waiting');
  assert.equal(livePaymentModel('payment_verified', 'ar', 0).title, 'تم استلام دفعتك بنجاح');
});

test('waiting copy sets expectations, then says plainly when it is slower than usual', () => {
  const early = livePaymentModel('booking_pending', 'en', 20);
  assert.equal(early.slow, false); assert.match(early.expectation, /under a minute/); assert.match(early.guidance, /do not pay again/);
  const late = livePaymentModel('booking_pending', 'en', SLOW_AFTER_SECONDS);
  assert.equal(late.slow, true); assert.match(late.expectation, /longer than usual/);
  assert.match(livePaymentModel('awaiting_payment', 'en', 5).guidance, /Open secure payment/);
});

test('failures and refunds reuse the reviewed status wording and stop the live updates when final', () => {
  const failed = livePaymentModel('booking_failed', 'en', 0);
  assert.equal(failed.tone, 'attention'); assert.equal(failed.live, false); assert.equal(failed.title, 'The hotel booking could not be confirmed');
  assert.equal(livePaymentModel('refund_pending', 'en', 0).live, true);
});

test('polling is quick at first, backs off, and stops for final states or after half an hour', () => {
  assert.equal(livePollDelay('booking_pending', 5_000), 3_000);
  assert.equal(livePollDelay('booking_pending', 2 * 60_000), 6_000);
  assert.equal(livePollDelay('booking_pending', 10 * 60_000), 15_000);
  assert.equal(livePollDelay('awaiting_payment', 5_000), 5_000);
  assert.equal(livePollDelay('booking_confirmed', 0), null);
  assert.equal(livePollDelay('booking_pending', 31 * 60_000), null);
  assert.ok(LIVE_STATUSES.includes('payment_verified') && !LIVE_STATUSES.includes('booking_failed'));
});
