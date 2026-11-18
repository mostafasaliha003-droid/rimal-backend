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
    assert.equal(filters[2].state,'refund_completed');
});
