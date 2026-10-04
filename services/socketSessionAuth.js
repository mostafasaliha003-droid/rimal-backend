function createSocketSessionAuth({ sessions, realm = process.env.RIMAL_AUTH_REALM } = {}) {
    if (!sessions || typeof sessions.resolve !== 'function') {
        throw new TypeError('socket_session_auth_dependencies_invalid');
    }

    return async function authenticateSocket(socket, next) {
        const token = socket.handshake?.auth?.token;
        if (token === undefined || token === null || token === '') {
            socket.data.auth = null;
            socket.data.reauthenticate = null;
            return next();
        }
        if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) {
            return next(new Error('unauthorized'));
        }
        try {
            const resolveActiveIdentity = async () => {
                const identity = await sessions.resolve(token, { realm });
                if (!identity || identity.realm !== realm || !['admin', 'user'].includes(identity.role)) return null;
                return identity;
            };
            const identity = await resolveActiveIdentity();
            if (!identity) return next(new Error('unauthorized'));
            socket.data.auth = identity;
            socket.data.reauthenticate = resolveActiveIdentity;
            return next();
        } catch {
            return next(new Error('authentication_unavailable'));
        }
    };
}

module.exports = { createSocketSessionAuth };