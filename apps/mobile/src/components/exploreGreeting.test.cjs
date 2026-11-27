/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { exploreGreeting } = load(path.resolve(__dirname, './exploreGreeting.ts'));

test('Explore greets by the time of day, in Arabic and English', () => {
  assert.equal(exploreGreeting(7, 'ar'), 'صباح الخير');
  assert.equal(exploreGreeting(14, 'ar'), 'مساء الخير');
  assert.equal(exploreGreeting(4, 'ar'), 'مساء الخير');
  assert.equal(exploreGreeting(5, 'en'), 'Good morning');
  assert.equal(exploreGreeting(12, 'en'), 'Good afternoon');
  assert.equal(exploreGreeting(18, 'en'), 'Good evening');
  assert.equal(exploreGreeting(23, 'en'), 'Good evening');
});

test('the greeting uses only the first name, and nothing when there is no name', () => {
  assert.equal(exploreGreeting(20, 'ar', 'ليلى حداد'), 'مساء الخير، ليلى');
  assert.equal(exploreGreeting(9, 'en', '  Layla   Haddad '), 'Good morning, Layla');
  assert.equal(exploreGreeting(9, 'en', '   '), 'Good morning');
  assert.equal(exploreGreeting(9, 'en', null), 'Good morning');
  assert.equal(exploreGreeting(9, 'en', 'x'.repeat(90)).length, 'Good morning, '.length + 40);
});
