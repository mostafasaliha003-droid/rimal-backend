const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldShowWelcome, WELCOME_QUIET_MS } = require('./welcomeModel.ts');

test('the welcome front opens only for a signed-out launch onto Explore', () => {
  const now = 1_800_000_000_000;
  const base = { status: 'signedOut', pathname: '/', exploredAt: null, now };
  assert.equal(shouldShowWelcome(base), true);
  assert.equal(shouldShowWelcome({ ...base, status: 'loading' }), false);
  assert.equal(shouldShowWelcome({ ...base, status: 'signedIn' }), false);
  assert.equal(shouldShowWelcome({ ...base, restorePending: true }), false);
  for (const pathname of ['/checkout', '/hotel/10004834', '/account', '/bookings']) assert.equal(shouldShowWelcome({ ...base, pathname }), false);
});

test('"explore first" quiets the welcome front for a week, then it returns', () => {
  const now = 1_800_000_000_000;
  const base = { status: 'signedOut', pathname: '/', now };
  assert.equal(shouldShowWelcome({ ...base, exploredAt: String(now - 60_000) }), false);
  assert.equal(shouldShowWelcome({ ...base, exploredAt: String(now - WELCOME_QUIET_MS + 1) }), false);
  assert.equal(shouldShowWelcome({ ...base, exploredAt: String(now - WELCOME_QUIET_MS) }), true);
  // A clock set back, or a corrupt value, never hides it for good.
  for (const exploredAt of [String(now + 60_000), 'yes', '', '-5', 12, undefined]) assert.equal(shouldShowWelcome({ ...base, exploredAt }), true);
});
