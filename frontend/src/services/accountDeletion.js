import { API_BASE_URL } from './apiBaseUrl.js';
import { userAccessToken } from './authSession.js';

const unavailable = (status = 503, code = 'account_deletion_unavailable') => Object.assign(new Error(code), { status, code });
const validToken = token => typeof token === 'string' && /^[a-f\d]{64}$/i.test(token);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;

function requestView(row) {
    if (!row || !/^del_[a-f0-9]{32}$/.test(row.reference) || row.status !== 'requested' || !validDate(row.requested_at)) throw unavailable();
    return { reference: row.reference, status: 'requested', requested_at: row.requested_at };
}

async function send(path, { token, method = 'GET', body, signal, fetchImpl = globalThis.fetch }) {
    if (!validToken(token)) throw unavailable(401, 'unauthorized');
    const response = await fetchImpl(`${API_BASE_URL}${path}`, {
        method, cache: 'no-store', credentials: 'omit',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    let data;
    try { data = await response.json(); } catch { throw unavailable(response.status); }
    if (!response.ok) throw unavailable(response.status, typeof data?.error === 'string' ? data.error : 'account_deletion_unavailable');
    if (data?.success !== true) throw unavailable();
    return data;
}

export async function getAccountDeletion({ token = userAccessToken(), signal, fetchImpl } = {}) {
    const data = await send('/auth/account-deletion', { signal, fetchImpl, token });
    if (data.data_deleted !== false || !Object.hasOwn(data, 'request')) throw unavailable();
    return data.request === null ? null : requestView(data.request);
}

export async function requestAccountDeletion({ password, confirmed, token = userAccessToken(), signal, fetchImpl } = {}) {
    if (typeof password !== 'string' || !password.length || password.length > 256 || confirmed !== true) {
        throw unavailable(400, 'invalid_account_deletion_request');
    }
    const data = await send('/auth/account-deletion', { signal, fetchImpl, token, method: 'POST',
        body: { password, confirm_account_deletion: true } });
    if (data.data_deleted !== false) throw unavailable();
    return requestView(data.request);
}

export async function listAccountDeletionRequests({ limit = 25, offset = 0, token, signal, fetchImpl } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
        throw unavailable(400, 'invalid_account_deletion_request');
    }
    const data = await send(`/admin/account-deletion-requests?limit=${limit}&offset=${offset}`, { signal, fetchImpl, token });
    if (!Array.isArray(data.requests) || data.requests.length > limit || data.pagination?.limit !== limit
        || data.pagination?.offset !== offset || typeof data.pagination?.has_more !== 'boolean') throw unavailable();
    return { requests: data.requests.map(row => {
        if (typeof row.ownerSubject !== 'string' || !row.ownerSubject.trim() || row.ownerSubject.length > 254) throw unavailable();
        return { ...requestView(row), ownerSubject: row.ownerSubject };
    }), pagination: { limit, offset, has_more: data.pagination.has_more } };
}
