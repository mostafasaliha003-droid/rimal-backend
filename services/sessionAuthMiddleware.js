function bearerToken(request) {
    return /^Bearer ([a-f\d]{64})$/i.exec(request.get('Authorization') || '')?.[1] || null;
}

function createSessionAuthMiddleware({ sessions, realm = process.env.RIMAL_AUTH_REALM } = {}) {
    if (!sessions || typeof sessions.resolve !== 'function') {
        throw new TypeError('session_auth_dependencies_invalid');
    }
    function requireRole(role) {
        if (!['user', 'admin'].includes(role)) throw new TypeError('session_auth_role_invalid');
        return async function authenticateSession(request, response, next) {
            response.set('Cache-Control', 'no-store');
            response.set('Vary', 'Authorization');
            if (typeof realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(realm)) {
                return response.status(503).json({ success: false, error: 'authentication_unavailable' });
            }
            const token = bearerToken(request);
            if (!token) return response.status(401).json({ success: false, error: 'unauthorized' });
            try {
                const identity = await sessions.resolve(token, { realm });
                if (!identity || identity.role !== role) {
                    return response.status(401).json({ success: false, error: 'unauthorized' });
                }
                request.auth = identity;
                request.authToken = token;
                request.reauthenticate = async () => {
                    const current = await sessions.resolve(token, { realm });
                    if (!current || current.role !== role || current.subject !== identity.subject) {
                        throw Object.assign(new Error('unauthorized'), { httpStatus: 401 });
                    }
                    return current;
                };
                return next();
            } catch (error) {
                return response.status(error?.httpStatus === 503 ? 503 : 401)
                    .json({ success: false, error: error?.httpStatus === 503 ? 'authentication_unavailable' : 'unauthorized' });
            }
        };
    }

    return { requireRole, bearerToken };
}

module.exports = { bearerToken, createSessionAuthMiddleware };