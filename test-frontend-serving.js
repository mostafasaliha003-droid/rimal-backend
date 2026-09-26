const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const corsPolicy = require('./services/corsPolicy');
const createFrontendRouter = require('./services/frontendService');

const fakeHotelModel = {
    findOne(filter) {
        assert.equal(filter.hid, '123');
        return { lean: async () => ({
            hid: '123', name: 'Original Hotel', city: 'Dubai', stars: '5',
            staticData: { name: 'Original Hotel', city: 'Dubai', stars: '5' },
            translations: { es: { name: 'Hotel Aprobado', reviewStatus: 'approved' } }
        }) };
    },
    find() {
        return {
            select() { return this; },
            limit() { return this; },
            lean: async () => [{ hid: '123', translations: { es: { name: 'Hotel Aprobado', reviewStatus: 'approved' } } }]
        };
    }
};

async function startSite(context, withBuild) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remal-frontend-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const files = {
        'index.html': '<!doctype html><html lang="ar" dir="rtl"><head><meta name="description" content="Original description"><title>Root site</title></head><body><div id="root">root site</div></body></html>',
        '404.html': '<!doctype html><html><head><title>Root fallback</title></head><body>root fallback</body></html>',
        'assets/app.js': 'root asset',
        'sw.js': 'root service worker',
        'manifest.webmanifest': '{"name":"Remal"}',
        'offline.html': '<html>offline</html>',
        'icon-192.png': 'icon 192',
        'icon-512.png': 'icon 512',
        'robots.txt': 'static robots',
        'sitemap.xml': '<urlset>static sitemap</urlset>',
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
            await fs.writeFile(target, content.replace('>root site</div>', '>built site</div>').replace('root asset', 'built asset').replace('root service worker', 'built service worker'));
        }
    }
    const app = express();
    app.use(cors(corsPolicy));
    app.use(createFrontendRouter(root));
    app.use((error, req, res, next) => res.status(error.status || 500).send('Request failed'));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close(error => error ? reject(error) : resolve());
    }));
    return `http://127.0.0.1:${server.address().port}`;
}

test('serves committed site and SPA routes when Render has no frontend/dist', async context => {
    const base = await startSite(context, false);
    for (const route of ['/', '/index.html', '/checkout?payment=cancel', '/hotel/123?checkin=2026-10-15']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 200, route);
        assert.match(response.headers.get('content-type'), /text\/html/);
        const html = await response.text();
        assert.match(html, /<div id="root">root site<\/div>/);
        assert.match(html, /rel="canonical"/);
        if (route.startsWith('/checkout')) assert.match(html, /name="robots" content="noindex,follow"/);
    }
    for (const route of ['/assets/app.js', '/sw.js', '/manifest.webmanifest', '/offline.html', '/404.html', '/icon-192.png', '/icon-512.png', '/robots.txt', '/sitemap.xml']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 200, route);
    }
    const script = await fetch(`${base}/assets/app.js`);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal(script.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const worker = await fetch(`${base}/sw.js`);
    assert.equal(worker.headers.get('cache-control'), 'no-cache');
    const index = await fetch(`${base}/index.html`);
    assert.equal(index.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
});

test('prefers the local frontend build when it exists', async context => {
    const base = await startSite(context, true);
    assert.match(await (await fetch(base)).text(), /<div id="root">built site<\/div>/);
    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(await asset.text(), 'built asset');
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const distAsset = await fetch(`${base}/dist/assets/app.js`);
    assert.equal(await distAsset.text(), 'built asset');
    assert.equal(distAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(await (await fetch(`${base}/sw.js`)).text(), 'built service worker');
    const index = await fetch(`${base}/index.html`);
    assert.equal(index.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const missingAsset = await fetch(`${base}/assets/old-build.js`);
    assert.equal(missingAsset.status, 200);
    assert.match(await missingAsset.text(), /<div id="root">built site<\/div>/);
    assert.equal(missingAsset.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
});

test('root fallback never exposes server files and missing assets recover through index.html', async context => {
    const base = await startSite(context, false);
    for (const route of ['/server.js', '/package.json', '/services/paymentService.js', '/.env', '/.git/config']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 404, route);
        assert.doesNotMatch(await response.text(), /PRIVATE|root site/);
    }
    const missingAsset = await fetch(`${base}/assets/missing.js`);
    assert.equal(missingAsset.status, 200);
    assert.match(await missingAsset.text(), /<div id="root">root site<\/div>/);
    assert.equal(missingAsset.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
    for (const route of ['/api', '/api/missing']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 404, route);
        assert.deepEqual(await response.json(), { success: false, error: 'NOT_FOUND' });
    }
});

test('serves localized hotel SEO, sitemap, robots, and hides unavailable language alternates', async context => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remal-seo-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><title>Original</title></head><body><div id="root"></div></body></html>');
    const app = express().use(createFrontendRouter(root, { Hotel: fakeHotelModel }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close(error => error ? reject(error) : resolve());
    }));
    const base = `http://127.0.0.1:${server.address().port}`;

    const hotel = await fetch(`${base}/hotel/123?lang=es`);
    const hotelHtml = await hotel.text();
    assert.equal(hotel.status, 200);
    assert.match(hotelHtml, /<title>Hotel Aprobado — Dubai \| Remal<\/title>/);
    assert.match(hotelHtml, /hreflang="es"/);
    assert.doesNotMatch(hotelHtml, /hreflang="ar"/);
    assert.match(hotelHtml, /application\/ld\+json/);

    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /hotel\/123\?lang=en/);
    assert.match(sitemap, /hreflang="es"/);
    assert.doesNotMatch(sitemap, /hreflang="ar" href="https:\/\/remalbookings\.com\/hotel\/123/);
    assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Sitemap: https:\/\/remalbookings\.com\/sitemap\.xml/);

    const privatePage = await (await fetch(`${base}/account`)).text();
    assert.match(privatePage, /name="robots" content="noindex,follow"/);
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