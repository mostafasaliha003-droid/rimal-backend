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
const directPublicOfferId = 'd'.repeat(64);
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
        'VITE_HOTELBEDS_DIRECT_BOOKING_UI_ENABLED',
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
        process.env.VITE_HOTELBEDS_DIRECT_BOOKING_UI_ENABLED = 'true';
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
        const calls = {
            pilotList: 0, search: [], searchScenarios: [], suggestions: [], checkout: [],
            payment: [], status: [], rateReviews: [], directBookings: [], vouchers: []
        };
        const searchFailureQueue = [];
        page.on('console', message => { if (message.type() === 'error') pageLogs.push(message.text()); });
        page.on('pageerror', error => pageErrors.push(error.message));

        await page.evaluateOnNewDocument(({ search, sessionId, accessToken }) => {
            localStorage.setItem('remal_language', 'en');
            sessionStorage.setItem('remal_nextgen_search', JSON.stringify(search));
            sessionStorage.setItem(`remal_nextgen_checkout:${sessionId}`, JSON.stringify({ accessToken }));
        }, { search, sessionId, accessToken });
        page.on('requestfailed', request => pageLogs.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
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
                    } else if (url.pathname.endsWith('/v1/hotels/offers/review') && method === 'POST') {
                        calls.rateReviews.push({
                            body: JSON.parse(request.postData()),
                            idempotencyKey: request.headers()['idempotency-key'],
                            authorization: request.headers().authorization
                        });
                        const expiresAt = new Date(Date.now() + 120_000).toISOString();
                        body = {
                            success: true,
                            reviewId: '123e4567-e89b-42d3-a456-426614174000',
                            publicOfferId: directPublicOfferId,
                            sourceTermsVersion: 'e'.repeat(64),
                            termsVersion: 'f'.repeat(64),
                            expiresAt,
                            checkRateRequests: 1,
                            cached: false,
                            offer: {
                                provider: 'hotelbeds',
                                publicOfferId: directPublicOfferId,
                                termsVersion: 'f'.repeat(64),
                                hotel: { name: 'Direct fixture hotel', category: { name: '4 stars' } },
                                room: { name: 'Direct fixture double room' },
                                availability: { rateType: 'BOOKABLE' },
                                payment: { type: 'AT_HOTEL' },
                                stay: { checkIn: '2099-10-15', checkOut: '2099-10-17' },
                                occupancy: { rooms: 1, adults: 2, children: 0 },
                                price: { customerDisplay: { amount: '495.00', currency: 'AED' } },
                                cancellation: {
                                    refundability: 'conditional',
                                    schedule: [{
                                        startsAt: {
                                            source: '2099-10-14T18:30:00+04:00',
                                            utc: '2099-10-14T14:30:00.000Z',
                                            timezoneKnown: true
                                        },
                                        endsAt: null,
                                        penalty: { amount: '100.00', currency: 'AED' }
                                    }]
                                },
                                rateComments: [{ description: 'Direct fixture rate condition.' }],
                                contractTerms: { rateCommentsResolved: true, issues: [], mandatoryFacilities: [] },
                                taxes: { status: 'provided', allIncluded: true, items: [] },
                                promotions: []
                            }
                        };
                    } else if (url.pathname.endsWith('/v1/hotels/book') && method === 'POST') {
                        calls.directBookings.push({
                            body: JSON.parse(request.postData()),
                            authorization: request.headers().authorization
                        });
                        body = { success: true, bookingReference: 'HBX-DIRECT-FIXTURE-1', status: 'CONFIRMED' };
                    } else if (url.pathname === '/api/owned/bookings/pdf/HBX-DIRECT-FIXTURE-1' && method === 'GET') {
                        calls.vouchers.push({ authorization: request.headers().authorization });
                        return request.respond({
                            status: 200,
                            headers: { 'Content-Type': 'application/pdf' },
                            body: Buffer.from('%PDF-1.4\n% Local UI voucher fixture\n%%EOF\n')
                        });
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
        const translationCoverage = await page.evaluate(async () => {
            const translations = await import('/src/i18n.jsx');
            return translations.validateNextgenTranslations();
        });
        assert.deepEqual(translationCoverage, {
            ar: { missing: [], unexpected: [] },
            en: { missing: [], unexpected: [] },
            es: { missing: [], unexpected: [] }
        });
        await page.select('#language-select', 'es');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');
        assert.equal(await page.evaluate(() => document.body.dataset.language), 'es');
        assert.match(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /Selector de hoteles piloto de Hotelbeds/);
        assert.doesNotMatch(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /Try the new mock hotels experience/);
        await page.select('#language-select', 'ar');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar');
        assert.match(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /اختيار فنادق Pilot لـHotelbeds/);
        assert.doesNotMatch(await page.$eval('[data-next-gen-hotels]', element => element.innerText), /Hotelbeds Pilot Hotel Selector/);
        await page.select('#language-select', 'en');
        await page.waitForFunction(() => document.body.dataset.language === 'en');
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
        assert.doesNotMatch(resultText, /Buscando ofertas de hotel/);
        assert.doesNotMatch(resultText, /Buscar ahora/);
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

        // Exercise the separately gated direct flow using a server-shaped local
        // fixture. The rateType projection itself is covered by the backend test.
        await page.evaluate(({ directPublicOfferId, accessToken }) => {
            sessionStorage.setItem('rimal_user_access_token', accessToken);
            sessionStorage.setItem('remal_nextgen_selected_offer', JSON.stringify({
                provider: 'hotelbeds',
                mock: false,
                publicOfferId: directPublicOfferId,
                termsVersion: 'e'.repeat(64),
                paymentFlow: 'PAY_AT_PROPERTY',
                availability: { rateType: 'BOOKABLE' },
                stay: { checkIn: '2099-10-15', checkOut: '2099-10-17' },
                occupancy: { rooms: 1, adults: 2, children: 0 },
                price: { amount: '495.00', currency: 'AED' },
                hotel: { name: 'Direct fixture hotel' },
                room: { name: 'Direct fixture double room' }
            }));
            history.pushState({}, '', '/next-gen/checkout');
            window.dispatchEvent(new PopStateEvent('popstate'));
        }, { directPublicOfferId, accessToken });
        await page.waitForFunction(() => location.pathname === '/next-gen/checkout');
        await page.waitForSelector('[data-direct-booking-flow]');
        assert.equal(calls.rateReviews.length, 0, 'rate review requires an explicit customer action');
        assert.equal(calls.directBookings.length, 0, 'booking is not submitted before review and consent');
        await page.click('[data-request-rate-review]');
        await page.waitForSelector('input[name="directAcceptedTerms"]');
        assert.equal(calls.rateReviews.length, 1);
        assert.equal(calls.rateReviews[0].body.publicOfferId, directPublicOfferId);
        assert.match(calls.rateReviews[0].idempotencyKey, /^[A-Za-z0-9_-]{16,128}$/);
        assert.equal(calls.rateReviews[0].authorization, `Bearer ${accessToken}`);
        assert.match(await page.$eval('[data-direct-booking-flow]', element => element.innerText), /Direct fixture rate condition/);
        assert.equal(await page.$eval('[data-submit-direct-booking]', button => button.disabled), true);
        await page.click('input[name="directAcceptedTerms"]');
        assert.equal(await page.$eval('[data-submit-direct-booking]', button => button.disabled), false);
        await page.type('input[name="firstName"]', 'Ada');
        await page.type('input[name="lastName"]', 'Lovelace');
        await page.type('input[name="email"]', 'ada@example.test');
        await page.type('input[name="additionalGuests.0.firstName"]', 'Grace');
        await page.type('input[name="additionalGuests.0.lastName"]', 'Hopper');
        await page.evaluate(() => {
            const form = document.querySelector('[data-direct-booking-flow] form');
            const first = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(first);
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        await page.waitForSelector('[data-direct-booking-result="confirmed"]');
        assert.equal(calls.directBookings.length, 1);
        assert.equal(calls.directBookings[0].authorization, `Bearer ${accessToken}`);
        assert.equal(calls.directBookings[0].body.publicOfferId, directPublicOfferId);
        assert.equal(calls.directBookings[0].body.termsAccepted, true);
        assert.equal(calls.directBookings[0].body.acceptedTermsVersion, 'f'.repeat(64));
        assert.equal(calls.directBookings[0].body.reviewId, '123e4567-e89b-42d3-a456-426614174000');
        assert.equal(calls.directBookings[0].body.guestDetails.rooms[0].guests.length, 2);
        assert.equal(Object.keys(calls.directBookings[0].body).some(key => /ratekey|token/i.test(key)), false);
        assert.equal(await page.$eval('[data-download-booking-voucher]', button => button.disabled), false);
        const voucherResponsePromise = page.waitForResponse(response =>
            new URL(response.url()).pathname === '/api/owned/bookings/pdf/HBX-DIRECT-FIXTURE-1');
        await page.click('[data-download-booking-voucher]');
        const voucherResponse = await voucherResponsePromise;
        assert.equal(voucherResponse.status(), 200);
        assert.match(voucherResponse.headers()['content-type'], /application\/pdf/i);
        assert.equal(calls.vouchers.length, 1);
        assert.equal(calls.vouchers[0].authorization, `Bearer ${accessToken}`);

        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForFunction(() => location.pathname === '/next-gen/checkout');
        await page.waitForSelector('[data-direct-booking-locked]');
        assert.equal(calls.directBookings.length, 1, 'a reload must not allow a duplicate booking POST');
        assert.deepEqual(pageErrors, []);
        console.log('PASS: UI-only intercepted API fixture flow, three-language dictionaries, mock checkout, direct review/consent, confirmed result, authenticated voucher request, one-time booking, reload quarantine, 429 cooldown, and 503/403 UX.');
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
