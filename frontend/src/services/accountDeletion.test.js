import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAccountDeletion, requestAccountDeletion, listAccountDeletionRequests } from './accountDeletion.js';

const token = 'a'.repeat(64);
const row = { reference: `del_${'1'.repeat(32)}`, status: 'requested', requested_at: '2026-11-17T12:00:00.000Z' };
const accepted = { success: true, request: row, data_deleted: false };
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('status reads are authenticated GETs and permit a genuine no-request response', async () => {
    const result = await getAccountDeletion({ token, method: 'POST', body: { email: 'other@example.test' }, fetchImpl: async (url, options) => {
        assert.equal(url, '/api/auth/account-deletion'); assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.body, undefined);
        assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit');
        return reply({ success: true, request: null, data_deleted: false });
    } });
    assert.equal(result, null);
});

test('intake sends only password and explicit confirmation, never caller identity selectors', async () => {
    const result = await requestAccountDeletion({ token, password: ' exact password ', confirmed: true,
        email: 'other@example.test', ownerSubject: 'other', fetchImpl: async (url, options) => {
            assert.equal(url, '/api/auth/account-deletion'); assert.equal(options.method, 'POST');
            assert.deepEqual(JSON.parse(options.body), { password: ' exact password ', confirm_account_deletion: true });
            return reply(accepted);
        } });
    assert.deepEqual(result, row); assert.equal(Object.hasOwn(result, 'password'), false);
});

test('wrong-password failure retains its distinct code and never becomes an accepted request', async () => {
    await assert.rejects(requestAccountDeletion({ token, password: 'wrong', confirmed: true,
        fetchImpl: async () => reply({ success: false, error: 'reauthentication_failed' }, 400) }),
    error => error.status === 400 && error.code === 'reauthentication_failed');
});

test('missing deployment, unavailable service and non-JSON errors never create a receipt', async () => {
    for (const status of [401, 404, 503]) {
        await assert.rejects(requestAccountDeletion({ token, password: 'password', confirmed: true,
            fetchImpl: async () => reply({ success: false, error: 'account_deletion_unavailable' }, status) }), error => error.status === status);
    }
    await assert.rejects(getAccountDeletion({ token, fetchImpl: async () => ({ status: 404, ok: false, json: async () => { throw Error('HTML'); } }) }), error => error.status === 404);
});

test('success-looking responses must affirm intake-only status, valid reference and exact timestamp', async () => {
    for (const data of [{ ...accepted, success: false }, { ...accepted, data_deleted: true }, { success: true, request: row },
        { ...accepted, request: null }, { ...accepted, request: { ...row, status: 'completed' } },
        { ...accepted, request: { ...row, reference: 'another-owner' } }, { ...accepted, request: { ...row, requested_at: 'not a date' } }]) {
        await assert.rejects(requestAccountDeletion({ token, password: 'password', confirmed: true, fetchImpl: async () => reply(data) }), error => error.code === 'account_deletion_unavailable');
    }
    await assert.rejects(getAccountDeletion({ token, fetchImpl: async () => reply({ success: true, data_deleted: false }) }));
});

test('admin listing uses bounded read-only pagination and exposes only its approved fields', async () => {
    const result = await listAccountDeletionRequests({ token, limit: 25, offset: 25, method: 'DELETE', fetchImpl: async (url, options) => {
        assert.equal(url, '/api/admin/account-deletion-requests?limit=25&offset=25'); assert.equal(options.method, 'GET');
        assert.equal(options.body, undefined);
        return reply({ success: true, requests: [{ ...row, ownerSubject: 'owner-1', email: 'not-for-this-view@example.test' }], pagination: { limit: 25, offset: 25, has_more: true } });
    } });
    assert.deepEqual(result, { requests: [{ ...row, ownerSubject: 'owner-1' }], pagination: { limit: 25, offset: 25, has_more: true } });
});

test('admin listing rejects inconsistent pagination and malformed rows', async () => {
    for (const data of [{ success: true, requests: [{ ...row, ownerSubject: '' }], pagination: { limit: 25, offset: 0, has_more: false } },
        { success: true, requests: [row], pagination: { limit: 25, offset: 0, has_more: false } },
        { success: true, requests: [], pagination: { limit: 100, offset: 0, has_more: false } },
        { success: true, requests: [], pagination: { limit: 25, offset: 0, has_more: 'false' } }]) {
        await assert.rejects(listAccountDeletionRequests({ token, fetchImpl: async () => reply(data) }));
    }
});

test('invalid input and absent credentials fail before any request is sent', async () => {
    const fetchImpl = async () => assert.fail('network must not be reached');
    for (const options of [{ password: '', confirmed: true }, { password: 'password', confirmed: false }, { password: 'a'.repeat(257), confirmed: true }]) {
        await assert.rejects(requestAccountDeletion({ token, fetchImpl, ...options }), error => error.status === 400);
    }
    await assert.rejects(getAccountDeletion({ token: null, fetchImpl }), error => error.status === 401);
    for (const options of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 10001 }, { offset: 0.5 }]) {
        await assert.rejects(listAccountDeletionRequests({ token, fetchImpl, ...options }), error => error.status === 400);
    }
});
