const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerChatSocketHandlers } = require('./services/chatSocketHandlers');

function setup(identity = null, booking = { bookingReference: 'RML-BOOKING-1', customerName: 'Ada Lovelace', ownerSubject: 'user-1', realm: 'realm-1' }) {
    const connectionHandlers = [];
    const rooms = new Map();
    const emitted = [];
    const io = {
        on(event, handler) { if (event === 'connection') connectionHandlers.push(handler); },
        to(room) { return { emit(event, data) { emitted.push({ room, event, data }); } }; }
    };
    const BookingModel = {
        findOne(filter) {
            return { select() { return this; }, lean: async () => {
                if (filter.bookingReference !== booking.bookingReference) return null;
                if (filter.ownerSubject?.$exists === false && booking.ownerSubject !== undefined) return null;
                if (typeof filter.ownerSubject === 'string' && filter.ownerSubject !== booking.ownerSubject) return null;
                if (typeof filter.realm === 'string' && filter.realm !== booking.realm) return null;
                if (filter.realm && filter.realm !== booking.realm) return null;
                if (filter.customerName && !(new RegExp(filter.customerName.$regex, 'i')).test(booking.customerName)) return null;
                return booking;
            } };
        }
    };
    const service = registerChatSocketHandlers(io, { BookingModel, sendEmail: async () => {} });
    const events = new Map();
    const socket = {
        data: { auth: identity }, rooms: new Set(),
        on(event, handler) { events.set(event, handler); },
        emit(event, data) { emitted.push({ room: 'socket', event, data }); },
        join(room) { this.rooms.add(room); if (!rooms.has(room)) rooms.set(room, []); rooms.get(room).push(this); }
    };
    connectionHandlers[0](socket);
    return { socket, events, emitted, rooms, activeRooms: service.activeRooms };
}

test('customer chat requires verified authenticated booking identity, constrains room membership and ignores spoofed sender', async () => {
    const chat = setup({ subject: 'user-1', realm: 'realm-1', role: 'user' }, {
        bookingReference: 'RML-BOOKING-1', customerName: 'Ada Lovelace', ownerSubject: 'user-1', realm: 'realm-1'
    });
    await chat.events.get('join_chat')({ referenceCode: 'RML-BOOKING-1', clientName: 'Ada Lovelace' });
    assert.equal(chat.socket.rooms.has('RML-BOOKING-1'), true);
    await chat.events.get('send_message')({ referenceCode: 'RML-BOOKING-1', sender: 'Admin', message: 'Hello' });
    const forwarded = chat.emitted.find(event => event.event === 'receive_message');
    assert.equal(forwarded.data.sender, 'Ada Lovelace');
    const deliveredCount = chat.emitted.filter(event => event.event === 'receive_message').length;
    await chat.events.get('send_message')({ referenceCode: 'OTHER', sender: 'Ada', message: 'No access' });
    assert.equal(chat.emitted.filter(event => event.event === 'receive_message').length, deliveredCount);
});

test('only an authenticated admin can join the admin room or send as the admin', async () => {
    const guest = setup(null, { bookingReference: 'RML-BOOKING-1', customerName: 'Ada', ownerSubject: undefined, realm: undefined });
    await guest.events.get('admin_join')();
    assert.equal(guest.socket.rooms.has('admin_chat_room'), false);
    assert.equal(guest.emitted.find(event => event.event === 'admin_joined')?.data.success, false);

    const admin = setup({ subject: 'admin-1', realm: 'realm-1', role: 'admin' }, { bookingReference: 'RML-BOOKING-1', customerName: 'Ada', realm: 'realm-1' });
    await admin.events.get('admin_join')();
    assert.equal(admin.socket.rooms.has('admin_chat_room'), true);
    await admin.events.get('join_chat')({ referenceCode: 'RML-BOOKING-1' });
    await admin.events.get('send_message')({ referenceCode: 'RML-BOOKING-1', sender: 'customer', message: 'Approved reply' });
    assert.equal(admin.emitted.find(event => event.event === 'receive_message')?.data.sender, 'الإدارة (Remal)');
});

test('chat bounds user text and escapes it before sending email', async () => {
    const emails = [];
    const connectionHandlers = [];
    const io = { on(_event, handler) { connectionHandlers.push(handler); }, to() { return { emit() {} }; } };
    registerChatSocketHandlers(io, {
        BookingModel: { findOne() { return { select() { return this; }, lean: async () => ({ bookingReference: 'RML-BOOKING-1', customerName: 'Ada', ownerSubject: 'user-1', realm: 'realm-1' }) }; } },
        async sendEmail(_to, _subject, html) { emails.push(html); }
    });
    const handlers = new Map();
    const socket = { data: { auth: { subject: 'user-1', realm: 'realm-1', role: 'user' } }, rooms: new Set(), on(name, handler) { handlers.set(name, handler); }, emit() {}, join(room) { this.rooms.add(room); } };
    connectionHandlers[0](socket);
    await handlers.get('join_chat')({ referenceCode: 'RML-BOOKING-1', clientName: 'Ada' });
    await handlers.get('send_message')({ referenceCode: 'RML-BOOKING-1', message: '<script>x</script>'.repeat(140) });
    assert.deepEqual(emails, []);
    await handlers.get('send_message')({ referenceCode: 'RML-BOOKING-1', message: '<script>alert(1)</script>' });
    assert.match(emails[0], /&lt;script&gt;/);
    assert.doesNotMatch(emails[0], /<script>/);
});