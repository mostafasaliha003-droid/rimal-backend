const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyResultFilters, copyResultFilters, compareDecimalAmounts, parseStayBudget, decideResults,
  priceInCurrency, activeResultFilters, stayNights, resultContextKey, beginResultRefresh, suggestedStayBudgets } = require('./resultsDecisionModel.ts');
const hotel = (hid, amount, stars = 4, name = `Hotel ${hid}`, currency = 'USD') => ({ hid, id: String(hid), name, stars, offers: [],
  price: amount === null ? null : { amount, currency } });

test('exact price ordering preserves decimal differences lost by floating-point arithmetic', () => {
  const hotels = [hotel(1, '9007199254740993'), hotel(2, '9007199254740992'), hotel(3, '0.10000000000000002'), hotel(4, '0.10000000000000001')];
  assert.deepEqual(decideResults(hotels, { ...emptyResultFilters(), sort: 'lowPrice' }, 'USD').hotels.map(h => h.hid), [4, 3, 2, 1]);
  assert.equal(compareDecimalAmounts('0010.5000', '10.5'), 0); assert.equal(compareDecimalAmounts('9.99', '10'), -1);
  assert.throws(() => compareDecimalAmounts('NaN', '1'));
});
test('unknown and wrong-currency prices remain last in both directions and are never treated as zero', () => {
  const hotels = [hotel(1, null), hotel(2, '5', 4, 'Other currency', 'AED'), hotel(3, '10'), hotel(4, '20')];
  assert.deepEqual(decideResults(hotels, { ...emptyResultFilters(), sort: 'lowPrice' }, 'USD').hotels.map(h => h.hid), [3, 4, 1, 2]);
  assert.deepEqual(decideResults(hotels, { ...emptyResultFilters(), sort: 'highPrice' }, 'USD').hotels.map(h => h.hid), [4, 3, 1, 2]);
  assert.equal(priceInCurrency({ amount: 'bad', currency: 'USD' }, 'USD'), null);
  assert.equal(priceInCurrency({ amount: '9'.repeat(309), currency: 'USD' }, 'USD'), null);
  assert.equal(priceInCurrency({ amount: '0'.repeat(129) + '1', currency: 'USD' }, 'USD'), null);
  assert.deepEqual(priceInCurrency({ amount: '0', currency: 'USD' }, 'USD'), { amount: '0', currency: 'USD' });
});
test('budget accepts both Arabic digit sets and genuine decimal/group separators without silently fixing invalid input', () => {
  for (const value of ['1,250.50', '١٬٢٥٠٫٥٠', '۱٬۲۵۰٫۵۰', ' 001250.500 ']) assert.deepEqual(parseStayBudget(value), { valid: true, amount: '1250.5' });
  assert.deepEqual(parseStayBudget(''), { valid: true, amount: null });
  for (const value of ['0', '-1', '1e3', '1,25', '1 2', '1.2.3', '١٫٢٫٣', '1234567890123', '1.1234567', 'Infinity']) assert.equal(parseStayBudget(value).valid, false, value);
});
test('budget uses the exact supplied full-stay amount and excludes unknown currencies only when active', () => {
  const hotels = [hotel(1, '100.000001'), hotel(2, '100'), hotel(3, null), hotel(4, '1', 4, 'Other', 'AED')];
  assert.equal(decideResults(hotels, emptyResultFilters(), 'USD').hotels.length, 4);
  assert.deepEqual(decideResults(hotels, { ...emptyResultFilters(), maxBudget: '١٠٠' }, 'USD').hotels.map(h => h.hid), [2]);
  assert.equal(decideResults(hotels, { ...emptyResultFilters(), maxBudget: 'invalid' }, 'USD').budget.valid, false);
});
test('multi-star facets count the name and budget intersection without applying their own selection', () => {
  const hotels = [hotel(1, '10', 3, 'Café Gulf'), hotel(2, '20', 4, 'Cafe Gulf'), hotel(3, '30', 5, 'Cafe Gulf'), hotel(4, '15', undefined, 'Cafe Gulf'), hotel(5, '5', 4, 'Different')];
  hotels[3].stars = undefined;
  const filters = { ...emptyResultFilters(), name: 'cafe', maxBudget: '25', stars: [3, 0] };
  const result = decideResults(hotels, filters, 'USD');
  assert.deepEqual(result.hotels.map(h => h.hid), [1, 4]); assert.deepEqual(result.facetCounts, [1, 0, 0, 1, 1, 0]);
  assert.equal(activeResultFilters(filters), 3);
});
test('supplier order and stable ties are retained and decisions never mutate hotel or filter objects', () => {
  const hotels = [hotel(2, '10.00'), hotel(1, '10')], filters = emptyResultFilters();
  const before = JSON.stringify(hotels); Object.freeze(hotels); Object.freeze(filters.stars); Object.freeze(filters);
  assert.deepEqual(decideResults(hotels, filters, 'USD').hotels.map(h => h.hid), [2, 1]);
  assert.deepEqual(decideResults(hotels, { ...filters, sort: 'highPrice' }, 'USD').hotels.map(h => h.hid), [2, 1]); assert.equal(JSON.stringify(hotels), before);
  const draft = copyResultFilters(filters); draft.stars.push(5); draft.name = 'new'; assert.deepEqual(filters, emptyResultFilters());
});
test('refresh retains prior cards only for the exact search, language and session revision', () => {
  const key = resultContextKey('Dubai/USD', 'ar', 'signedIn', 1), previous = { context: key, hotels: [hotel(1, '10')], pending: false, error: Error('old') };
  assert.equal(beginResultRefresh(previous, key).hotels, previous.hotels);
  assert.equal(beginResultRefresh(previous, key).pending, true); assert.equal(beginResultRefresh(previous, key).error, null);
  for (const other of [resultContextKey('Dubai/AED', 'ar', 'signedIn', 1), resultContextKey('Dubai/USD', 'en', 'signedIn', 1), resultContextKey('Dubai/USD', 'ar', 'signedOut', 1), resultContextKey('Dubai/USD', 'ar', 'signedIn', 2)]) assert.deepEqual(beginResultRefresh(previous, other).hotels, []);
});
test('stay context uses real dates and handles month/year boundaries without inventing a nightly price', () => {
  assert.equal(stayNights({ checkin: '2027-02-16', checkout: '2027-02-18' }), 2);
  assert.equal(stayNights({ checkin: '2026-12-31', checkout: '2027-01-02' }), 2);
  for (const dates of [null, { checkin: '2027-02-30', checkout: '2027-03-02' }, { checkin: '2027-02-18', checkout: '2027-02-16' }]) assert.equal(stayNights(dates), null);
});
test('budget shortcuts match returned prices, current name and stars, and the full-stay currency', () => {
  const hotels = [hotel(1, '10.00', 4, 'Café'), hotel(2, '10', 4, 'Cafe'), hotel(3, '30.125', 4, 'Cafe'), hotel(4, '100', 4, 'Cafe'),
    hotel(5, '2', 3, 'Cafe'), hotel(6, '3', 4, 'Elsewhere'), hotel(7, '4', 4, 'Cafe', 'AED'), hotel(8, null, 4, 'Cafe')];
  assert.deepEqual(suggestedStayBudgets(hotels, 'cafe', [4], 'USD'), ['10', '30.125']);
  assert.deepEqual(suggestedStayBudgets(hotels, '', [], 'EUR'), []);
  assert.deepEqual(suggestedStayBudgets([hotel(1, '0'), hotel(2, '1.0000001'), hotel(3, '1000000000000')], '', [], 'USD'), []);
  assert.deepEqual(suggestedStayBudgets([hotel(1, '10'), hotel(2, '10.0')], '', [], 'USD'), []);
});

test('the free cancellation filter keeps stays that offer it and the star sort puts the highest rating first', () => {
  const stay = (hid, amount, stars, freeCancellation) => ({ hid, id: String(hid), name: 'Hotel ' + hid, price: { amount, currency: 'USD' }, ...(stars ? { stars } : {}), ...(freeCancellation ? { freeCancellation } : {}) });
  const hotels = [stay(1, '100', 3, 'lowest'), stay(2, '90', 5, 'none'), stay(3, '80', 0, 'available'), stay(4, '70', 4)];
  const all = decideResults(hotels, emptyResultFilters(), 'USD');
  assert.equal(all.freeCancelCount, 2);
  assert.deepEqual(decideResults(hotels, { ...emptyResultFilters(), freeCancel: true }, 'USD').hotels.map(h => h.hid), [1, 3]);
  assert.deepEqual(decideResults(hotels, { ...emptyResultFilters(), sort: 'stars' }, 'USD').hotels.map(h => h.hid), [2, 4, 1, 3]);
  assert.equal(activeResultFilters({ ...emptyResultFilters(), freeCancel: true }), 1);
});

test('top picks come from listed hotels only: best value, top rated and lowest price, each once', () => {
  const { topPicks } = require('./resultsDecisionModel.ts');
  const stay = (hid, amount) => ({ hid, id: String(hid), name: 'Hotel ' + hid, price: { amount, currency: 'USD' } });
  const hotels = [stay(1, '300'), stay(2, '120'), stay(3, '200'), stay(4, '90'), stay(5, '150')];
  const ratings = new Map([[1, { score: 9.4, count: 50 }], [2, { score: 8.2, count: 40 }], [3, { score: 8.0, count: 2 }], [5, { score: 7.5, count: 30 }]]);
  assert.deepEqual(topPicks(hotels, 'USD', ratings).map(pick => [pick.kind, pick.hotel.hid]), [['value', 2], ['rated', 1], ['lowest', 4]]);
  assert.deepEqual(topPicks([stay(1, '100')], 'USD', ratings), []);
  assert.deepEqual(topPicks(hotels, 'USD', new Map()), []);
});
