const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOwnedNotificationsHandler } = require('./services/ownedNotifications');

test('the inbox reads only owned, dated events and never exposes internal keys or documents', async () => {
    const filters=[];
    function model(row) { return { find(filter) { filters.push(filter); return {sort(){return this;},limit(){return this;},select(){return this;},lean(){return [row];}}; } }; }
    const handler=createOwnedNotificationsHandler({
        Booking:model({_id:'private-reference', confirmedAt:'2026-01-01'}),
        Notice:model({_id:'private-application', event:'approved', createdAt:'2026-01-03', publicNote:'internal'}),
        Checkout:model({_id:'private-key',refund_verified_at:'2026-01-02'})
    });
    let payload;
    const res={set(){},json(data){payload=data;},sendStatus(status){return status;}};
    assert.equal(await handler({},res),401);
    await handler({auth:{role:'user',subject:'member',realm:'sandbox'}},res);
    for(const filter of filters){assert.equal(filter.ownerSubject,'member');assert.equal(filter.realm,'sandbox');}
    assert.deepEqual(payload.notifications.map(n=>n.event),['approved','refunded','confirmed']);
    assert.doesNotMatch(JSON.stringify(payload),/private-|internal/);
    assert.equal(filters[3].state,'refund_completed');
});

test('a cancellation the hotel confirmed is its own notice, newest first, without exposing records', async () => {
    const filters=[];
    const rows = { Booking: filter => filter.cancelledAt
        ? [{_id:'private-cancelled', cancelledAt:'2026-01-05', bookingReference:'booking-a'}]
        : [{_id:'private-confirmed', confirmedAt:'2026-01-04', bookingReference:'booking-a'}] };
    const model = name => ({ find(filter) { filters.push(filter); const list = name === 'Booking' ? rows.Booking(filter) : [];
        return {sort(){return this;},limit(){return this;},select(){return this;},lean(){return list;}}; } });
    const handler=createOwnedNotificationsHandler({ Booking:model('Booking'), Notice:model('Notice'), Checkout:model('Checkout') });
    let payload; const res={set(){},json(data){payload=data;},sendStatus(status){return status;}};
    await handler({auth:{role:'user',subject:'member',realm:'sandbox'}},res);
    assert.deepEqual(payload.notifications.map(n=>[n.event,n.reference]),[['cancelled','booking-a'],['confirmed','booking-a']]);
    assert.notEqual(payload.notifications[0].id, payload.notifications[1].id);
    assert.ok(filters.some(filter=>filter.cancelledAt && filter.ownerSubject==='member' && filter.realm==='sandbox'));
    assert.doesNotMatch(JSON.stringify(payload),/private-/);
});
