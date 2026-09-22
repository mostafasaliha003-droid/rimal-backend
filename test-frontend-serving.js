const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const corsPolicy = require('./services/corsPolicy');
const createFrontendRouter = require('./services/frontendService');

async function startSite(context, withBuild) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remal-frontend-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const files = {
        'index.html': '<html>root site</html>',
        '404.html': '<html>root fallback</html>',
        'assets/app.js': 'root asset',
        'sw.js': 'root service worker',
        'manifest.webmanifest': '{"name":"Remal"}',
        'offline.html': '<html>offline</html>',
        'icon-192.png': 'icon 192',
        'icon-512.png': 'icon 512',
        'server.js': 'PRIVATE SERVER SOURCE',
        'package.json': '{"private":"PRIVATE PACKAGE DATA"}',
        'services/paymentService.js': 'PRIVATE PAYMENT SOURCE',
        '.env': 'PRIVATE CONFIGURATION',
        '.git/config': 'PRIVATE GIT CONFIGURATION'
    };
    for (const [file, content] of Object.entries(files)) {
        const target = path.join(root, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
    }
    if (withBuild) {
        for (const [file, content] of Object.entries(files).filter(([file]) => ['index.html', 'assets/app.js', 'sw.js'].includes(file))) {
            const target = path.join(root, 'frontend', 'dist', file);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, content.replace('root', 'built'));
        }
    }
    const app = express();
    app.use(cors(corsPolicy));
    app.use(createFrontendRouter(root));
    app.use((error, req, res, next) => res.status(error.status || 500).send('Request failed'));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    return `http://127.0.0.1:${server.address().port}`;
}

test('serves committed site and SPA routes when Render has no frontend/dist', async context => {
    const base = await startSite(context, false);
    for (const route of ['/', '/index.html', '/checkout?payment=cancel', '/hotel/123?checkin=2026-10-15']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 200, route);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.equal(await response.text(), '<html>root site</html>');
    }
    for (const route of ['/assets/app.js', '/sw.js', '/manifest.webmanifest', '/offline.html', '/404.html', '/icon-192.png', '/icon-512.png']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 200, route);
    }
    const script = await fetch(`${base}/assets/app.js`);
    assert.match(script.headers.get('content-type'), /javascript/);
    const worker = await fetch(`${base}/sw.js`);
    assert.equal(worker.headers.get('cache-control'), 'no-cache');
});

test('prefers the local frontend build when it exists', async context => {
    const base = await startSite(context, true);
    assert.equal(await (await fetch(base)).text(), '<html>built site</html>');
    assert.equal(await (await fetch(`${base}/assets/app.js`)).text(), 'built asset');
    assert.equal(await (await fetch(`${base}/sw.js`)).text(), 'built service worker');
});

test('root fallback never exposes server files or returns HTML for missing assets and APIs', async context => {
    const base = await startSite(context, false);
    for (const route of ['/server.js', '/package.json', '/services/paymentService.js', '/.env', '/.git/config', '/assets/missing.js']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 404, route);
        assert.doesNotMatch(await response.text(), /PRIVATE|root site/);
    }
    for (const route of ['/api', '/api/missing']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 404, route);
        assert.deepEqual(await response.json(), { success: false, error: 'NOT_FOUND' });
    }
});

test('CORS preflight permits the public site and known local preview origins', async context => {
    const base = await startSite(context, false);
    for (const origin of ['https://remalbookings.com', 'https://www.remalbookings.com', 'http://127.0.0.1:5178', 'http://localhost:5178', 'http://localhost:5173']) {
        const response = await fetch(`${base}/api/search/suggest?query=DUBAI&language=ar`, {
            method: 'OPTIONS',
            headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type,x-api-key' }
        });
        assert.equal(response.status, 204, origin);
        assert.equal(response.headers.get('access-control-allow-origin'), origin);
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
        assert.match(response.headers.get('access-control-allow-headers'), /x-api-key/i);
        assert.match(response.headers.get('vary'), /origin/i);
        const actual = await fetch(`${base}/api/missing`, { headers: { Origin: origin } });
        assert.equal(actual.headers.get('access-control-allow-origin'), origin);
    }
});

test('CORS rejects untrusted domains, misleading hostnames and unapproved ports', async context => {
    const base = await startSite(context, false);
    for (const origin of ['https://untrusted.example', 'https://www.remalbookings.com.untrusted.example', 'http://127.0.0.1:9999', 'http://localhost.untrusted.example:5178']) {
        const response = await fetch(`${base}/api/search/suggest`, {
            method: 'OPTIONS',
            headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-api-key' }
        });
        assert.equal(response.status, 403, origin);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
});