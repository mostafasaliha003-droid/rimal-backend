/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  const requireHere = name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(full), name);
    if (!path.extname(target)) target += '.ts';
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(requireHere, module, module.exports);
  return module.exports;
}
const { normalizeBookingHistory, getOwnedBookings } = load('../bookings.ts');
const row = patch => ({ bookingReference: 'booking-123', provider: 'ratehawk', hotelName: 'Example Hotel',
  roomType: 'Double room', checkInDate: '2027-02-16', checkOutDate: '2027-02-18',
  status: 'active', supplierStatus: 'CONFIRMED', price: 25.5, priceCurrency: 'USD', ...patch });
const normalize = value => normalizeBookingHistory({ success: true, bookings: [value] })[0];

test('owned history whitelists presentation fields and discards profile/contact/card/supplier payloads', () => {
  const result = normalizeBookingHistory({ success: true, profile: { email: 'private@example.test', savedCards: [{ cardToken: 'private' }] },
    bookings: [row({ customerName: 'Private Guest', email: 'private@example.test', phone: '+10000000000',
      ownerSubject: 'private', realm: 'private', supplierReference: 'private', hotelConfirmationNumber: 'private',
      encrypted_details: { private: true }, supplier_price: 7 })] });
  assert.deepEqual(Object.keys(result[0]).sort(), ['reference', 'hotelName', 'roomName', 'checkin', 'checkout',
    'recordedStatus', 'supplierStatus', 'statusKind', 'price'].sort());
  assert.doesNotMatch(JSON.stringify(result), /private|Private Guest|cardToken|supplier_price/);
  assert.equal(result[0].reference, 'booking-123');
});

test('history requires the authenticated profile response envelope; malformed rows and duplicate identities fail closed', () => {
  assert.deepEqual(normalizeBookingHistory({ success: true, bookings: [] }), []);
  for (const value of [null, [], {}, { success: false, bookings: [] }, { success: true, bookings: null },
    { success: true, bookings: [null] }, { success: true, bookings: [row({ bookingReference: '' })] },
    { success: true, bookings: [row(), row()] }, { success: true, bookings: [row({ bookingReference: 'bad\nreference' })] }]) {
    assert.throws(() => normalizeBookingHistory(value), /invalid_response/);
  }
});

test('customer prices use only explicit public price/currency from known persisted providers, preserving zero', () => {
  assert.deepEqual(normalize(row({ price: 0 })).price, { amount: '0', currency: 'USD' });
  assert.deepEqual(normalize(row({ provider: 'hotelbeds', price: '123.450', priceCurrency: 'KWD' })).price,
    { amount: '123.450', currency: 'KWD' });
  for (const patch of [{ price: undefined, supplier_price: '10', amount: '10' }, { priceCurrency: undefined, currency: 'USD' },
    { price: null }, { price: true }, { price: -1 }, { price: Infinity }, { price: '' }, { price: ' 1 ' },
    { price: '1e2' }, { price: '1.1234' }, { priceCurrency: 'usd' }, { priceCurrency: 'US' }, { provider: 'unknown' }]) {
    assert.equal(normalize(row(patch)).price, null, JSON.stringify(patch));
  }
});

test('record state active alone never becomes supplier confirmation and adverse/conflicting states stay explicit', () => {
  assert.equal(normalize(row({ supplierStatus: undefined })).statusKind, 'unknown');
  assert.equal(normalize(row()).statusKind, 'confirmed');
  assert.equal(normalize(row({ status: 'cancelled' })).statusKind, 'cancelled');
  assert.equal(normalize(row({ status: 'pending' })).statusKind, 'pending');
  assert.equal(normalize(row({ status: 'failed' })).statusKind, 'failed');
  assert.equal(normalize(row({ status: 'manual_review' })).statusKind, 'unknown');
  assert.equal(normalize(row({ status: 'confirmed', supplierStatus: 'ON_REQUEST' })).statusKind, 'pending');
  assert.equal(normalize(row({ status: 'active', supplierStatus: 'CANCELED' })).statusKind, 'cancelled');
});

test('stay dates are strict calendar values, never guessed from malformed/inverted records', () => {
  assert.equal(normalize(row({ checkInDate: '2032-02-29', checkOutDate: '2032-03-02' })).checkin, '2032-02-29');
  assert.equal(normalize(row({ checkInDate: '2031-02-29' })).checkin, null);
  assert.equal(normalize(row({ checkOutDate: '2027-02-18T00:00:00Z' })).checkout, null);
  const inverted = normalize(row({ checkInDate: '2027-02-19', checkOutDate: '2027-02-18' }));
  assert.equal(inverted.checkin, null); assert.equal(inverted.checkout, null);
  assert.equal(normalize(row({ hotelName: null, roomType: null })).hotelName, null);
});

test('history preserves server order and supports genuine empty records without fabricated data', () => {
  const result = normalizeBookingHistory({ success: true, bookings: [row({ bookingReference: 'newest' }), row({ bookingReference: 'oldest' })] });
  assert.deepEqual(result.map(item => item.reference), ['newest', 'oldest']);
  const bare = normalize({ bookingReference: 'only-reference' });
  assert.equal(bare.price, null); assert.equal(bare.statusKind, 'unknown'); assert.equal(bare.checkin, null);
});

test('API helper sends only authenticated GET profile path and the abort signal, with no caller identity parameters', async () => {
  const controller = new AbortController(); let capture;
  const result = await getOwnedBookings(async (...args) => { capture = args; return { success: true, bookings: [row()] }; }, controller.signal);
  assert.equal(capture[0], 'GET'); assert.equal(capture[1], '/user/profile');
  assert.deepEqual(Object.keys(capture[2]).sort(), ['signal', 'timeoutMs']);
  assert.equal(capture[2].signal, controller.signal); assert.equal(capture[2].timeoutMs, 20000);
  assert.equal(result.length, 1);
});

test('network/auth failures propagate to the caller instead of being misreported as an empty booking history', async () => {
  const error = new Error('session_expired');
  await assert.rejects(getOwnedBookings(async () => { throw error; }), value => value === error);
  await assert.rejects(getOwnedBookings(async () => ({ success: false, error: 'profile_unavailable' })), /invalid_response/);
});
