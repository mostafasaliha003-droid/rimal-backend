/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const f = load(path.resolve(__dirname, './format.ts'));

test('amounts are grouped and padded to the currency minor unit without rounding supplier digits', () => {
  assert.equal(f.exactAmount('1234', 'USD'), '1,234.00');
  assert.equal(f.exactAmount('1234.5', 'AED'), '1,234.50');
  assert.equal(f.exactAmount('1234.567', 'USD'), '1,234.567', 'extra supplier precision is kept, never rounded');
  assert.equal(f.exactAmount('0012345678.9', 'USD'), '12,345,678.90');
  assert.equal(f.exactAmount('15.5', 'KWD'), '15.500');
  assert.equal(f.exactAmount('1500', 'JPY'), '1,500');
  for (const bad of ['', '-1', '1e3', '1,234', '12.', 'NaN']) assert.equal(f.exactAmount(bad, 'USD'), null, bad);
  assert.equal(f.exactAmount('10', 'usd'), null);
});

test('money reads left-to-right inside Arabic text and states its currency code', () => {
  assert.equal(f.formatMoney({ amount: '1585.92', currency: 'USD' }), '⁦USD 1,585.92⁩');
  assert.equal(f.formatMoney({ amount: '90', currency: 'AED' }, { isolate: false }), 'AED 90.00');
  assert.equal(f.formatMoney(null), null);
  assert.equal(f.formatMoney({ amount: 'x', currency: 'USD' }), null);
});

test('a short address keeps the street and city and drops the country', () => {
  assert.equal(f.shortAddress('Jumeirah Beach Road, Dubai, United Arab Emirates', 'en'), 'Jumeirah Beach Road, Dubai');
  assert.equal(f.shortAddress('شارع شاطئ جميرا، دبي، الإمارات', 'ar'), 'شارع شاطئ جميرا، دبي');
  assert.equal(f.shortAddress('Marina Walk, Dubai', 'en'), 'Marina Walk, Dubai');
  assert.equal(f.shortAddress(' Dubai ', 'en'), 'Dubai');
  assert.equal(f.shortAddress('', 'en'), '');
  assert.equal(f.shortAddress(undefined, 'ar'), '');
});

test('dates are day-first in both languages and Arabic uses the same Western digits as prices', () => {
  assert.equal(f.formatDay('2026-12-14', 'en', { year: 'always' }), '14 Dec 2026');
  assert.match(f.formatDay('2026-12-14', 'en', { weekday: true, year: 'never' }), /^Mon,? 14 Dec$/);
  const arabic = f.formatDay('2026-12-14', 'ar', { weekday: true, year: 'always' });
  assert.match(arabic, /14/); assert.doesNotMatch(arabic, /[٠-٩]/);
  assert.equal(f.formatWeekday('2026-12-17', 'en'), 'Thursday');
  assert.equal(f.formatDay('2026-02-30', 'en'), '2026-02-30', 'invalid dates are shown as supplied, not shifted');
  assert.equal(f.nightsBetween('2026-12-14', '2026-12-17'), 3);
  assert.equal(f.nightsBetween('2026-12-17', '2026-12-14'), null);
});

test('Arabic counted nouns use dual and plural forms, with the genitive after prepositions', () => {
  const ar = f.stayWords('ar'), after = f.stayWords('ar', { genitive: true });
  assert.deepEqual([1, 2, 3, 11].map(ar.nights), ['ليلة واحدة', 'ليلتان', '3 ليالٍ', '11 ليلة']);
  assert.deepEqual([1, 2, 3].map(ar.rooms), ['غرفة واحدة', 'غرفتان', '3 غرف']);
  assert.equal(after.rooms(2), 'غرفتين');
  assert.equal(after.guests(2), 'ضيفين');
  assert.equal(f.stayWords('en').children(1), '1 child');
  assert.equal(f.untilLabel(2, 'ar'), 'بعد يومين');
  assert.equal(f.untilLabel(12, 'ar'), 'بعد 12 يوماً');
  assert.equal(f.untilLabel(1, 'en'), 'Tomorrow');
});

test('family occupancy reads the same everywhere: summary line and one line per room with ages', () => {
  const rooms = [{ adults: 1, children: [8] }, { adults: 1, children: [5] }];
  assert.equal(f.guestLine(rooms, 'en'), '2 adults · 2 children · 2 rooms');
  assert.equal(f.guestLine(rooms, 'ar'), 'بالغان · طفلان · غرفتان');
  assert.equal(f.stayLine(3, rooms, 'en'), '3 nights · 2 rooms · 4 guests');
  assert.deepEqual(f.roomLines(rooms, 'en'), ['Room 1: 1 adult, 1 child (8)', 'Room 2: 1 adult, 1 child (5)']);
  assert.deepEqual(f.roomLines(rooms, 'ar'), ['الغرفة 1: بالغ واحد، طفل واحد (8)', 'الغرفة 2: بالغ واحد، طفل واحد (5)']);
  assert.deepEqual(f.occupancy(rooms), { rooms: 2, adults: 2, children: 2, guests: 4 });
});

test('whole prices drop only an all-zero fraction and never round supplier digits', () => {
  assert.equal(f.formatPrice({ amount: '816.00', currency: 'USD' }), '⁦USD 816⁩');
  assert.equal(f.formatPrice({ amount: '1585.92', currency: 'USD' }), '⁦USD 1,585.92⁩');
  assert.equal(f.formatPrice({ amount: '90.5', currency: 'AED' }), '⁦AED 90.50⁩');
  assert.equal(f.formatPrice({ amount: '15.000', currency: 'KWD' }), '⁦KWD 15⁩');
  assert.equal(f.formatPrice({ amount: '1500', currency: 'JPY' }), '⁦JPY 1,500⁩');
  assert.equal(f.formatPrice(null), null);
});

test('stay ranges read the way people say them, with the year only when needed', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  assert.equal(f.formatStayRange('2026-12-21', '2026-12-24', 'en', now), '21–24 Dec');
  assert.equal(f.formatStayRange('2026-12-28', '2027-01-02', 'en', now), '28 Dec 2026 – 2 Jan 2027');
  assert.equal(f.formatStayRange('2027-03-01', '2027-03-04', 'en', now), '1–4 Mar 2027');
  assert.equal(f.formatStayRange('2026-11-29', '2026-12-02', 'en', now), '29 Nov – 2 Dec');
  const arabic = f.formatStayRange('2026-12-21', '2026-12-24', 'ar', now);
  assert.match(arabic, /^21–24 \S+$/); assert.doesNotMatch(arabic, /[٠-٩]/);
  assert.equal(f.formatStayRange('bad', '2026-12-24', 'en', now), 'bad – 2026-12-24');
});
