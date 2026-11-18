/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { buildRoomChoices, roomMealFacets, compareRoomAmounts, roomHotelId, canReviewRoomOffer, roomMealLabel } = load(path.join(__dirname, 'roomChoiceModel.ts'));
const offer = (index, change = {}) => ({ id: `offer-${index}`, name: 'Twin room', bookHash: `h-${index}`, roomIdentity: 'full-identity',
  offerContext: `signed-${index}`, price: { amount: String(60 + index), currency: 'USD' }, meal: 'nomeal', images: [`https://example.test/${index}.jpg`],
  taxes: [{ name: 'city_tax', amount: '0', currency_code: 'USD', included_by_supplier: false }],
  cancellation: { freeUntil: null, policies: [{ startAt: null, endAt: null, amount: '0', currency: 'USD' }] }, ...change });
const choices = (offers, options = {}) => buildRoomChoices(offers, { currency: 'USD', ...options });

test('rate summaries use confirmed payment and bed, exact source totals and individual property currencies', () => {
  const { normalizeOffers } = load(path.join(__dirname, '../api/adapters.ts'));
  const { roomRateFacts } = load(path.join(__dirname, 'roomRateFacts.ts'));
  const base = { room_name: 'Twin', book_hash: 'h-room', customer_display_amount: '136.0001', customer_display_currency: 'USD', meal: 'nomeal' };
  const taxes = ['EUR', 'AED'].map(currency_code => ({ name: 'city_tax', currency_code, amount: '0.0123', included_by_supplier: false }));
  const [prepaid, unconfirmed] = normalizeOffers([
    { ...base, room_data_trans: { bedding_type: '2 single beds' }, payment_options: { payment_types: [{ type: 'deposit', tax_data: { taxes } }] } },
    { ...base, room_data_trans: { bedding_type: 2 }, payment_options: { payment_types: [{ type: 'hotel', tax_data: { taxes } }] } },
  ]);
  const facts = roomRateFacts(prepaid, 'en', 0), missing = roomRateFacts(unconfirmed, 'ar', 0);
  assert.equal(facts.price, 'USD 136.0001');
  assert.equal(facts.bedding, '2 single beds');
  assert.equal(facts.meal, 'Room only');
  assert.equal(facts.payment, 'Through Mkhadda');
  assert.equal(facts.fees, 'EUR 0.0123 + AED 0.0123');
  assert.equal(missing.bedding, 'غير محدد');
  assert.equal(missing.payment, 'غير محدد');
  assert.equal(missing.fees, 'الرسوم غير محددة');
});

test('visible cancellation summary stops at the verified free interval even with a later advisory deadline', () => {
  const { roomRateFacts } = load(path.join(__dirname, 'roomRateFacts.ts'));
  const firstEnd = '2030-01-01T12:00:00Z', lastEnd = '2030-01-01T15:00:00Z';
  const rate = offer(0, { cancellation: { freeUntil: lastEnd, policies: [
    { startAt: null, endAt: firstEnd, amount: '0', currency: 'USD' },
    { startAt: lastEnd, endAt: null, amount: '37.01', currency: 'USD' },
  ] } });
  assert.match(roomRateFacts(rate, 'en', Date.parse(firstEnd) - 1).cancellation, /12:00.*UTC/);
  assert.equal(roomRateFacts(rate, 'en', Date.parse(firstEnd)).cancellation, 'Not specified');
  assert.equal(roomRateFacts(rate, 'en', Date.parse(lastEnd)).cancellation, 'Fee now · USD 37.01');
});

test('the comparison detects different future penalties and tax lines even when visible summaries agree', () => {
  const { roomFactKeys, roomRateFacts } = load(path.join(__dirname, 'roomRateFacts.ts'));
  const edge = '2030-01-01T12:00:00Z', now = Date.parse(edge) - 1;
  const variant = (charge, taxName, price) => offer(0, { price: { currency: 'USD', amount: price },
    taxes: [{ name: taxName, currency_code: 'USD', amount: '6', included_by_supplier: false }],
    cancellation: { freeUntil: edge, policies: [
      { startAt: null, endAt: edge, amount: '0', currency: 'USD' },
      { startAt: edge, endAt: null, amount: charge, currency: 'USD' },
    ] } });
  const a = variant('20', 'city_tax', '70'), b = variant('40', 'service_fee', '70.00');
  assert.equal(roomRateFacts(a,'en',now).cancellation, roomRateFacts(b,'en',now).cancellation);
  assert.equal(roomRateFacts(a,'en',now).fees, roomRateFacts(b,'en',now).fees);
  assert.equal(roomFactKeys(a).price, roomFactKeys(b).price);
  assert.notEqual(roomFactKeys(a).cancellation, roomFactKeys(b).cancellation);
  assert.notEqual(roomFactKeys(a).fees, roomFactKeys(b).fees);
});

test('stay summary uses English quantity nouns and explicit Arabic quantity labels', () => {
  const { roomChoiceCopy } = load(path.join(__dirname, 'roomChoiceCopy.ts'));
  assert.equal(roomChoiceCopy('en').staySummary(1, 1), '1 guest · 1 room');
  assert.equal(roomChoiceCopy('en').staySummary(2, 2), '2 guests · 2 rooms');
  assert.equal(roomChoiceCopy('ar').staySummary(2, 1), 'الضيوف: 2 · الغرف: 1');
});

test('free filter keeps the original offer, intersects other filters, and expires exactly at the boundary', () => {
  const end = '2027-02-15T12:00:00.000Z', cutoff = Date.parse(end);
  const free = offer(2, { meal: 'breakfast', cancellation: { freeUntil: end, policies: [
    { startAt: null, endAt: end, amount: '0.00', currency: 'EUR' },
    { startAt: end, endAt: null, amount: '0.0001', currency: 'EUR' },
  ] } });
  const paid = offer(0, { cancellation: { freeUntil: null, policies: [{ startAt: null, endAt: null, amount: '1', currency: 'USD' }] } });
  const advisory = offer(1, { cancellation: { freeUntil: end, policies: [] } });
  const rates = [paid, advisory, free], options = { freeOnly: true, now: cutoff - 1 };
  const all = choices(rates, { now: cutoff - 1 });
  assert.equal(all.groups[0].freeNowCount, 1);
  assert.equal(all.fromPrice, paid.price);
  const filtered = choices(rates, options);
  assert.equal(filtered.groups[0].entries[0].offer, free);
  assert.equal(filtered.fromPrice, free.price);
  assert.equal(filtered.matchingOffers, 1);
  assert.equal(choices(rates, { ...options, meal: { kind: 'value', value: 'nomeal' } }).matchingOffers, 0);
  assert.equal(choices(rates, { ...options, now: cutoff }).matchingOffers, 0);
});

test('review requires the requested currency while foreign and unknown prices remain in the chooser', () => {
  const own = offer(0), foreign = offer(1, { price: { amount: '7.25', currency: 'EUR' } }), unknown = offer(2, { price: null });
  const before = JSON.stringify([own, foreign, unknown]);
  assert.equal(canReviewRoomOffer(own, 'USD'), true);
  assert.equal(canReviewRoomOffer(foreign, 'USD'), false);
  assert.equal(canReviewRoomOffer(foreign, 'EUR'), true);
  assert.equal(canReviewRoomOffer(unknown, 'USD'), false);
  assert.equal(canReviewRoomOffer(offer(3, { offerContext: undefined }), 'USD'), false);
  assert.equal(canReviewRoomOffer(offer(4, { bookHash: 'p-4' }), 'USD'), false);
  assert.deepEqual(choices([own, foreign, unknown]).groups.flatMap(group => group.entries.map(entry => entry.offer)), [own, foreign, unknown]);
  assert.equal(JSON.stringify([own, foreign, unknown]), before);
});

test('known room-only labels localize, other supplied meals only humanize separators, and facets retain exact tokens', () => {
  assert.equal(roomMealLabel('nomeal', 'بدون وجبات', 'غير واردة'), 'بدون وجبات');
  assert.equal(roomMealLabel('full_board-plus', 'Room only', 'Not supplied'), 'full board plus');
  assert.equal(roomMealLabel('Breakfast', 'Room only', 'Not supplied'), 'Breakfast');
  assert.equal(roomMealLabel(undefined, 'Room only', 'Not supplied'), 'Not supplied');
  assert.equal(roomMealLabel(' ', 'Room only', 'Not supplied'), 'Not supplied');
  const rates = [offer(0, { meal: 'nomeal' }), offer(1, { meal: 'full_board-plus' }), offer(2, { meal: 'full board plus' })];
  assert.deepEqual(roomMealFacets(rates).values, ['nomeal', 'full_board-plus', 'full board plus']);
  assert.equal(choices(rates, { meal: { kind: 'value', value: 'full_board-plus' } }).matchingOffers, 1);
});

test('known meal codes use the same translation in room selection and offer comparison', () => {
  const label = (token, lang) => roomMealLabel(token, 'Room only', 'Not supplied', lang);
  assert.equal(label('breakfast', 'ar'), 'الإفطار');
  assert.equal(label('continental_breakfast', 'ar'), 'إفطار كونتيننتال');
  assert.equal(label('breakfast', 'en'), 'Breakfast');
  assert.equal(label('breakfast', 'es'), 'Desayuno');
  assert.equal(label('hotel_custom-plan', 'ar'), 'hotel custom plan');
  assert.equal(label('cash', 'ar'), 'cash');
  const rate = offer(1, { meal: 'continental_breakfast' });
  assert.deepEqual(choices([rate]).meals.values, ['continental_breakfast']);
  assert.equal(rate.meal, 'continental_breakfast');
});

test('grouping retains all27 rate occurrences, hashes, prices and original object references without mutation', () => {
  const offers = Array.from({ length: 27 }, (_, index) => offer(index, { meal: index % 2 ? 'breakfast' : 'nomeal' }));
  const before = JSON.stringify(offers);
  const grouped = choices(offers);
  assert.equal(grouped.groups.length, 1); assert.equal(grouped.matchingOffers, 27);
  assert.deepEqual(grouped.groups[0].entries.map(entry => entry.offer), offers);
  grouped.groups[0].entries.forEach((entry, index) => assert.equal(entry.offer, offers[index]));
  assert.equal(new Set(grouped.groups[0].entries.map(entry => entry.key)).size, 27);
  assert.equal(JSON.stringify(offers), before);
});

test('only exact full identities group; missing/blank classification and repeated hashes remain separate occurrences', () => {
  const offers = [offer(0), offer(1, { roomIdentity: 'FULL-identity' }), offer(2, { roomIdentity: 'full-identity ' }),
    offer(3, { roomIdentity: undefined }), offer(4, { roomIdentity: undefined }), offer(5, { roomIdentity: '' }), offer(6, { roomIdentity: '  ' }), offer(0)];
  const model = choices(offers);
  assert.equal(model.groups.length, 7);
  assert.equal(model.groups[0].entries.length, 2);
  assert.notEqual(model.groups[0].entries[0].key, model.groups[0].entries[1].key);
  assert.equal(model.groups.filter(group => group.identity === null).length, 4);
});

test('room query and exact supplied meal facet strictly intersect and unknown meals do not become breakfast/room-only', () => {
  const offers = [offer(0, { name: 'King Suite', meal: 'breakfast' }), offer(1, { name: 'Twin Suite', meal: 'Breakfast' }),
    offer(2, { name: 'King room', meal: 'nomeal' }), offer(3, { name: 'King Suite', meal: undefined })];
  assert.deepEqual(roomMealFacets(offers), { values: ['breakfast', 'Breakfast', 'nomeal'], hasMissing: true });
  const filtered = choices(offers, { query: ' KING ', meal: { kind: 'value', value: 'breakfast' } });
  assert.deepEqual(filtered.groups.flatMap(group => group.entries.map(entry => entry.index)), [0]);
  assert.deepEqual(choices(offers, { query: 'suite', meal: { kind: 'missing' } }).groups.flatMap(group => group.entries.map(entry => entry.index)), [3]);
  assert.equal(choices(offers, { query: 'king', meal: { kind: 'value', value: 'Breakfast' } }).matchingOffers, 0);
  assert.equal(choices(offers, { query: 'King Suite', meal: { kind: 'value', value: 'Breakfast included' } }).matchingOffers, 0);
});

test('price sort compares only requested currency, preserves zero/ties, keeps unknown/mixed values last and never converts', () => {
  const offers = [offer(0, { price: null }), offer(1, { price: { amount: '1', currency: 'AED' } }),
    offer(2, { price: { amount: '60', currency: 'USD' } }), offer(3, { price: { amount: '0.000', currency: 'USD' } }),
    offer(4, { price: { amount: '60.00', currency: 'USD' } }), offer(5, { price: { amount: '1e-5', currency: 'USD' } })];
  const model = choices(offers, { sort: 'price' });
  assert.deepEqual(model.groups[0].entries.map(entry => entry.index), [3, 2, 4, 0, 1, 5]);
  assert.equal(model.fromPrice, offers[3].price);
  assert.equal(choices([offers[1]], { sort: 'price' }).fromPrice, null);
  assert.deepEqual(choices(offers).groups[0].entries.map(entry => entry.index), [0, 1, 2, 3, 4, 5]);
});

test('from price is computed only over matching offers and group/order counts remain clear', () => {
  const offers = [offer(0, { meal: 'nomeal', price: { amount: '1', currency: 'USD' } }),
    offer(1, { meal: 'breakfast', price: { amount: '70', currency: 'USD' } }),
    offer(2, { roomIdentity: 'another', meal: 'breakfast', price: { amount: '65', currency: 'USD' } })];
  const model = choices(offers, { sort: 'price', meal: { kind: 'value', value: 'breakfast' } });
  assert.equal(model.fromPrice.amount, '65'); assert.equal(model.totalOffers, 3); assert.equal(model.matchingOffers, 2);
  assert.equal(model.totalGroups, 2); assert.deepEqual(model.groups.map(group => group.identity), ['another', 'full-identity']);
  assert.equal(model.groups[1].totalCount, 2); assert.equal(model.groups[1].entries.length, 1);
});

test('lowest reviewable rate keeps the exact occurrence even beyond the first two pages', () => {
  const rates = Array.from({ length: 10 }, (_, index) => offer(index));
  // The last two entries have identical public IDs/hashes and equivalent prices.
  rates[8] = offer(8, { price: { amount: '0005.40000', currency: 'USD' }, meal: 'breakfast' });
  rates[9] = { ...rates[8], price: { amount: '5.4', currency: 'USD' }, offerContext: 'other-terms', meal: 'nomeal' };
  const before = JSON.stringify(rates);
  for (const sort of ['original', 'price']) {
    const group = choices(rates, { sort }).groups[0];
    assert.equal(group.lowestReviewable, group.entries.find(entry => entry.index === 8));
    assert.equal(group.lowestReviewable.offer, rates[8]);
    assert.equal(group.lowestReviewable.offer.offerContext, 'signed-8');
    assert.equal(group.entries.length, rates.length);
  }
  assert.deepEqual(choices(rates).groups[0].entries.map(entry => entry.offer), rates);
  assert.equal(JSON.stringify(rates), before);
});

test('room shortcut distinguishes a lower displayed price from a reviewable price in the requested currency', () => {
  const rates = [
    offer(0, { price: { amount: '0', currency: 'USD' }, offerContext: undefined }),
    offer(1, { price: { amount: '0.01', currency: 'USD' }, bookHash: 'p-1' }),
    offer(2, { price: { amount: '0.02', currency: 'AED' } }),
    offer(3, { price: null }),
    offer(4, { price: { amount: '9007199254740992.0000002', currency: 'USD' } }),
    offer(5, { price: { amount: '9007199254740992.0000001', currency: 'USD' } }),
  ];
  for (const sort of ['original', 'price']) {
    const group = choices(rates, { sort }).groups[0];
    assert.equal(group.fromPrice, rates[0].price);
    assert.equal(group.lowestReviewable.offer, rates[5]);
    assert.equal(choices(rates, { sort, currency: 'AED' }).groups[0].lowestReviewable.offer, rates[2]);
    assert.equal(choices(rates.slice(0, 4), { sort }).groups[0].lowestReviewable, null);
  }
  const zero = offer(6, { price: { amount: '0.0000', currency: 'USD' } });
  assert.equal(choices([...rates, zero]).groups[0].lowestReviewable.offer, zero);
});

test('the featured rate comes only from the matching room, meal and currently free cancellation terms', () => {
  const end = '2027-02-15T12:00:00.000Z', cutoff = Date.parse(end);
  const strict = { freeUntil: null, policies: [{ startAt: null, endAt: null, amount: '4', currency: 'USD' }] };
  const temporary = { freeUntil: end, policies: [
    { startAt: null, endAt: end, amount: '0', currency: 'USD' },
    { startAt: end, endAt: null, amount: '10', currency: 'USD' },
  ] };
  const offers = [offer(0, { name: 'Suite', meal: 'breakfast', cancellation: strict }),
    offer(1, { name: 'Suite', meal: 'nomeal' }), offer(2, { name: 'Suite', meal: 'breakfast', cancellation: temporary }),
    offer(3, { name: 'Suite', meal: 'breakfast' }), offer(4, { name: 'Twin', meal: 'breakfast', roomIdentity: 'twin' })];
  const options = { meal: { kind: 'value', value: 'breakfast' }, freeOnly: true, now: cutoff - 1 };
  const groups = choices(offers, options).groups;
  assert.deepEqual(groups.map(group => group.lowestReviewable.offer), [offers[2], offers[4]]);
  assert.equal(choices(offers, { ...options, freeOnly: false }).groups[0].lowestReviewable.offer, offers[0]);
  const later = choices(offers, { ...options, query: 'suite', now: cutoff });
  assert.equal(later.groups.length, 1);
  assert.equal(later.groups[0].lowestReviewable.offer, offers[3]);
  assert.equal(choices(offers, { ...options, query: 'missing' }).groups.length, 0);
});

test('decimal comparison avoids floating-point precision errors and rejects malformed amounts', () => {
  assert.equal(Math.sign(compareRoomAmounts('9007199254740993', '9007199254740992')), 1);
  assert.equal(compareRoomAmounts('0001.200', '1.2'), 0);
  assert.equal(Math.sign(compareRoomAmounts('2.09', '2.1')), -1);
  for (const value of ['-1', '1e2', '', 'NaN', ' 3']) assert.throws(() => compareRoomAmounts(value, '1'));
});

test('empty states recover losslessly and invalid hotel route values never become a loading request', () => {
  const offers = [offer(0), offer(1)];
  assert.equal(choices(offers, { query: 'missing' }).groups.length, 0);
  assert.equal(choices(offers).matchingOffers, 2);
  assert.equal(choices([]).fromPrice, null);
  assert.equal(roomHotelId('10004834'), 10004834);
  for (const value of [undefined, null, [], ['100'], '0', '-1', '1e2', '1.2', ' 100', '001', '10000000000']) assert.equal(roomHotelId(value), null);
});
