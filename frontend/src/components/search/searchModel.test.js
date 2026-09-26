import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGuests, normalizeSuggestions, parseSearchDate, validDestination, validateSearch } from './searchModel.js';

const destination = { label: 'Dubai', type: 'region', region_id: 6053839 };
const search = { query: 'Dubai', destination, checkin: '2099-10-15', checkout: '2099-10-17', guests: [{ adults: 2, children: [] }] };
const now = new Date(2026, 8, 26);

test('dates require a real calendar date in the exact input format', () => {
    for (const value of ['', null, 'invalid', '2099-02-29', '2099-10-15T00:00:00']) assert.equal(parseSearchDate(value), null);
    assert.equal(parseSearchDate('2096-02-29').getDate(), 29);
});

test('normalizes envelopes, deduplicates IDs, and rejects unusable suggestions', () => {
    const regions = [null, { id: 1, name: { content: ' Dubai ' } }, { id: 1, name: 'Dubai' }, { id: 0, name: 'Invalid' }];
    const hotels = [{ hid: 0, name: 'Zero ID Hotel' }, { hid: '2', name: { value: 'Hotel' } }, { id: 'slug', name: 'No numeric ID' }, { hid: 3, name: {} }];
    const normalized = normalizeSuggestions({ data: { suggestions: { regions, hotels } } });
    assert.equal(normalized.length, 3);
    assert.equal(normalized[0].label, 'Dubai');
    assert.equal(normalized[1].hotel_id, 0);
    assert.equal(normalized[2].hotel_id, 2);
    assert.equal(normalizeSuggestions([{ id: 1, name: 'Dubai' }]).length, 1);
    assert.deepEqual(normalizeSuggestions(null), []);
    assert.deepEqual(normalizeSuggestions({ suggestions: { regions: {} } }), []);
});

test('hotel selection requires an actual bounded ID, not a slug or empty value', () => {
    for (const id of [undefined, null, '', -1, 0x100000000, 'hotel-slug']) assert.equal(validDestination({ type: 'hotel', label: 'Hotel', hotel_id: id }), false);
    assert.equal(validDestination({ type: 'hotel', label: 'Hotel', hotel_id: 0 }), true);
});

test('a selected ID must still match the edited query', () => {
    assert.deepEqual(validateSearch(search, now), {});
    assert.equal(validateSearch({ ...search, query: 'Dubai Marina' }, now).destination, 'destinationRequired');
    assert.equal(validateSearch({ ...search, destination: null }, now).destination, 'destinationRequired');
});

test('both dates are checked and past/invalid ranges are rejected', () => {
    assert.deepEqual(validateSearch({ ...search, checkin: '', checkout: '' }, now), { checkin: 'datesRequired', checkout: 'datesRequired' });
    assert.equal(validateSearch({ ...search, checkin: '2026-09-25' }, now).checkin, 'invalidDates');
    assert.equal(validateSearch({ ...search, checkout: search.checkin }, now).checkout, 'invalidDates');
    assert.equal(validateSearch({ ...search, checkout: 'invalid' }, now).checkout, 'invalidDates');
    assert.deepEqual(validateSearch({ ...search, checkin: '2026-09-26', checkout: '2026-09-27' }, now), {});
});

test('guest ages include infants, exclude missing/invalid ages, and preserve room limits', () => {
    assert.deepEqual(validateSearch({ ...search, guests: [{ adults: 1, children: [0, 17] }] }, now), {});
    for (const age of ['', null, -1, 18, 1.5]) assert.equal(validateSearch({ ...search, guests: [{ adults: 2, children: [age] }] }, now).guests, 'childAgeRequired');
    assert.equal(validateSearch({ ...search, guests: [{ adults: 0, children: [] }] }, now).guests, 'invalidGuests');
    assert.equal(validateSearch({ ...search, guests: Array(5).fill({ adults: 2, children: [] }) }, now).guests, 'invalidGuests');
    assert.deepEqual(initialGuests(null), [{ adults: 2, children: [] }]);
    assert.deepEqual(initialGuests([{ adults: 20, children: [0, '', null, 18, 7] }]), [{ adults: 6, children: [0, '', '', ''] }]);
});