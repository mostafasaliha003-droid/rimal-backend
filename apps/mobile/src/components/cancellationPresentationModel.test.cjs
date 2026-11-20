/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  if (full.endsWith('.json')) return JSON.parse(fs.readFileSync(full, 'utf8'));
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = name => name.startsWith('.')
    ? load(path.resolve(path.dirname(full), path.extname(name) ? name : `${name}.ts`)) : require(name);
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
const { presentCancellation, parseCancellationTimestamp, cancellationMoneyText, futureCancellationBoundaries } = load('./cancellationPresentationModel.ts');
const before = '2027-02-15T12:00:00.123Z', boundary = '2027-02-16T12:00:00.123Z', later = '2027-02-18T12:00:00.123Z';
const now = Date.parse(before), at = Date.parse(boundary);
const period = (startAt, endAt, amount = '0.00', currency = 'USD') => ({ startAt, endAt, amount, currency });
const source = (policies, freeUntil = null, patch = {}) => ({ freeUntil, policies, ...patch });

test('explorer offers chronological future supplier boundaries, including uncovered times and exact touching cutoffs', () => {
  const end=Date.parse(later);
  const supplied=source([period(boundary,later,'4.5000','KWD'), period(null,boundary,'0','KWD')]);
  const live=presentCancellation(supplied,now);
  assert.deepEqual(futureCancellationBoundaries(live,now),[at,end]);
  assert.equal(presentCancellation(supplied,at).fee.amount,'4.5000');
  assert.equal(presentCancellation(supplied,end).reason,'gap');
  assert.equal(live.kind,'free');
  assert.deepEqual(futureCancellationBoundaries(presentCancellation(supplied,at),at),[end]);
  assert.deepEqual(futureCancellationBoundaries(presentCancellation(supplied,end),end),[]);
  const futureOnly=source([period(boundary,null,'1')]);
  assert.deepEqual(futureCancellationBoundaries(presentCancellation(futureOnly,now),now),[at]);
});

test('explorer never offers speculative times for ambiguous, advisory or unlimited schedules', () => {
  for(const supplied of [source([],boundary),source([period(null,null,'1')]),source([period(null,boundary),period(null,later)]),
    source([period(null,boundary),period(boundary,null,'8','JPY')]),source([period(null,'bad')])]) {
    assert.deepEqual(futureCancellationBoundaries(presentCancellation(supplied,now),now),[]);
  }
  assert.deepEqual(futureCancellationBoundaries(presentCancellation(source([]),NaN),NaN),[]);
});

test('timestamps are exact UTC instants with strict calendar, clock, offset and millisecond precision validation', () => {
  const expected = Date.UTC(2027, 1, 16, 12, 0, 0, 123);
  for (const value of [boundary, '2027-02-16T12:00:00.123', '2027-02-16T16:00:00.123+04:00', '2027-02-16T04:00:00.123-08:00']) {
    assert.equal(parseCancellationTimestamp(value), expected, value);
  }
  assert.equal(parseCancellationTimestamp('2027-02-16T12:00'), Date.UTC(2027, 1, 16, 12));
  assert.equal(parseCancellationTimestamp('2032-02-29T00:00:00Z'), Date.UTC(2032, 1, 29));
  for (const value of [null, '', '2027-02-16', '2027-02-29T12:00Z', '2027-02-30T12:00Z',
    '2027-02-16T24:00Z', '2027-02-16T12:60Z', '2027-02-16T12:00:60Z', '2027-02-16T12:00:00.1234Z',
    '2027-02-16T12:00+24:00', '2027-02-16T12:00+01:60', ' 2027-02-16T12:00Z', '2027-2-16T12:00Z']) {
    assert.equal(parseCancellationTimestamp(value), null, String(value));
  }
});

test('one explicit valid active zero interval supports free now with its original amount and currency', () => {
  const view = presentCancellation(source([period(null, boundary), period(boundary, null, '107.00')], boundary), now);
  assert.equal(view.kind, 'free'); assert.deepEqual(view.fee, { amount: '0.00', currency: 'USD' });
  assert.equal(view.freeUntil, boundary); assert.equal(view.deadlineState, 'future');
  assert.equal(view.nextTransitionAt, at); assert.equal(view.reason, null);
  assert.deepEqual(view.periods.map(row => row.active), [true, false]);
});

test('active charges preserve exact source precision and currency without rounding tiny positive fees to free', () => {
  for (const amount of ['0.0001', '0.000000000000000001', '00107.5000', '0.010']) {
    const view = presentCancellation(source([period(null, null, amount, 'KWD')]), now);
    assert.equal(view.kind, 'fee'); assert.deepEqual(view.fee, { amount, currency: 'KWD' });
    assert.equal(cancellationMoneyText(view.fee), `KWD ${amount.replace(/^0+(?=\d)/, "")}`, "precision kept, leading zeros dropped");
  }
  assert.equal(cancellationMoneyText({ amount: '0.0000', currency: 'USD' }), 'USD 0.0000');
});

test('a deadline alone remains advisory in the future or past and never manufactures a zero fee', () => {
  for (const [deadline, deadlineState] of [[boundary, 'future'], [before, 'elapsed'], [null, 'none']]) {
    const view = presentCancellation(source([], deadline), now);
    assert.equal(view.kind, 'unknown'); assert.equal(view.fee, null); assert.equal(view.reason, 'missing');
    assert.equal(view.deadlineState, deadlineState); assert.equal(view.freeUntil, deadline);
  }
  assert.equal(presentCancellation(source([], boundary), now).nextTransitionAt, at);
});

test('interval starts are inclusive and ends exclusive at the exact supplier millisecond', () => {
  const input = source([period(null, boundary), period(boundary, null, '107.00')], boundary);
  assert.equal(presentCancellation(input, at - 1).kind, 'free');
  const on = presentCancellation(input, at);
  assert.equal(on.kind, 'fee'); assert.equal(on.fee.amount, '107.00'); assert.equal(on.deadlineState, 'elapsed');
  assert.deepEqual(on.periods.map(row => row.active), [false, true]); assert.equal(on.nextTransitionAt, null);
  assert.equal(presentCancellation(input, at + 1).kind, 'fee');
});

test('gaps are unknown even beside an explicit free deadline, while the next real boundary remains available', () => {
  const input = source([period(null, before), period(boundary, null, '107')], boundary);
  const view = presentCancellation(input, now + 1);
  assert.equal(view.kind, 'unknown'); assert.equal(view.reason, 'gap'); assert.equal(view.fee, null);
  assert.equal(view.nextTransitionAt, at);
  assert.equal(presentCancellation(source([period(boundary, later, '4')]), now).reason, 'gap');
  assert.equal(presentCancellation(source([period(boundary, later, '4')]), Date.parse(later)).reason, 'gap');
});

test('explicit null bounds are unbounded, but missing or marked-invalid bounds never become all-times', () => {
  const all = presentCancellation(source([period(null, null, '4.50', 'EUR')]), now);
  assert.equal(all.kind, 'fee'); assert.equal(all.periods[0].active, true); assert.equal(all.nextTransitionAt, null);
  for (const patch of [{ startAt: undefined }, { endAt: undefined }, { startAt: 'bad' },
    { startInvalid: true }, { endInvalid: true }]) {
    const view = presentCancellation(source([{ ...period(null, null), ...patch }]), now);
    assert.equal(view.kind, 'unknown'); assert.equal(view.reason, 'invalid_period');
    assert.equal(view.periods[0].active, null); assert.equal(view.periods[0].issue, 'bounds');
  }
});

test('unknown amounts/currencies and malformed ranges fail closed without coercing a missing value to zero', () => {
  for (const amount of [null, undefined, '', ' ', '-1', '1e2', 'Infinity', 'NaN', '0x0', true, 0, '1'.repeat(129)]) {
    const view = presentCancellation(source([{ ...period(null, null), amount }]), now);
    assert.equal(view.kind, 'unknown', String(amount)); assert.equal(view.fee, null);
    assert.equal(cancellationMoneyText({ amount, currency: 'USD' }), null);
  }
  for (const currency of [null, undefined, '', 'usd', 'US', 'USDD', true]) {
    const view = presentCancellation(source([{ ...period(null, null, '0'), currency }]), now);
    assert.equal(view.kind, 'unknown'); assert.equal(view.fee, null);
  }
  for (const bounds of [[boundary, before], [boundary, boundary]]) {
    const view = presentCancellation(source([period(...bounds)]), now);
    assert.equal(view.kind, 'unknown'); assert.equal(view.periods[0].issue, 'range'); assert.equal(view.periods[0].active, null);
  }
  const futureUnknown = presentCancellation(source([period(null, boundary), period(boundary, null, null)]), now);
  assert.equal(futureUnknown.kind, 'unknown', 'An unreadable supplied interval cannot silently be ignored');
});

test('overlaps remain unknown even for identical zero fees, while touching periods do not overlap', () => {
  for (const policies of [[period(null, boundary), period(before, null)], [period(null, null), period(null, null)],
    [period(boundary, later), period(boundary, later)]]) {
    const view = presentCancellation(source(policies), now);
    assert.equal(view.kind, 'unknown'); assert.equal(view.reason, 'overlap'); assert.equal(view.periods.length, 2);
  }
  const adjacent = presentCancellation(source([period(null, boundary), period(boundary, null)]), now);
  assert.equal(adjacent.kind, 'free');
});

test('different policy currencies are ambiguous and no customer/display currency is substituted', () => {
  const mixed = presentCancellation(source([period(null, boundary, '0', 'USD'), period(boundary, null, '20', 'EUR')]), now);
  assert.equal(mixed.kind, 'unknown'); assert.equal(mixed.reason, 'currency_conflict');
  const input = { ...source([period(null, null, '20.00', 'USD')]), customerCurrency: 'AED', customerAmount: '73.40' };
  assert.deepEqual(presentCancellation(input, now).fee, { amount: '20.00', currency: 'USD' });
});

test('free-deadline contradictions and invalid deadline flags never promise a free current charge', () => {
  const futureCharge = presentCancellation(source([period(null, null, '20')], boundary), now);
  assert.equal(futureCharge.kind, 'unknown'); assert.equal(futureCharge.reason, 'deadline_conflict');
  const zeroAfterDeadline = presentCancellation(source([period(null, null)], before), at);
  assert.equal(zeroAfterDeadline.kind, 'unknown'); assert.equal(zeroAfterDeadline.reason, 'deadline_conflict');
  for (const input of [source([period(null, null)], 'not-a-time'), source([period(null, null)], boundary, { freeUntilInvalid: true })]) {
    const view = presentCancellation(input, now);
    assert.equal(view.kind, 'unknown'); assert.equal(view.deadlineState, 'invalid'); assert.equal(view.freeUntil, null);
  }
});

test('opaque schedules and invalid clocks remain unknown, with no empty-state non-refundable inference', () => {
  for (const input of [null, {}, source(null), source([period(null, null)], null, { incomplete: true }), source([null])]) {
    const view = presentCancellation(input, now); assert.equal(view.kind, 'unknown'); assert.equal(view.fee, null);
  }
  for (const invalidNow of [NaN, Infinity, -Infinity]) {
    const view = presentCancellation(source([period(null, null)]), invalidNow);
    assert.equal(view.kind, 'unknown'); assert.equal(view.reason, 'invalid_now'); assert.equal(view.nextTransitionAt, null);
  }
});

test('all source periods retain order, timestamp and decimal spelling without mutating caller objects', () => {
  const first = Object.freeze(period(boundary, null, '00107.0000'));
  const second = Object.freeze(period(null, '2027-02-16T16:00:00.123+04:00', '000.000'));
  const policies = Object.freeze([first, second]);
  const input = Object.freeze(source(policies, boundary));
  const view = presentCancellation(input, now);
  assert.equal(view.kind, 'free'); assert.deepEqual(view.periods.map(row => row.index), [0, 1]);
  assert.equal(view.periods[1].endAt, '2027-02-16T16:00:00.123+04:00');
  assert.equal(view.periods[1].amount, '000.000'); assert.equal(view.periods[0].amount, '00107.0000');
  assert.equal(Object.isFrozen(view), true); assert.equal(Object.isFrozen(view.periods), true);
  assert.equal(Object.isFrozen(view.periods[0]), true); assert.equal(Object.isFrozen(view.fee), true);
  assert.deepEqual(input.policies, [first, second]);
});

test('next transition is the earliest strictly-future start/end/deadline, even for an unknown schedule', () => {
  const view = presentCancellation(source([period(before, boundary), period(later, null, '5')], boundary), now);
  assert.equal(view.nextTransitionAt, at);
  const gap = presentCancellation(source([period(before, boundary), period(later, null, '5')]), at);
  assert.equal(gap.kind, 'unknown'); assert.equal(gap.nextTransitionAt, Date.parse(later));
  assert.equal(presentCancellation(source([period(null, boundary)]), at).nextTransitionAt, null);
});
