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
  const module = { exports: {} }; cache.set(full, module);
  const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', source)(name => name.startsWith('.') ? load(path.resolve(path.dirname(full), `${name}.ts`)) : require(name), module, module.exports);
  return module.exports;
}
const { quickStayDates, stayNights, destinationFromSearch, destinationLookupName, resolveFeaturedCity, shouldSuggestDestination, recentSearchDraft } = load('./searchJourneyModel.ts');
const criteria = () => ({ checkin: '2027-02-16', checkout: '2027-02-18', residency: 'ae', guests: [{ adults: 2, children: [0, 17] }], currency: 'AED', regionId: 9650 });

test('quick stays use the local day near midnight and keep their explicit one/two-night spans', () => {
  const now = new Date(2026, 10, 17, 0, 15);
  assert.deepEqual(quickStayDates('tonight', now), { checkin: '2026-11-17', checkout: '2026-11-18' });
  assert.deepEqual(quickStayDates('tomorrow', now), { checkin: '2026-11-18', checkout: '2026-11-19' });
  assert.deepEqual(quickStayDates('nextWeek', now), { checkin: '2026-11-24', checkout: '2026-11-26' });
});
test('shortcuts cross year and leap-day boundaries without changing duration', () => {
  assert.deepEqual(quickStayDates('tomorrow', new Date(2026, 11, 31, 23, 30)), { checkin: '2027-01-01', checkout: '2027-01-02' });
  assert.deepEqual(quickStayDates('tonight', new Date(2028, 1, 28)), { checkin: '2028-02-28', checkout: '2028-02-29' });
  assert.deepEqual(quickStayDates('nextWeek', new Date(2028, 1, 22)), { checkin: '2028-02-29', checkout: '2028-03-02' });
});
test('nights are calendar nights and reject invalid/reversed/out-of-range stays', () => {
  assert.equal(stayNights('2027-03-13', '2027-03-15'), 2);
  assert.equal(stayNights('2027-02-01', '2027-03-03'), 30);
  for (const [a,b] of [['2027-02-29','2027-03-01'],['2027-03-02','2027-03-01'],['2027-03-01','2027-03-01'],['2027-02-01','2027-03-04'],['','']]) assert.equal(stayNights(a,b), null);
});
test('returning to an existing region/hotel search restores identity without another suggestion lookup', () => {
  const region = destinationFromSearch(criteria(), 'Dubai');
  assert.equal(region.regionId, 9650); assert.equal(shouldSuggestDestination('Dubai', region), false);
  const hotel = destinationFromSearch({ ...criteria(), regionId: undefined, hids: [10004834] }, 'Selected hotel');
  assert.equal(hotel.hid, 10004834); assert.equal(shouldSuggestDestination('Selected hotel', hotel), false);
  assert.equal(shouldSuggestDestination('Dubai Marina', region), true); assert.equal(shouldSuggestDestination('D', null), false);
});
test('ambiguous or missing destination identities cannot silently become a different search', () => {
  for (const value of [null, { ...criteria(), regionId: undefined }, { ...criteria(), hids: [1] }, { ...criteria(), regionId: undefined, hids: [1,2] }, { ...criteria(), regionId: -1 }]) assert.equal(destinationFromSearch(value, 'Dubai'), null);
  assert.equal(destinationFromSearch(criteria(), ''), null);
});
test('featured destination photos resolve only confirmed supplier city and country matches', () => {
  const region = (regionId, name, subtitle) => ({ id: 'region-' + regionId, type:'region', regionId, name, subtitle });
  const paris = region(12, 'Paris', 'France');
  const anotherParis = region(14, 'Paris', 'United States');
  assert.equal(resolveFeaturedCity('paris', [anotherParis, paris]), paris);
  assert.equal(resolveFeaturedCity('paris', [anotherParis]), null);
  assert.equal(resolveFeaturedCity('paris', [paris, region(13,'باريس','فرنسا')]), null);
  assert.equal(resolveFeaturedCity('paris', [region(12, 'Paris'), { id:'hotel-55', type:'hotel', name:'Paris', subtitle:'France', hid:55 }]), null);
  const istanbul = region(20, 'İstanbul', 'Türkiye');
  assert.equal(resolveFeaturedCity('istanbul', [istanbul]), istanbul);
  const dubai = region(6053839, 'Dubai');
  assert.equal(resolveFeaturedCity('dubai', [dubai]), dubai);
  assert.equal(resolveFeaturedCity('dubai', [region(1,'Dubai')]), null);
  assert.equal(resolveFeaturedCity('dubai', [region(6053839,'Dubai','France')]), null);
  assert.equal(destinationLookupName('اسطنبول'), 'Istanbul');
  assert.equal(destinationLookupName('  فندق في دبي  '), 'فندق في دبي');
});
test('a recent search restores editable fields by value without mutating frozen session records', () => {
  const original = criteria(); Object.freeze(original.guests[0].children); Object.freeze(original.guests[0]); Object.freeze(original.guests); Object.freeze(original);
  const recent = Object.freeze({ name: 'Dubai', criteria: original });
  const draft = recentSearchDraft(recent);
  assert.equal(draft.query, 'Dubai'); assert.equal(draft.currency, 'AED'); assert.equal(draft.residency, 'ae');
  assert.equal(draft.checkin, '2027-02-16'); assert.equal(draft.checkout, '2027-02-18');
  assert.notEqual(draft.guests, original.guests); assert.notEqual(draft.guests[0].children, original.guests[0].children);
  draft.guests[0].children[0] = 8; draft.guests.push({ adults: 1, children: [] });
  assert.deepEqual(original.guests, [{ adults: 2, children: [0,17] }]);
  assert.equal(shouldSuggestDestination(draft.query, draft.selected), false);
  assert.equal(recentSearchDraft({ name: 'Bad target', criteria: { ...criteria(), regionId: 0 } }), null);
});
