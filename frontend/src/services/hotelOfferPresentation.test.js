import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRoomOffers, roomOfferKey, hotelAmenities, hotelDescription, mergeHotelPresentation,
    etgPolicyInstant, formatEtgPolicyTime, policyAmount, staySummary } from './hotelOfferPresentation.js';
import { normalizeRoom } from './offers.js';

const rate = (hash, amount, extra = {}) => ({ book_hash: hash, room_name: 'Double room', room_group_id: 7,
    meal: 'nomeal', payment_options: { payment_types: [{ type: 'deposit', amount,
        currency_code: 'USD', cancellation_penalties: { policies: [] } }] }, ...extra });

test('grouping keeps every supplier offer, its identity and prices across alternate meal/payment policies', () => {
    const rates = [rate('first', '140.00'), rate('other-room', '200', { room_name: 'Suite', room_group_id: 8 }),
        rate('breakfast', '170.00', { meal: 'breakfast' }), rate('affiliate', '160.00', { contract_source: 'affiliate',
            display_amount: '160.00', display_currency: 'USD', payment_options: { payment_types: [{ type: 'hotel', amount: '160', currency_code: 'USD' }] } }),
        rate('first', '140.00')]; // Equal hashes are not permission to discard a supplier offer.
    const rooms = rates.map(value => normalizeRoom(value, { hid: 10 }, [{ adults: 2, children: [] }]));
    const before = JSON.stringify(rooms);
    rooms.forEach(Object.freeze);
    const groups = groupRoomOffers(rooms);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].offers[0].room, rooms[0]);
    assert.equal(groups[1].offers[0].room, rooms[1]);
    assert.deepEqual(groups[0].offers.map(value => value.index), [0, 2, 3, 4]);
    assert.deepEqual(groups.flatMap(group => group.offers).sort((a, b) => a.index - b.index).map(value => value.room), rooms);
    assert.equal(JSON.stringify(rooms), before);
    assert.equal(groups[0].offers[1].room.originalRate, rates[2]);
    assert.equal(groups[0].offers[2].room.contract_source, 'affiliate');
});

test('card identity expires verified state on supplier hash refresh while retaining repeated offers', () => {
    const room = { book_hash: 'generation-A', contract_source: 'b2b', name: 'Same room', price: 60 };
    const first = roomOfferKey({ room, index: 0 });
    assert.notEqual(roomOfferKey({ room: { ...room, book_hash: 'generation-B' }, index: 0 }), first);
    assert.notEqual(roomOfferKey({ room: { ...room, contract_source: 'affiliate' }, index: 0 }), first);
    assert.notEqual(roomOfferKey({ room, index: 1 }), first);
    const grouped = groupRoomOffers([room, room, { ...room, book_hash: 'generation-B' }]);
    assert.equal(grouped[0].offers.length, 3);
    assert.equal(new Set(grouped[0].offers.map(roomOfferKey)).size, 3);
});

test('real structured static content survives empty live fields, without another property’s photos', () => {
    const staticHotel = { hid: 10, resolvedLanguage: 'en', name: 'Supplied hotel', images: ['https://photos.example.test/property.jpg'],
        description_struct: [{ title: 'Location', paragraphs: ['Real supplied location.', 'Second supplied paragraph.'] }],
        amenity_groups: [{ amenities: ['Wi-Fi', 'Spa'], non_free_amenities: ['Spa'] }], room_groups: [{ room_group_id: 7 }] };
    const merged = mergeHotelPresentation(staticHotel, { hid: 10, name: '', images: [], amenity_groups: [] }, 10, 'en');
    assert.equal(merged.name, 'Supplied hotel');
    assert.equal(merged.description, 'Real supplied location.\n\nSecond supplied paragraph.');
    assert.deepEqual(merged.images, staticHotel.images);
    assert.deepEqual(merged.room_groups, staticHotel.room_groups);
    assert.deepEqual(hotelAmenities(merged), [{ label: 'Wi-Fi', paid: false }, { label: 'Spa', paid: true }]);
    const wrong = mergeHotelPresentation({ ...staticHotel, hid: 99 }, { hid: 10 }, 10, 'en');
    assert.equal(wrong.description, '');
    assert.deepEqual(wrong.images, []);
    assert.deepEqual(hotelAmenities(wrong), []);
});

test('nested supplier content is unwrapped and absence stays explicit', () => {
    const hotel = { staticData: { description_struct: [{ paragraphs: ['Supplier text'] }],
        amenity_groups: [{ amenities: ['Pool'], non_free_amenities: ['Parking'] }] } };
    assert.equal(hotelDescription(hotel), 'Supplier text');
    assert.deepEqual(hotelAmenities(hotel), [{ label: 'Pool', paid: false }, { label: 'Parking', paid: true }]);
    assert.equal(hotelDescription({}), '');
    assert.deepEqual(hotelAmenities({}), []);
});

test('ETG cancellation timestamps use documented UTC, preserve explicit offsets and reject malformed dates', () => {
    assert.equal(etgPolicyInstant('2027-02-15T12:30:00'), '2027-02-15T12:30:00.000Z');
    assert.equal(etgPolicyInstant('2027-02-15T12:30:00+04:00'), '2027-02-15T08:30:00.000Z');
    assert.equal(etgPolicyInstant('2027-02-15 12:30:00Z'), '2027-02-15T12:30:00.000Z');
    for (const value of [undefined, '', '2027-02-15', '2027-02-30T12:30:00', '2027-02-15T24:00:00', 'not-a-date']) assert.equal(etgPolicyInstant(value), null);
    for (const language of ['en', 'ar', 'es']) {
        const formatted = formatEtgPolicyTime('2027-02-15T12:30:00', language);
        assert.equal(formatted.iso, '2027-02-15T12:30:00.000Z');
        assert.match(formatted.label, /UTC$/);
    }
});

test('penalties retain exact supplied amounts and only proven currencies, including a real zero', () => {
    const policy = { amount_charge: '122.50', amount_show: '450.12' };
    assert.deepEqual(policyAmount(policy, { currency: 'AED', chargeCurrency: 'USD', showCurrency: 'AED' }), { amount: '450.12', currency: 'AED' });
    assert.deepEqual(policyAmount(policy, { currency: 'USD', chargeCurrency: 'USD', showCurrency: 'AED' }), { amount: '122.50', currency: 'USD' });
    assert.deepEqual(policyAmount({ amount_charge: '0.00' }, { currency: 'USD' }), { amount: '0.00', currency: 'USD' });
    assert.deepEqual(policyAmount({ amount: '40.00', currency_code: 'EUR' }, { currency: 'USD' }), { amount: '40.00', currency: 'EUR' });
    assert.equal(policyAmount({ amount_show: '50' }, { currency: 'AED' }), null);
    assert.equal(policyAmount({ amount_charge: '50' }, { currency: 'AED', contractSource: 'affiliate' }), null);
    assert.equal(policyAmount({ amount: '50' }, { currency: 'USD' }), null);
    for (const amount of [undefined, '', null, -1, 'not-an-amount', Infinity]) assert.equal(policyAmount({ amount_charge: amount }, { currency: 'USD' }), null);
});

test('stay summaries use calendar nights and preserve rooms and all occupants', () => {
    assert.deepEqual(staySummary({ checkin: '2027-02-16', checkout: '2027-02-18', guests: [{ adults: 2, children: [] }] }),
        { checkin: '2027-02-16', checkout: '2027-02-18', nights: 2, rooms: 1, guests: 2 });
    assert.equal(staySummary({ checkin: '2027-03-27', checkout: '2027-03-29' }).nights, 2);
    assert.equal(staySummary({ checkin: '2027-02-30', checkout: '2027-03-02' }).nights, null);
    assert.equal(staySummary({ checkin: '2027-02-18', checkout: '2027-02-16' }).nights, null);
    assert.equal(staySummary({ guests: [{ adults: 2, children: [4] }, { adults: 1, children: [] }] }).guests, 4);
    assert.equal(staySummary({ guests: null }).rooms, 0);
});
