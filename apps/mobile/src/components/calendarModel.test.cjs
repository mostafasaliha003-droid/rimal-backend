const test=require('node:test'); const assert=require('node:assert/strict'); const {validDate,addDays,monthDays,shiftMonth}=require('./calendarModel.ts');
const { beginCalendarRange, calendarRangeBounds, calendarRangeMonth, pickCalendarDate } = require('./calendarModel.ts');
test('calendar validates actual dates and keeps calendar arithmetic independent of timezone',()=>{assert.equal(validDate('2027-02-29'),false);assert.equal(validDate('2028-02-29'),true);assert.equal(addDays('2028-02-28',1),'2028-02-29');assert.equal(addDays('2027-12-31',1),'2028-01-01');assert.equal(addDays('bad',1),'');});
test('month navigation preserves every real day and never rolls an invalid day into another month',()=>{assert.equal(shiftMonth('2027-12',1),'2028-01');assert.equal(shiftMonth('2027-01',-1),'2026-12');assert.equal(monthDays('2027-02').filter(Boolean).length,28);assert.equal(monthDays('2028-02').filter(Boolean).length,29);assert.equal(monthDays('bad').length,0);});

const today = '2027-12-27';

test('picking arrival is tentative; departure completes an explicit multi-night pair across a year boundary', () => {
  const initial = Object.freeze(beginCalendarRange('checkin', '', '', today));
  const arrival = pickCalendarDate(initial, '2027-12-31', today);
  assert.equal(arrival.selection, null);
  assert.equal(arrival.draft.field, 'checkout');
  assert.equal(calendarRangeMonth(arrival.draft, today), '2028-01');
  assert.deepEqual(calendarRangeBounds(arrival.draft, today), { min: '2028-01-01', max: '2028-01-30' });
  assert.deepEqual(pickCalendarDate(arrival.draft, '2028-01-03', today).selection,
    { checkin: '2027-12-31', checkout: '2028-01-03' });
  assert.deepEqual(initial, { field: 'checkin', checkin: '', checkout: '' });
});

test('editing only departure opens on the current checkout and commits without changing arrival', () => {
  const initial = beginCalendarRange('checkout', '2027-12-29', '2028-01-02', today);
  assert.equal(initial.field, 'checkout');
  assert.equal(calendarRangeMonth(initial, today), '2028-01');
  assert.deepEqual(pickCalendarDate(initial, '2027-12-30', today).selection,
    { checkin: '2027-12-29', checkout: '2027-12-30' });
  for (const oldCheckout of ['', '2027-12-29', '2028-01-31', 'invalid']) {
    const normalized = beginCalendarRange('checkout', '2027-12-29', oldCheckout, today);
    assert.equal(normalized.checkout, '');
    assert.equal(normalized.field, 'checkout');
    assert.equal(calendarRangeMonth(normalized, today), '2027-12');
  }
});

test('empty, expired, impossible or out-of-horizon arrival restarts a departure edit at arrival', () => {
  for (const checkin of ['', '2027-12-26', '2028-02-30', addDays(today, 731)]) {
    const draft = beginCalendarRange('checkout', checkin, '2028-01-02', today);
    assert.deepEqual(draft, { field: 'checkin', checkin: '', checkout: '' });
    assert.equal(calendarRangeMonth(draft, today), '2027-12');
  }
});

test('arrival and departure limits include today, day 730 and nights 1 through 30', () => {
  const opened = beginCalendarRange('checkin', '', '', today);
  assert.equal(pickCalendarDate(opened, today, today).draft.field, 'checkout');
  for (const invalidArrival of [addDays(today, -1), addDays(today, 731), '2028-02-30']) {
    assert.deepEqual(pickCalendarDate(opened, invalidArrival, today), { draft: opened, selection: null });
  }
  const lastArrival = addDays(today, 730);
  const { draft } = pickCalendarDate(opened, lastArrival, today);
  for (const nights of [-1, 0, 31]) {
    const result = pickCalendarDate(draft, addDays(lastArrival, nights), today);
    assert.equal(result.draft, draft);
    assert.equal(result.selection, null);
  }
  for (const nights of [1, 30]) {
    const checkout = addDays(lastArrival, nights);
    assert.deepEqual(pickCalendarDate(draft, checkout, today).selection, { checkin: lastArrival, checkout });
  }
});

test('replacing an arrival discards the old departure from the pending range only, including leap day', () => {
  const existing = Object.freeze({ checkin: '2028-02-27', checkout: '2028-02-29' });
  const draft = Object.freeze(beginCalendarRange('checkin', existing.checkin, existing.checkout, today));
  assert.equal(calendarRangeMonth(draft, today), '2028-02');
  const changed = pickCalendarDate(draft, '2028-02-29', today);
  assert.deepEqual(changed, { draft: { field: 'checkout', checkin: '2028-02-29', checkout: '' }, selection: null });
  assert.equal(calendarRangeMonth(changed.draft, today), '2028-03');
  assert.deepEqual(existing, { checkin: '2028-02-27', checkout: '2028-02-29' });
  assert.deepEqual(beginCalendarRange('checkout', existing.checkin, existing.checkout, today),
    { field: 'checkout', ...existing });
});

test('an arrival that expired while the sheet was open must be chosen again', () => {
  const draft = beginCalendarRange('checkout', today, '2027-12-30', today);
  assert.deepEqual(pickCalendarDate(draft, '2027-12-31', '2027-12-28'),
    { draft: { field: 'checkin', checkin: '', checkout: '' }, selection: null });
});
