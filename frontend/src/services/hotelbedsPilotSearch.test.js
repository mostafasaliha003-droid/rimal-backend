import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildHotelbedsPilotSearch,
    normalizeHotelbedsPilotList,
    sanitizeHotelbedsPilotSearch
} from './hotelbedsPilotSearch.js';

const hotels = [
    { providerHotelId: '74', label: 'Ignored client label' },
    { providerHotelId: '1067', label: 'Another ignored label' }
];
const fixedNow = new Date('2026-10-02T12:00:00.000Z');

test('pilot-list response is allowlisted, canonicalized, and rejects malformed IDs', () => {
    assert.deepEqual(normalizeHotelbedsPilotList({
        success: true, environment: 'test', configured: true,
        hotels: [{ providerHotelId: '074', label: 'Untrusted label', hid: 'ratehawk' }]
    }), { configured: true, hotels: [{ providerHotelId: '74', label: 'Hotelbeds ID 74' }] });
    assert.throws(() => normalizeHotelbedsPilotList({
        success: true, environment: 'test', configured: true,
        hotels: [{ providerHotelId: '74' }, { providerHotelId: '74' }]
    }), /hotelbeds_pilot_list_invalid/);
    assert.deepEqual(normalizeHotelbedsPilotList({
        success: true, environment: 'test', configured: false, hotels: []
    }), { configured: false, hotels: [] });
});

test('selector constructs only explicit Hotelbeds IDs and adult-only sandbox criteria', () => {
    assert.deepEqual(buildHotelbedsPilotSearch({
        hotelCode: '74', checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2, hotels, now: fixedNow
    }), {
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        guests: [{ adults: 2, children: [] }],
        destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74'] }, name: 'Hotelbeds ID 74' }
    });
    assert.throws(() => buildHotelbedsPilotSearch({
        hotelCode: 'rh-74', checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2, hotels, now: fixedNow
    }), /hotelbeds_pilot_hotel_not_allowed/);
    assert.throws(() => buildHotelbedsPilotSearch({
        hotelCode: '9999', checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2, hotels, now: fixedNow
    }), /hotelbeds_pilot_hotel_not_allowed/);
    assert.throws(() => buildHotelbedsPilotSearch({
        hotelCode: '74', checkIn: '2026-10-01', checkOut: '2026-10-02', adults: 2, hotels, now: fixedNow
    }), /hotelbeds_pilot_dates_invalid/);
    assert.throws(() => buildHotelbedsPilotSearch({
        hotelCode: '74', checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2.5, hotels, now: fixedNow
    }), /hotelbeds_pilot_occupancy_invalid/);
});

test('request sanitizer drops legacy IDs and rejects RateHawk-only or multi-hotel requests', () => {
    const request = sanitizeHotelbedsPilotSearch({
        checkIn: '2026-11-10', checkOut: '2026-11-12',
        guests: [{ adults: 2, children: [] }],
        region_id: 42,
        hids: ['rh-9'],
        destination: {
            type: 'hotel', hid: 'rh-7', hotel_id: 'rh-8', regionId: 44,
            providerHotelIds: { hotelbeds: ['74'], ratehawk: ['rh-1'] }
        }
    }, hotels, fixedNow);
    assert.deepEqual(request.destination, {
        type: 'hotel', providerHotelIds: { hotelbeds: ['74'] }, name: 'Hotelbeds ID 74'
    });
    assert.equal(Object.hasOwn(request, 'hids'), false);
    assert.throws(() => sanitizeHotelbedsPilotSearch({
        checkIn: '2026-11-10', checkOut: '2026-11-12', guests: [{ adults: 2, children: [] }],
        destination: { type: 'hotel', providerHotelIds: { ratehawk: ['rh-1'] } }
    }, hotels, fixedNow), /hotelbeds_pilot_hotel_not_allowed/);
    assert.throws(() => sanitizeHotelbedsPilotSearch({
        checkIn: '2026-11-10', checkOut: '2026-11-12', guests: [{ adults: 2, children: [] }],
        destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74', '1067'] } }
    }, hotels, fixedNow), /hotelbeds_pilot_hotel_not_allowed/);
    assert.throws(() => sanitizeHotelbedsPilotSearch({
        checkIn: '2026-11-10', checkOut: '2026-11-12',
        guests: [{ adults: 2, children: [] }, { adults: 1, children: [] }],
        destination: { type: 'hotel', providerHotelIds: { hotelbeds: ['74'] } }
    }, hotels, fixedNow), /hotelbeds_pilot_occupancy_invalid/);
});