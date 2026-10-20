const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { globalLimiter } = require('./services/securityService');

test('repeated Render probes do not exhaust the customer request budget, which still rejects excess traffic', async context => {
    context.mock.method(require('./services/loggerService'), 'warn', () => {});
    const app = express().use(globalLimiter).use((_req, res) => res.sendStatus(200));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 205; i++) {
        const response = await fetch(`${base}${i % 2 ? '/api/v1/ready' : '/api/v1/health'}`);
        assert.equal(response.status, 200);
        await response.text();
    }
    for (let i = 0; i < 200; i++) {
        // POST and subpaths are not health probes and must remain limited.
        const response = await fetch(`${base}${i % 2 ? '/api/v1/ready/details' : '/api/v1/health'}`, { method: i % 2 ? 'GET' : 'POST' });
        assert.equal(response.status, 200);
        await response.text();
    }
    assert.equal((await fetch(`${base}/customer`)).status, 429);
    assert.equal((await fetch(`${base}/api/v1/ready`)).status, 200);
});
