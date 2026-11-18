/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const localRequire = name => name.startsWith('.')
    ? load(path.resolve(path.dirname(full), path.extname(name) ? name : `${name}.ts`)) : require(name);
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
const { buildTripsModel, filterTrips, localTodayKey, formatTripDate } = load('./tripsModel.ts');
const today = '2027-02-17';
const booking = (reference, checkin = '2027-02-16', checkout = '2027-02-18', statusKind = 'confirmed') => ({
  reference, hotelName: 'Supplied hotel', roomName: null, checkin, checkout,
  recordedStatus: 'active', supplierStatus: null, statusKind, price: null,
});

test('Today includes arrival and departure dates while Past begins the following day', () => {
  const model = buildTripsModel([
    booking('checkin-today', today, '2027-02-18'),
    booking('inside-stay'),
    booking('checkout-today', '2027-02-15', today),
    booking('upcoming', '2027-02-18', '2027-02-19'),
    booking('past', '2027-01-01', '2027-01-02'),
  ], today);
  const buckets = Object.fromEntries(model.rows.map(row => [row.booking.reference, row.bucket]));
  assert.deepEqual(buckets, { 'checkin-today': 'current', 'inside-stay': 'current',
    'checkout-today': 'current', upcoming: 'upcoming', past: 'past' });
  assert.deepEqual(model.counts, { all: 5, current: 3, upcoming: 1, past: 1, unknown: 0 });
  assert.equal(buildTripsModel([booking('checkout-today', '2027-02-15', today)], '2027-02-18').rows[0].bucket, 'past');
  assert.equal(model.rows.find(row => row.booking.reference === 'checkout-today').dates.nights, 2);
});

test('missing, invalid and nonpositive ranges stay unknown while valid partial dates remain visible', () => {
  const inputs = [
    booking('missing-start', null, '2027-02-18'),
    booking('missing-end', '2027-02-16', null),
    booking('missing-both', null, null),
    booking('non-leap', '2027-02-29', '2027-03-01'),
    booking('timestamp', '2027-02-16T00:00:00Z', '2027-02-18'),
    booking('unpadded', '2027-2-16', '2027-02-18'),
    booking('blank', '', '2027-02-18'),
    booking('same-day', today, today),
    booking('reversed', '2027-02-19', '2027-02-18'),
  ];
  const rows = buildTripsModel(inputs, today).rows;
  assert.equal(rows.every(row => row.bucket === 'unknown' && row.dates.nights === null), true);
  assert.deepEqual(rows.map(row => row.dates.issue), ['missing', 'missing', 'missing',
    'invalid', 'invalid', 'invalid', 'invalid', 'range', 'range']);
  assert.equal(rows[0].dates.checkout, '2027-02-18');
  assert.equal(rows[1].dates.checkin, '2027-02-16');
  assert.equal(rows[3].dates.checkin, null);
  assert.equal(rows[3].dates.checkout, '2027-03-01');
  assert.equal(rows[8].dates.checkin, '2027-02-19');
  assert.equal(rows[8].dates.checkout, '2027-02-18');
});

test('night counts are whole calendar days across leap days, year boundaries and DST changes', () => {
  const model = buildTripsModel([
    booking('leap', '2032-02-28', '2032-03-01'),
    booking('year', '2026-12-31', '2027-01-02'),
    booking('spring-DST', '2027-03-13', '2027-03-15'),
    booking('fall-DST', '2027-11-06', '2027-11-08'),
  ], today);
  for (const row of model.rows) assert.equal(row.dates.nights, 2, row.booking.reference);
});

test('booking status remains independent from dates and unrecognized status never becomes confirmed', () => {
  const values = ['confirmed', 'cancelled', 'pending', 'failed', 'unknown', 'active', 'booking_confirmed'];
  const input = values.flatMap(status => [
    booking(`current-${status}`, '2027-02-16', '2027-02-18', status),
    booking(`future-${status}`, '2027-02-18', '2027-02-19', status),
    booking(`past-${status}`, '2027-02-14', '2027-02-16', status),
  ]);
  const model = buildTripsModel(input, today);
  assert.deepEqual(model.counts, { all: 21, current: 7, upcoming: 7, past: 7, unknown: 0 });
  for (const row of model.rows) {
    const expected = ['confirmed', 'cancelled', 'pending', 'failed'].includes(row.booking.statusKind)
      ? row.booking.statusKind : 'unknown';
    assert.equal(row.statusKind, expected);
  }
  const rawOnly = { ...booking('raw-confirmed', null, null, 'unknown'), recordedStatus: 'confirmed', supplierStatus: 'CONFIRMED' };
  assert.equal(buildTripsModel([rawOnly], today).rows[0].statusKind, 'unknown');
});

test('all groups have useful chronological order with stable ties and unknown source order', () => {
  const input = [
    booking('unknown-first', null, null), booking('past-old', '2026-12-01', '2026-12-03'),
    booking('future-later', '2027-03-01', '2027-03-03'),
    booking('current-later', '2027-02-15', '2027-02-20'),
    booking('future-tie-first', '2027-02-18', '2027-02-22'),
    booking('current-sooner', '2027-02-16', '2027-02-18'),
    booking('future-tie-second', '2027-02-18', '2027-02-19'),
    booking('past-new', '2027-02-14', '2027-02-16'), booking('unknown-second', 'bad', 'bad'),
    booking('current-tie', today, '2027-02-18'), booking('past-tie', '2027-02-13', '2027-02-16'),
  ];
  const sourceOrder = input.map(row => row.reference);
  input.forEach(Object.freeze); Object.freeze(input);
  const model = buildTripsModel(input, today);
  assert.deepEqual(model.rows.map(row => row.booking.reference), [
    'current-sooner', 'current-tie', 'current-later', 'future-tie-first', 'future-tie-second',
    'future-later', 'past-new', 'past-tie', 'past-old', 'unknown-first', 'unknown-second',
  ]);
  assert.deepEqual(input.map(row => row.reference), sourceOrder);
  assert.equal(model.rows.every(row => input.includes(row.booking)), true);
  assert.equal(Object.isFrozen(model.rows), true);
  assert.equal(Object.isFrozen(model.counts), true);
  assert.equal(Object.isFrozen(model.rows[0].dates), true);
});

test('counts and filters use exactly the same rows, including adverse-status trips and empty history', () => {
  const model = buildTripsModel([
    booking('cancelled-current', '2027-02-16', '2027-02-18', 'cancelled'),
    booking('failed-future', '2027-02-18', '2027-02-19', 'failed'),
    booking('pending-past', '2027-02-14', '2027-02-16', 'pending'), booking('unknown', null, null),
  ], today);
  for (const filter of ['all', 'current', 'upcoming', 'past', 'unknown']) {
    assert.equal(filterTrips(model, filter).length, model.counts[filter]);
  }
  assert.equal(filterTrips(model, 'all'), model.rows);
  assert.deepEqual(buildTripsModel([], today).counts, { all: 0, current: 0, upcoming: 0, past: 0, unknown: 0 });
  assert.deepEqual(filterTrips(buildTripsModel([], today), 'unknown'), []);
  for (const invalid of ['', '2027-2-17', '2027-02-29', '2027-02-17T00:00:00Z']) {
    assert.throws(() => buildTripsModel([], invalid), /invalid_trip_today/);
  }
  assert.throws(() => localTodayKey(new Date(NaN)), /invalid_trip_today/);
});

test('local today follows the device calendar while displayed dates stay invariant across time zones', () => {
  const source = `const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),cache=new Map();
    ${load.toString()}
    const model=load(process.argv[1]);
    console.log(JSON.stringify({today:model.localTodayKey(new Date('2027-02-17T00:30:00Z')),
      en:model.formatTripDate('2027-02-17','en'),ar:model.formatTripDate('2027-02-17','ar'),
      bucket:model.buildTripsModel([${JSON.stringify(booking('checkout-local', '2027-02-15', today))}],
        model.localTodayKey(new Date('2027-02-17T00:30:00Z'))).rows[0].bucket}));`;
  const observed = [];
  for (const [zone, expectedToday, expectedBucket] of [
    ['America/Los_Angeles', '2027-02-16', 'current'], ['Pacific/Kiritimati', today, 'current'],
  ]) {
    const result = spawnSync(process.execPath, ['-e', source, path.resolve(__dirname, 'tripsModel.ts')],
      { encoding: 'utf8', env: { ...process.env, TZ: zone }, timeout: 15000, shell: false });
    assert.equal(result.status, 0, result.stderr);
    const row = JSON.parse(result.stdout);
    assert.equal(row.today, expectedToday, zone); assert.equal(row.bucket, expectedBucket, zone);
    observed.push(row);
  }
  assert.equal(observed[0].en, observed[1].en); assert.equal(observed[0].ar, observed[1].ar);
  assert.match(observed[0].en, /17/);
});

test('formatted labels accept only strict dates and use the supplied Gregorian date in both languages', () => {
  for (const value of [null, '', 'bad', '2027-02-29', '2027-02-17T00:00:00Z']) {
    assert.equal(formatTripDate(value, 'en'), null);
    assert.equal(formatTripDate(value, 'ar'), null);
  }
  assert.equal(formatTripDate('2027-02-17', 'en'), 'Feb 17, 2027');
  const arabicExpected = new Intl.DateTimeFormat('ar', {
    year: 'numeric', month: 'short', day: 'numeric', calendar: 'gregory', timeZone: 'UTC',
  }).format(new Date(Date.UTC(2027, 1, 17)));
  assert.equal(formatTripDate('2027-02-17', 'ar'), arabicExpected);
});

test('local lookup normalizes case, accents, Arabic marks/digits and spacing without altering displayed records', () => {
  const arabic = { ...booking('MK-123456'), hotelName: 'فُـنْدُق مَكّة ١٢٣' };
  const latin = { ...booking('Reservation-ABC-789', '2027-03-01', '2027-03-03'), hotelName: 'Café  Grand Hôtel' };
  const model = buildTripsModel([arabic, latin], today);
  const references = query => filterTrips(model, 'all', query).map(row => row.booking.reference);
  for (const query of ['فندق مكة', 'فُنْدق  مَكّة', 'مكة ۱۲۳', 'مكة 123', '  MK-١٢٣٤٥٦  ', 'k-۱۲۳']) {
    assert.deepEqual(references(query), ['MK-123456'], query);
  }
  for (const query of ['  CAFE grand  ', 'café', 'HOTEL', 'reservation-abc-۷۸۹', 'abc-789']) {
    assert.deepEqual(references(query), ['Reservation-ABC-789'], query);
  }
  assert.equal(model.rows[0].booking.hotelName, 'فُـنْدُق مَكّة ١٢٣');
  assert.equal(model.rows[1].booking.hotelName, 'Café  Grand Hôtel');
  assert.equal(model.rows[1].booking.reference, 'Reservation-ABC-789');
});

test('lookup combines with the date filter, treats user input literally and leaves bucket counts unchanged', () => {
  const shared = [booking('same-current'), booking('same-future', '2027-03-01', '2027-03-03')];
  const model = buildTripsModel(shared, today);
  assert.deepEqual(filterTrips(model, 'current', 'same').map(row => row.booking.reference), ['same-current']);
  assert.deepEqual(filterTrips(model, 'upcoming', 'same').map(row => row.booking.reference), ['same-future']);
  assert.equal(filterTrips(model, 'past', 'same').length, 0);
  for (const query of ['no match', '.*', '(same', '[', 'hotel$']) assert.deepEqual(filterTrips(model, 'all', query), []);
  assert.equal(filterTrips(model, 'all', ' \n\t '), model.rows);
  assert.deepEqual(model.counts, { all: 2, current: 1, upcoming: 1, past: 0, unknown: 0 });
  const literal = buildTripsModel([{ ...booking('REF.*[123]'), hotelName: null }], today);
  assert.equal(filterTrips(literal, 'all', '.*[').length, 1);
});
