import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE_URL, resolveApiBaseUrl } from './apiBaseUrl.js';

test('Node and local development use the local API without requiring Vite globals', () => {
    assert.equal(API_BASE_URL, '/api');
    assert.equal(resolveApiBaseUrl(), '/api');
});

test('production only uses the approved BFF regardless of configured supplier or arbitrary URLs', () => {
    for (const configuredUrl of ['https://api.ratehawk.com', 'https://example.test/api', '/other-api']) {
        assert.equal(resolveApiBaseUrl({ production: true, configuredUrl }), 'https://rimal-api.onrender.com/api');
    }
});

test('staging requires the explicit build mode and exact approved host', () => {
    const configuredUrl = 'https://rimal-api-staging.onrender.com/api/';
    assert.equal(resolveApiBaseUrl({ production: true, mode: 'staging', configuredUrl }), configuredUrl.slice(0, -1));
    assert.equal(resolveApiBaseUrl({ production: true, configuredUrl }), 'https://rimal-api.onrender.com/api');
    assert.equal(resolveApiBaseUrl({ production: true, mode: 'staging', configuredUrl: 'https://example.test/api' }), 'https://rimal-api.onrender.com/api');
    assert.equal(resolveApiBaseUrl({ production: true, origin: 'https://rimal-api-staging.onrender.com' }), '/api');
    assert.equal(resolveApiBaseUrl({ production: true, origin: 'https://rimal-api-staging.onrender.com.example.test' }), 'https://rimal-api.onrender.com/api');
});
