function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeText(value, maxLength) {
    return typeof value === 'string' && value.trim() && value.length <= maxLength
        && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}

function registerChatSocketHandlers(io, { BookingModel, sendEmail = async () => {}, adminEmail } = {}) {
    if (!io || typeof io.on !== 'function' || !BookingModel || typeof BookingModel.findOne !== 'function'
        || typeof sendEmail !== 'function') throw new TypeError('chat_socket_dependencies_invalid');

    const activeRooms = new Set();
    io.on('connection', socket => {
        const joinedRooms = new Map();
        const currentIdentity = async () => {
            if (typeof socket.data?.reauthenticate === 'function') return socket.data.reauthenticate();
            return socket.data?.auth || null;
        };

        socket.on('admin_join', async () => {
            let identity;
            try { identity = await currentIdentity(); } catch { identity = null; }
            if (identity?.role !== 'admin') {
                socket.emit('admin_joined', { success: false, error: 'unauthorized' });
                return;
            }
            socket.join('admin_chat_room');
            socket.emit('active_rooms_list', [...activeRooms]);
            socket.emit('admin_joined', { success: true });
        });

        socket.on('join_chat', async data => {
            const referenceCode = safeText(data?.referenceCode, 80);
            const clientName = safeText(data?.clientName, 160);
            let identity;
            try { identity = await currentIdentity(); } catch { identity = null; }
            if (!referenceCode || !identity || !['user', 'admin'].includes(identity.role)
                || identity.role !== 'admin' && !clientName) {
                socket.emit('chat_joined', { success: false, message: 'بيانات المحادثة غير صالحة.' });
                return;
            }
            try {
                const filter = { bookingReference: referenceCode };
                if (identity?.role === 'user') {
                    filter.customerName = { $regex: `^${escapeRegExp(clientName)}$`, $options: 'i' };
                    filter.ownerSubject = identity.subject;
                    filter.realm = identity.realm;
                } else {
                    filter.realm = identity.realm;
                }
                const booking = await BookingModel.findOne(filter).select('bookingReference customerName').lean();
                if (!booking) {
                    socket.emit('chat_joined', { success: false, message: 'تعذر التحقق من بيانات الحجز.' });
                    return;
                }
                const room = booking.bookingReference;
                joinedRooms.set(room, { booking, role: identity?.role || 'guest', subject: identity?.subject });
                socket.join(room);
                activeRooms.add(room);
                socket.emit('chat_joined', { success: true, message: 'تم التحقق من الحجز بنجاح.' });
                io.to('admin_chat_room').emit('new_chat_room', { referenceCode: room, customerName: booking.customerName || '' });
            } catch {
                socket.emit('chat_joined', { success: false, message: 'تعذر فتح المحادثة حاليًا.' });
            }
        });

        socket.on('send_message', async data => {
            const referenceCode = safeText(data?.referenceCode, 80);
            const message = safeText(data?.message, 2000);
            const joined = referenceCode ? joinedRooms.get(referenceCode) : null;
            let identity;
            try { identity = await currentIdentity(); } catch { identity = null; }
            if (socket.data?.auth && !identity) return;
            if (joined && identity && (identity.role !== joined.role || identity.subject !== joined.subject)) return;
            const isAdmin = identity?.role === 'admin' && socket.rooms.has('admin_chat_room');
            if (!referenceCode || !message || !joined || !socket.rooms.has(referenceCode)
                || joined.role === 'admin' && !isAdmin) return;

            const sender = isAdmin ? 'الإدارة (Remal)' : joined.booking.customerName || 'العميل';
            const payload = { sender, message, time: new Date() };
            io.to(referenceCode).emit('receive_message', payload);
            io.to('admin_chat_room').emit('receive_message', { referenceCode, ...payload });
            if (!isAdmin) {
                const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                })[character]);
                try {
                    await sendEmail(adminEmail, `استفسار محادثة جديد من ${sender}`,
                        `<div dir="rtl"><p><b>المرجع:</b> ${escapeHtml(referenceCode)}</p><p><b>العميل:</b> ${escapeHtml(sender)}</p><p><b>الرسالة:</b> ${escapeHtml(message)}</p></div>`);
                } catch { /* Chat delivery does not depend on email availability. */ }
            }
        });
    });

    return { activeRooms };
}

module.exports = { escapeRegExp, registerChatSocketHandlers };