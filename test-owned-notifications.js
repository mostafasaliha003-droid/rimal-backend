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

test('a team reply in a support conversation is a notice that leads back to the conversation', async () => {
    const filters=[];
    const model=rows=>({find(filter){filters.push(filter);return {sort(){return this;},limit(){return this;},select(){return this;},lean(){return rows;}};}});
    const handler=createOwnedNotificationsHandler({ Booking:model([]), Notice:model([]), Checkout:model([]),
        Conversation:model([{_id:'c'.repeat(64), reference:'REF-1', lastStaffAt:'2026-11-25T10:00:00Z', customerReadAt:'2026-11-25T09:00:00Z'}]) });
    let payload; const res={set(){},json(data){payload=data;}};
    await handler({auth:{role:'user',subject:'member',realm:'sandbox'}},res);
    assert.equal(filters[3].ownerSubject,'member');
    assert.deepEqual(payload.notifications.map(n=>[n.kind,n.event,n.reference,n.unread]),[['support','reply','REF-1',true]]);
    assert.doesNotMatch(JSON.stringify(payload),/cccc/);
    // A later reply is a new notice.
    const later=createOwnedNotificationsHandler({ Booking:model([]), Notice:model([]), Checkout:model([]),
        Conversation:model([{_id:'c'.repeat(64), reference:'REF-1', lastStaffAt:'2026-11-25T11:00:00Z', customerReadAt:'2026-11-25T11:30:00Z'}]) });
    let second; await later({auth:{role:'user',subject:'member',realm:'sandbox'}},{set(){},json(data){second=data;}});
    assert.notEqual(second.notifications[0].id,payload.notifications[0].id);
    assert.equal(second.notifications[0].unread,false);
});
