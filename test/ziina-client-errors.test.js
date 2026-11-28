'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ziina = require('../services/ziinaClient');

const response = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('a Ziina refusal keeps its HTTP status and error code; a lost connection has neither', async () => {
    await assert.rejects(ziina.getRefund('3f0c7a1e-2b4d-4c55-9a77-0b1c2d3e4f50', { token: 't',
        fetcher: async () => response(400, { code: 'REFUND_NOT_FOUND', message: 'We are unable to find this refund.' }) }),
    error => error.code === 'ziina_request_failed' && error.httpStatus === 400 && error.ziinaCode === 'REFUND_NOT_FOUND');
    await assert.rejects(ziina.getRefund('3f0c7a1e-2b4d-4c55-9a77-0b1c2d3e4f50', { token: 't',
        fetcher: async () => { throw new Error('socket hang up'); } }),
    error => error.code === 'ziina_request_failed' && error.httpStatus === undefined);
    await assert.rejects(ziina.getRefund('3f0c7a1e-2b4d-4c55-9a77-0b1c2d3e4f50', { token: 't',
        fetcher: async () => response(502, '<html>') }),
    error => error.httpStatus === 502 && error.ziinaCode === '');
});
