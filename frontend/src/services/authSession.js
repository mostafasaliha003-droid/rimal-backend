const USER_STORAGE_KEY = 'rimal_current_user';
const USER_TOKEN_KEY = 'rimal_user_access_token';

export function readCurrentUser(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(USER_STORAGE_KEY);
        const user = raw ? JSON.parse(raw) : null;
        return user && typeof user.email === 'string' && typeof user.name === 'string' ? user : null;
    } catch {
        return null;
    }
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
    sessionStorage.setItem(USER_TOKEN_KEY, accessToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    globalThis.window?.dispatchEvent(new CustomEvent('remal:user-changed', { detail: user }));
}

export function clearUserSession({
    localStorage = globalThis.localStorage,
    sessionStorage = globalThis.sessionStorage
} = {}) {
    try { localStorage?.removeItem(USER_STORAGE_KEY); } catch {}
    try { sessionStorage?.removeItem(USER_TOKEN_KEY); } catch {}
    globalThis.window?.dispatchEvent(new CustomEvent('remal:user-changed', { detail: null }));
}