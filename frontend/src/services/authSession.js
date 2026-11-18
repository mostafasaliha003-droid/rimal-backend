const USER_STORAGE_KEY = 'rimal_current_user';
const USER_TOKEN_KEY = 'rimal_user_access_token';
function forgetPrivateCheckout(storage) {
    for (const key of ['remal_guest_draft', 'remal_checkout', 'remal_checkout_payment_quote', 'remal_payment_attempt',
        'remal_checkout_idempotency_key', 'remal_affiliate_booking_idempotency_key', 'remal_affiliate_attempt']) {
        try { storage?.removeItem(key); } catch {}
    }
}

function storedUser(storage) {
    try {
        const raw = storage?.getItem(USER_STORAGE_KEY);
        const user = raw ? JSON.parse(raw) : null;
        return user && typeof user.email === 'string' && typeof user.name === 'string' ? user : null;
    } catch {
        return null;
    }
}

// Bearer tokens live in sessionStorage. A profile written by a different tab
// must never change which checkout belongs to this tab's authenticated session.
export function readCurrentUser(storage = globalThis.localStorage, session = globalThis.sessionStorage) {
    if (!userAccessToken(session)) return storedUser(storage);
    const current = storedUser(session);
    if (current) return current;
    const legacy = storedUser(storage);
    if (legacy) {
        try { session.setItem(USER_STORAGE_KEY, JSON.stringify(legacy)); } catch {}
    }
    return legacy;
}

export function userAccessToken(storage = globalThis.sessionStorage) {
    try {
        const token = storage?.getItem(USER_TOKEN_KEY);
        return typeof token === 'string' && /^[a-f\d]{64}$/i.test(token) ? token : null;
    } catch {
        return null;
    }
}

export function saveUserSession(user, accessToken, {
    localStorage = globalThis.localStorage,
    sessionStorage = globalThis.sessionStorage
} = {}) {
    if (!user || typeof user.email !== 'string' || typeof user.name !== 'string'
        || typeof accessToken !== 'string' || !/^[a-f\d]{64}$/i.test(accessToken)) {
        throw new Error('user_session_response_invalid');
    }
    const previous = readCurrentUser(localStorage, sessionStorage);
    if (previous && previous.email.toLowerCase() !== user.email.toLowerCase()) forgetPrivateCheckout(sessionStorage);
    sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    sessionStorage.setItem(USER_TOKEN_KEY, accessToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    globalThis.window?.dispatchEvent(new CustomEvent('remal:user-changed', { detail: user }));
}

export function clearUserSession({
    localStorage = globalThis.localStorage,
    sessionStorage = globalThis.sessionStorage
} = {}) {
    const own = storedUser(sessionStorage);
    const shared = storedUser(localStorage);
    if (!own || own.email.toLowerCase() === shared?.email.toLowerCase()) {
        try { localStorage?.removeItem(USER_STORAGE_KEY); } catch {}
    }
    try {
        sessionStorage?.removeItem(USER_TOKEN_KEY);
        sessionStorage?.removeItem(USER_STORAGE_KEY);
    } catch {}
    forgetPrivateCheckout(sessionStorage);
    globalThis.window?.dispatchEvent(new CustomEvent('remal:user-changed', { detail: null }));
}
