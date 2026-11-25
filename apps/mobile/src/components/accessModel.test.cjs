const test = require('node:test');
const assert = require('node:assert/strict');
const { accessFor, accessRedirect, memberOnly, returnPath } = require('./accessModel.ts');

test('access follows the session first, then the membership answer', () => {
  assert.equal(accessFor({ authStatus: 'loading', membership: null }), 'checking');
  assert.equal(accessFor({ authStatus: 'signedOut', membership: null }), 'guest');
  assert.equal(accessFor({ authStatus: 'signedOut', restorePending: true, membership: null }), 'offline');
  assert.equal(accessFor({ authStatus: 'signedIn', membership: null }), 'checking');
  assert.equal(accessFor({ authStatus: 'signedIn', membership: 'error' }), 'offline');
  assert.equal(accessFor({ authStatus: 'signedIn', membership: false }), 'applicant');
  assert.equal(accessFor({ authStatus: 'signedIn', membership: true }), 'member');
});

test('hotels, prices and saved stays are members only', () => {
  for (const path of ['/', '/saved', '/results', '/hotel/10004834', '/review', '/compare', '/saved-offers', '/saved-dates', '/reviews/10004834', '/unknown', '/change/abc'])
    assert.equal(memberOnly(path), true, path);
  for (const path of ['/welcome', '/account', '/support', '/membership', '/notifications', '/account-deletion', '/bookings', '/checkout', '/cancel/abc', '/care/abc'])
    assert.equal(memberOnly(path), false, path);
});

test('a guest sees only the welcome front, the sign-in form and support', () => {
  for (const path of ['/', '/saved', '/results', '/hotel/1', '/bookings', '/membership', '/checkout', '/cancel/x', '/care/x', '/notifications'])
    assert.equal(accessRedirect('guest', path), '/welcome', path);
  for (const path of ['/welcome', '/account', '/account/', '/support', '/account?mode=register'])
    assert.equal(accessRedirect('guest', path), null, path);
});

test('an applicant is sent to their membership page from any hotel route and from the welcome front', () => {
  for (const path of ['/', '/saved', '/results', '/hotel/1', '/review', '/welcome']) assert.equal(accessRedirect('applicant', path), '/membership', path);
  for (const path of ['/membership', '/account', '/notifications', '/support', '/account-deletion', '/bookings', '/checkout', '/cancel/x', '/care/x'])
    assert.equal(accessRedirect('applicant', path), null, path);
});

test('a member goes anywhere and leaves the welcome front; unknown access never redirects', () => {
  for (const path of ['/', '/results', '/hotel/1', '/membership']) assert.equal(accessRedirect('member', path), null, path);
  assert.equal(accessRedirect('member', '/welcome'), '/');
  for (const access of ['checking', 'offline']) for (const path of ['/', '/welcome', '/account']) assert.equal(accessRedirect(access, path), null);
});

test('a guest\'s deep link is kept for after sign-in, only for routes worth returning to', () => {
  assert.equal(returnPath('/hotel/10004834'), '/hotel/10004834');
  assert.equal(returnPath('/saved'), '/saved');
  assert.equal(returnPath('/results'), '/results');
  for (const path of ['/', '/welcome', '/account', '/hotel/abc', '/reviews/1', '/unknown', '/checkout']) assert.equal(returnPath(path), undefined, path);
});
