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
        const calls = { pilotList: 0, search: [], searchScenarios: [], suggestions: [], checkout: [], payment: [], status: [] };
        const searchFailureQueue = [];
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
                    } else if (url.pathname.endsWith('/v1/hotels/pilot-list') && method === 'GET') {
                        calls.pilotList += 1;
                        body = {
                            success: true,
                            environment: 'test',
                            configured: true,
                            hotels: [{ providerHotelId: '900001', label: 'Hotelbeds ID 900001' }]
                        };
                    } else if (url.pathname.endsWith('/search/suggest') && method === 'GET') {
                        calls.suggestions.push(url.pathname);
                        body = { success: true, suggestions: { regions: [], hotels: [] } };
                    } else if (url.pathname.endsWith('/search/aggregate') && method === 'POST') {
                        calls.search.push(JSON.parse(request.postData()));
                        if (searchFailureQueue.length > 0) {
                            const scenario = searchFailureQueue.shift();
                            calls.searchScenarios.push(scenario);
                            const errors = {
                                '429': { status: 429, headers: { 'Retry-After': '5' }, data: { success: false, error: 'hotelbeds_local_quota_exhausted', retryAfterSeconds: 5 } },
                                '503': { status: 503, headers: {}, data: { success: false, error: 'hotel_search_temporarily_unavailable' } },
                                '403': { status: 403, headers: {}, data: { success: false, error: 'access_denied' } }
                            };
                            const failure = errors[scenario];
                            return request.respond({ status: failure.status, headers: failure.headers,
                                contentType: 'application/json', body: JSON.stringify(failure.data) });
                        }
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
                                name: 'Rimal Next-Gen Fixture Hotel',
                                category: { code: '4EST', name: 'Four-star verified fixture' },
                                content: {
                                    images: [{ url: 'https://photos.hotelbeds.com/giata/bigger/mock-unverified.jpg', visualOrder: 0 }]
                                },
                                offers: [{
                                    provider: 'hotelbeds',
                                    mock: true,
                                    publicOfferId,
                                    termsVersion: 'c'.repeat(64),
                                    paymentFlow: 'PAY_NOW',
                                    occupancy: { rooms: 1, adults: 2, children: 0 },
                                    hotel: {
                                        name: 'Rimal Next-Gen Fixture Hotel',
                                        category: { code: '4EST', name: 'Four-star verified fixture' },
                                        content: { facilities: [] }
                                    },
                                    room: { name: 'Mock Double Room', providerCode: 'ROOM-1' },
                                    stay: { checkIn: search.checkin, checkOut: search.checkout },
                                    price: { amount: '403.70', currency: 'AED' },
                                    board: { normalizedCode: 'BB', supplierName: 'Bed and Breakfast' },
                                    rateComments: ['Fixture rate condition: local fees may apply.'],
                                    contractTerms: {
                                        rateCommentsResolved: true,
                                        issues: [],
                                        mandatoryFacilities: [
                                            { description: 'Local facility fee', fee: true, amount: '25.00', currency: 'AED' },
                                            { description: 'Unpriced mandatory facility', fee: true, amount: null, currency: null },
                                            { description: 'Unknown facility conditions', fee: null, amount: null, currency: null }
                                        ]
                                    },
                                    taxes: {
                                        status: 'provided',
                                        allIncluded: false,
                                        items: [
                                            { type: 'Municipal fee', included: false, amountDisplayable: true, amount: '8.50', currency: 'AED' },
                                            { type: 'Unverified local tax', included: null, amountDisplayable: false }
                                        ]
                                    },
                                    cancellation: {
                                        refundability: 'unknown',
                                        schedule: [{
                                            startsAt: { source: '2099-10-14T18:30:00+04:00', utc: '2099-10-14T14:30:00.000Z', timezoneKnown: true },
                                            feeAmountDisplayable: true,
                                            feeAmount: '90.00',
                                            currency: 'AED'
                                        }]
                                    }
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

        await page.goto(`${base}/next-gen?lang=en`, { waitUntil: 'networkidle0' });
        await page.select('#language-select', 'en');
        await page.waitForFunction(() => document.body.dataset.language === 'en');
        await page.waitForFunction(() => document.querySelector('#hotelbeds-pilot-hotel option[value="900001"]'));
        assert.match(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /Next-Gen Sandbox/);
        await page.select('#hotelbeds-pilot-hotel', '900001');
        const setDate = async (selector, value) => page.$eval(selector, (input, nextValue) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, nextValue);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        await setDate('input[aria-label="Check-in"]', search.checkin);
        await setDate('input[aria-label="Check-out"]', search.checkout);
        await page.click('#hotelbeds-pilot-search');
        try { await page.waitForFunction(() => document.body.innerText.includes('Rimal Next-Gen Fixture Hotel')); }
        catch (error) {
            console.error(JSON.stringify({ url: page.url(), body: await page.evaluate(() => document.body.innerText), calls, pageErrors, pageLogs }, null, 2));
            throw error;
        }
        assert.match(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /AED\s*403\.70/);
        assert.equal((await page.$eval('[data-next-gen-hotels]', element => element.innerText)).includes('supplierAmount'), false);
        const resultText = await page.$eval('[data-next-gen-hotels]', element => element.innerText);
        assert.match(resultText, /(?:Fee unknown|Tarifa desconocida)/);
        assert.match(resultText, /(?:Amount unknown|Importe desconocido)/);
        assert.match(resultText, /(?:Conditions unknown|Condiciones desconocidas)/);
        assert.match(resultText, /2099-10-14T18:30:00\+04:00/);
        assert.equal(await page.$$eval('[data-next-gen-hotels] img', images => images.length), 0,
            'unverified mock images must not render');
        assert(calls.pilotList >= 1, 'the approved Hotelbeds pilot list must be loaded');
        assert(calls.search.length >= 1);
        assert(calls.search.every(criteria => criteria.destination.type === 'hotel'
            && criteria.destination.providerHotelIds.hotelbeds[0] === '900001'
            && !Object.hasOwn(criteria.destination, 'region_id')
            && !Object.hasOwn(criteria.destination, 'hid')));
        assert.deepEqual(calls.suggestions, [], 'Next-Gen must not call legacy RateHawk suggestions');

        const submitSearch = async () => {
            await page.click('#hotelbeds-pilot-search');
            await page.waitForSelector('[data-search-form-error]');
        };

        searchFailureQueue.push('429');
        await submitSearch();
        await page.waitForSelector('[data-nextgen-cooldown]');
        assert.match(await page.$eval('[data-nextgen-cooldown]', element => element.innerText), /5 (?:seconds|segundos)/);
        assert.equal(await page.$eval('#hotelbeds-pilot-search', button => button.disabled), true);
        assert.equal(await page.$eval('[data-nextgen-retry]', button => button.disabled), true);
        const callsAfter429 = calls.search.length;
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(calls.search.length, callsAfter429, '429 cooldown must not retry automatically');
        await page.waitForFunction(() => !document.querySelector('[data-nextgen-cooldown]'));
        assert.equal(await page.$eval('#hotelbeds-pilot-search', button => button.disabled), false);
        await page.click('[data-nextgen-retry]');
        await page.waitForFunction(() => document.querySelector('[data-next-gen-hotels]')?.innerText.includes('Rimal Next-Gen Fixture Hotel'));
        assert.equal(calls.search.length, callsAfter429 + 1, 'retry occurs only after an explicit user action');

        searchFailureQueue.push('503');
        await submitSearch();
        assert.match(await page.$eval('[data-search-form-error]', element => element.innerText), /(?:temporarily unavailable|no está disponible temporalmente)/i);
        assert.equal(await page.$('[data-nextgen-cooldown]'), null, '503 must not show a speculative countdown');
        await page.click('[data-nextgen-retry]');
        await page.waitForFunction(() => document.querySelector('[data-next-gen-hotels]')?.innerText.includes('Rimal Next-Gen Fixture Hotel'));

        searchFailureQueue.push('403');
        await submitSearch();
        assert.match(await page.$eval('[data-search-form-error]', element => element.innerText), /(?:contact support|contacta con soporte)/i);
        assert.doesNotMatch(await page.$eval('[data-search-form-error]', element => element.innerText), /quota|rate limit/i);
        assert.equal(await page.$('[data-nextgen-cooldown]'), null);

        await page.click('[data-nextgen-retry]');
        await page.waitForFunction(() => document.body.innerText.includes('Rimal Next-Gen Fixture Hotel'));

        assert.equal(await page.$$eval('[data-next-gen-hotels] article button.cta-red', buttons => buttons.length), 1);
        await page.click('[data-next-gen-hotels] article button.cta-red');
        await page.waitForSelector('input[name="firstName"]');
        const checkoutText = await page.$eval('aside', element => element.innerText);
        assert.match(checkoutText, /Four-star verified fixture/);
        assert.match(checkoutText, /Mock Double Room/);
        assert.match(checkoutText, /Bed and Breakfast/);
        assert.match(checkoutText, /Fixture rate condition/);
        assert.match(checkoutText, /AED 25\.00/);
        assert.match(checkoutText, /AED 8\.50/);
        assert.match(checkoutText, /2099-10-14T18:30:00\+04:00/);
        assert.match(checkoutText, /(?:Amount unknown|Importe desconocido)/);
        assert.match(checkoutText, /(?:Fee unknown|Tarifa desconocida)/);
        const consentCheckbox = await page.$('input[name="acceptedTerms"]');
        assert.ok(consentCheckbox, 'checkout must require acceptance of the displayed offer terms');
        assert.equal(await page.$eval('button[type="submit"]', button => button.disabled), true);
        await page.click('input[name="acceptedTerms"]');
        assert.equal(await page.$eval('button[type="submit"]', button => button.disabled), false);
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
        assert.equal(calls.checkout[0].body.termsAccepted, true);
        assert.equal(calls.checkout[0].body.acceptedTermsVersion, 'c'.repeat(64));
        assert.equal(calls.checkout[0].body.guestDetails.firstName, 'Ada');
        assert.equal(calls.checkout[0].body.guestDetails.rooms[0].guests.length, 2);
        assert.equal(Object.hasOwn(calls.checkout[0].body, 'total'), false);
        assert.equal(calls.payment.length, 1);
        assert.deepEqual(calls.payment[0], { action: 'complete' });
        assert(calls.status.length >= 2);
        assert(calls.status.every(call => call.authorization === `Bearer ${accessToken}`));
        assert.deepEqual(pageErrors, []);
        console.log('PASS: verified fixture DTO, mock-image exclusion, rate fee/time display, 429 cooldown/manual-only retry, 503/403 UX, mock checkout, and secure confirmed status.');
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