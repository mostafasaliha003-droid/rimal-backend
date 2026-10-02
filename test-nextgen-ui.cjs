const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');

const root = __dirname;
const frontend = path.join(root, 'frontend');
const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const accessToken = 'a'.repeat(64);
const publicOfferId = 'b'.repeat(64);
const search = {
    query: 'Fixture destination',
    destination: { type: 'region', region_id: 42, label: 'Fixture destination' },
    checkin: '2099-10-15',
    checkout: '2099-10-17',
        guests: [{ adults: 2, children: [] }]
};

async function run() {
    const previousFlags = Object.fromEntries([
        'VITE_NEXT_GEN_HOTELS_ENABLED',
        'VITE_AGGREGATE_SEARCH_PATH',
        'VITE_API_BASE_URL',
        'VITE_REMAL_SECURE_KEY'
    ].map(name => [name, process.env[name]]));
    const previousCwd = process.cwd();
    let server;
    let browser;
    let context;
    try {
        process.env.VITE_NEXT_GEN_HOTELS_ENABLED = 'true';
        process.env.VITE_AGGREGATE_SEARCH_PATH = '/v1/hotels/search/aggregate';
        process.env.VITE_API_BASE_URL = '/api';
        process.env.VITE_REMAL_SECURE_KEY = 'mock-ui-key';
        process.chdir(frontend);
        const requireFrontend = createRequire(path.join(frontend, 'package.json'));
        const { createServer } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
        const { default: configure } = await import(pathToFileURL(path.join(frontend, 'vite.config.js')).href);
        const config = configure({ command: 'serve', mode: 'development' });
        server = await createServer({
            ...config,
            configFile: false,
            root: frontend,
            plugins: config.plugins.filter(plugin => plugin.name !== 'github-pages-fallback'),
            server: { host: '127.0.0.1', port: 0, proxy: {}, open: false },
            logLevel: 'warn'
        });
        await server.listen();
        const base = `http://127.0.0.1:${server.httpServer.address().port}`;
        browser = await puppeteer.launch({ headless: true });
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width: 1365, height: 900 });
        await page.setBypassServiceWorker(true);
        page.setDefaultTimeout(15000);
        const pageErrors = [];
        const pageLogs = [];
        const calls = { search: [], checkout: [], payment: [], status: [] };
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') pageLogs.push(message.text()); });
        page.on('requestfailed', request => pageLogs.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
        await page.evaluateOnNewDocument(({ search, sessionId, accessToken }) => {
            localStorage.setItem('remal_language', 'en');
            sessionStorage.setItem('remal_nextgen_search', JSON.stringify(search));
            sessionStorage.setItem(`remal_nextgen_checkout:${sessionId}`, JSON.stringify({ accessToken }));
        }, { search, sessionId, accessToken });
        await page.setRequestInterception(true);
        page.on('request', async request => {
            try {
                const url = new URL(request.url());
                if (url.pathname.includes('/api/')) {
                    const method = request.method();
                    let body = { success: true };
                    if (url.pathname.endsWith('/display-rates')) {
                        body = { success: true, date: '2099-01-01', rates: { AED: 3.67, SAR: 3.75, EUR: 0.9 } };
                    } else if (url.pathname.endsWith('/search/aggregate') && method === 'POST') {
                        calls.search.push(JSON.parse(request.postData()));
                        body = {
                            success: true,
                            schemaVersion: 2,
                            currency: 'AED',
                            mock: true,
                            environment: 'mock',
                            partialResults: false,
                            hotelCount: 1,
                            offerCount: 1,
                            hotels: [{
                                hotelGroupId: 'mock-hotel-group',
                                name: 'Rimal Next-Gen Mock Hotel',
                                offers: [{
                                    provider: 'hotelbeds',
                                    mock: true,
                                    publicOfferId,
                                    paymentFlow: 'PAY_NOW',
                                    occupancy: { rooms: 1, adults: 2, children: 0 },
                                    room: { name: 'Mock Double Room' },
                                    stay: { checkIn: search.checkin, checkOut: search.checkout },
                                    price: { amount: '403.70', currency: 'AED' },
                                    board: { normalizedCode: 'BB' },
                                    cancellation: { refundability: 'unknown' }
                                }]
                            }]
                        };
                    } else if (url.pathname.endsWith('/v1/hotels/checkout') && method === 'POST') {
                        calls.checkout.push({
                            body: JSON.parse(request.postData()),
                            idempotencyKey: request.headers()['idempotency-key']
                        });
                        body = {
                            success: true,
                            sessionId,
                            access_token: accessToken,
                            status: 'awaiting_payment',
                            totalAmount: 40370,
                            currency: 'AED',
                            payment_url: `https://pay.example.test/mock/${sessionId}`
                        };
                    } else if (url.pathname.endsWith(`/checkout/${sessionId}/mock-payment`) && method === 'POST') {
                        calls.payment.push(JSON.parse(request.postData()));
                        assert.equal(request.headers().authorization, `Bearer ${accessToken}`);
                        body = { success: true, sessionId, status: 'confirmed', duplicate: false };
                    } else if (url.pathname.endsWith(`/checkout/${sessionId}`) && method === 'GET') {
                        calls.status.push({ authorization: request.headers().authorization, cacheControl: request.headers()['cache-control'] });
                        body = {
                            success: true,
                            sessionId,
                            status: calls.payment.length ? 'confirmed' : 'awaiting_payment',
                            totalAmount: 40370,
                            currency: 'AED'
                        };
                    }
                    return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
                }
                if (url.origin === base) return request.continue();
                return request.abort();
            } catch (error) {
                if (!/Invalid InterceptionId|Target closed|Session closed|already handled/i.test(error.message)) {
                    pageErrors.push(error.message);
                }
            }
        });

        await page.goto(`${base}/next-gen`, { waitUntil: 'networkidle0' });
        try { await page.waitForFunction(() => document.body.innerText.includes('Rimal Next-Gen Mock Hotel')); }
        catch (error) {
            console.error(JSON.stringify({ url: page.url(), body: await page.evaluate(() => document.body.innerText), calls, pageErrors, pageLogs }, null, 2));
            throw error;
        }
        assert.match(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /AED\s*403\.70/);
        assert.equal((await page.$eval('[data-next-gen-hotels]', element => element.innerText)).includes('supplierAmount'), false);
        assert(calls.search.length >= 1);
        assert(calls.search.every(criteria => criteria.destination.type === 'region'));

        assert.equal(await page.$$eval('[data-next-gen-hotels] button.cta-red', buttons => buttons.length), 1);
        await page.click('[data-next-gen-hotels] button.cta-red');
        await page.waitForSelector('input[name="firstName"]');
        await page.type('input[name="firstName"]', 'Ada');
        await page.type('input[name="lastName"]', 'Lovelace');
        await page.type('input[name="email"]', 'ada@example.test');
        await page.type('input[name="additionalGuests.0.firstName"]', 'Grace');
        await page.type('input[name="additionalGuests.0.lastName"]', 'Hopper');
        await page.click('button[type="submit"]');
        try { await page.waitForFunction(() => location.pathname === '/mock-payment'); }
        catch (error) {
            console.error(JSON.stringify({ url: page.url(), body: await page.evaluate(() => document.body.innerText), calls, pageErrors, pageLogs }, null, 2));
            throw error;
        }
        await page.waitForFunction(() => document.body.innerText.includes('AED'));
        assert.equal(new URL(page.url()).searchParams.get('sessionId'), sessionId);
        assert.equal(new URL(page.url()).searchParams.get('accessToken'), null);

        await page.click('main button[type="button"]');
        await page.waitForFunction(() => location.pathname === '/payment-status');
        try { await page.waitForFunction(() => document.body.innerText.includes('confirmed')); }
        catch (error) {
            console.error(JSON.stringify({ url: page.url(), body: await page.evaluate(() => document.body.innerText), calls, pageErrors, pageLogs }, null, 2));
            throw error;
        }
        assert.equal(new URL(page.url()).searchParams.get('accessToken'), null);
        assert.equal(calls.checkout.length, 1);
        assert.equal(calls.checkout[0].body.publicOfferId, publicOfferId);
        assert.equal(calls.checkout[0].body.guestDetails.firstName, 'Ada');
        assert.equal(calls.checkout[0].body.guestDetails.rooms[0].guests.length, 2);
        assert.equal(Object.hasOwn(calls.checkout[0].body, 'total'), false);
        assert.equal(calls.payment.length, 1);
        assert.deepEqual(calls.payment[0], { action: 'complete' });
        assert(calls.status.length >= 2);
        assert(calls.status.every(call => call.authorization === `Bearer ${accessToken}`));
        assert.deepEqual(pageErrors, []);
        console.log('PASS: mock v2 results, AED presentation, checkout creation, local mock payment, and secure confirmed status.');
    } finally {
        await context?.close();
        await browser?.close();
        await server?.close();
        process.chdir(previousCwd);
        for (const [name, value] of Object.entries(previousFlags)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });