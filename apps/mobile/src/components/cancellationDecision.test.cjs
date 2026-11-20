/* global __dirname */
process.env.TZ = 'Asia/Dubai';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { cancellationDecision, policyTime } = load(path.resolve(__dirname, './cancellationDecision.ts'));
const { presentCancellation } = load(path.resolve(__dirname, './cancellationPresentationModel.ts'));

const now = Date.parse('2026-12-01T08:00:00Z');
const total = { amount: '1213.92', currency: 'USD' };
const decide = (cancellation, language = 'en') => cancellationDecision(presentCancellation(cancellation, now), language, total);

test('a free period followed by a fee leads with the local deadline and states the later cost', () => {
  const decision = decide({ freeUntil: '2026-12-10T20:00:00Z', policies: [
    { startAt: null, endAt: '2026-12-10T20:00:00Z', amount: '0.00', currency: 'USD' },
    { startAt: '2026-12-10T20:00:00Z', endAt: null, amount: '404.64', currency: 'USD' }] });
  assert.equal(decision.kind, 'free');
  assert.match(decision.headline, /^Free cancellation until 11 Dec( 2026)?, 00:00 your time$/, 'one line: no weekday, no year this year, a short time-zone label');
  assert.equal(decision.freeUntil, decision.headline.replace('Free cancellation until ', ''));
  assert.equal(decision.detail, 'After that, cancelling costs USD 404.64.');
  const ar = decide({ freeUntil: '2026-12-10T20:00:00Z', policies: [
    { startAt: null, endAt: '2026-12-10T20:00:00Z', amount: '0.00', currency: 'USD' },
    { startAt: '2026-12-10T20:00:00Z', endAt: null, amount: '404.64', currency: 'USD' }] }, 'ar');
  assert.match(ar.headline, /^إلغاء مجاني حتى .*11.*00:00 بتوقيتك$/);
  assert.doesNotMatch(ar.headline, /[٠-٩]/, 'Arabic uses the same Western digits as prices');
});

test('a full-stay charge that never changes is named non-refundable', () => {
  const decision = decide({ freeUntil: null, policies: [{ startAt: null, endAt: null, amount: '1213.92', currency: 'USD' }] });
  assert.equal(decision.nonRefundable, true);
  assert.equal(decision.headline, 'Non-refundable');
  assert.equal(decision.detail, 'Cancelling at any time costs USD 1,213.92 (the full stay price).');
});

test('a partial fee with no later change is not called non-refundable', () => {
  const decision = decide({ freeUntil: null, policies: [{ startAt: null, endAt: null, amount: '200.00', currency: 'USD' }] });
  assert.equal(decision.nonRefundable, false);
  assert.equal(decision.headline, 'Cancel now for USD 200.00');
});

test('a free period with no supplied later fee keeps the deadline but says the later charge is unknown', () => {
  const decision = decide({ freeUntil: '2026-12-10T20:00:00Z', policies: [{ startAt: null, endAt: '2026-12-10T20:00:00Z', amount: '0', currency: 'USD' }] });
  assert.match(decision.headline, /^Free cancellation until /);
  assert.equal(decision.detail, 'The supplier did not state the charge after this time.');
});

test('unverifiable schedules stay unconfirmed instead of promising free cancellation', () => {
  const overlap = decide({ freeUntil: null, policies: [
    { startAt: null, endAt: '2026-12-10T20:00:00Z', amount: '0', currency: 'USD' },
    { startAt: '2026-12-09T20:00:00Z', endAt: null, amount: '100', currency: 'USD' }] });
  assert.equal(overlap.kind, 'unknown');
  assert.equal(overlap.freeUntil, null);
  assert.equal(overlap.headline, 'Cost to cancel now is unconfirmed');
});

test('policy times use day-first dates and keep supplier seconds', () => {
  assert.equal(policyTime('2026-12-10T20:00:00Z', 'en', 'utc'), '10 Dec 2026, 20:00 UTC');
  assert.match(policyTime('2026-12-10T20:00:30Z', 'en', 'utc'), /20:00:30 UTC$/);
  assert.equal(policyTime('not-a-time', 'en'), null);
});
