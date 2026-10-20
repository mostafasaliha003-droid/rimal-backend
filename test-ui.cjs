const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');

const base = process.env.REMAL_UI_TEST_BASE || 'http://127.0.0.1:5178';
const configuredScreenshotDirectory = process.env.REMAL_UI_SCREENSHOT_DIR;
const checkoutReference = '11111111-1111-4111-8111-111111111111';
const accessToken = 'a'.repeat(64);
const userToken = 'e'.repeat(64);
const fixtureUser = { name: 'Local Test', email: 'local@example.test', points: 0 };
const affiliateProcessId = 'f'.repeat(64);
const affiliateAccessToken = 'd'.repeat(64);
const doubleClassification = { class: 3, quality: 2, sex: 0, bathroom: 2, bedding: 3, family: 0, capacity: 2, club: 0, bedrooms: 0, balcony: 0, view: 0, floor: 0 };
const rate = (amount, currency = 'USD') => ({
    book_hash: `test-${currency}-${amount}`, room_name: 'Test Double Room', meal: 'breakfast',
    rg_ext: doubleClassification,
    payment_options: { payment_types: [{ type: 'deposit', amount: String(amount), currency_code: currency,
        cancellation_penalties: { free_cancellation_before: '2099-10-10T12:00:00', policies: [] },
        tax_data: { taxes: [{ name: 'Local tax', amount: '15', currency_code: 'AED', included_by_supplier: false }] }
    }] }
});
const hotels = [
    { hid: 1, name: 'Test Hotel 312', stars: 4, rates: [rate(312)], images: [`${base}/missing-hotel-photo.jpg`, `${base}/icon-512.png`] },
    { hid: 2, name: 'Test Hotel 60', stars: 3, rates: [rate(312), rate(1, 'AED'), rate(60)] },
    { hid: 3, name: 'Test Hotel 68', stars: 5, rates: [rate(68)] }
];
const search = { query: 'Dubai', destination: { label: 'Dubai', type: 'region', region_id: 6053839 }, checkin: '2027-10-15', checkout: '2027-10-17', guests: [{ adults: 2, children: [] }], residency: 'ae' };

async function run() {
    const { formatMoney, normalizeRoom } = await import('./frontend/src/services/offers.js');
    let browser;
    let screenshotDirectory;
    let ownsScreenshotDirectory = false;
    const errors = [];
    let lastSearch;
    let lastHotelPage;
    let lastAffiliateHotelPage;
    let paymentEnabled = false;
    let paymentRequests = 0;
    let paymentUnauthorized = false;
    let rejectedPaymentRequests = 0;
    let paymentPayload;
    let affiliateBookingRequests = 0;
    let affiliateBookingPayload;
    let affiliateBookingStatusRequests = 0;
    let affiliateRateRequests = 0;
    let b2bPrebookRequests = 0;
    let checkoutStatus = 'booking_pending';
    let voucherDelivery = 'pending';
    let profileBookings = [];
    let cancellationRequests = 0;
    let cancellationPolicyRequests = 0;
    let cancellationStatusRequests = 0;
    let cancellationReceiptRequests = 0;
    let statusRequests = 0;
    let exchangeAvailable = true;
    let exchangeRequests = 0;
    let googleReviewsRequests = 0;
    const suggestionRequests = [];
    try {
        screenshotDirectory = configuredScreenshotDirectory
            || await fs.mkdtemp(path.join(os.tmpdir(), 'remal-ui-screenshots-'));
        ownsScreenshotDirectory = !configuredScreenshotDirectory;
        await fs.mkdir(screenshotDirectory, { recursive: true });
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = new URL(request.url());
            if (url.pathname.includes('/api/')) {
                const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-api-key,authorization,idempotency-key,x-affiliate-status-token', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
                if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
                let body;
                if (url.pathname.endsWith('/auth/login')) {
                    body = { success: true, user: fixtureUser, access_token: userToken };
                }
                else if (url.pathname.endsWith('/auth/session')) {
                    if (request.headers().authorization !== `Bearer ${userToken}`) return request.respond({ status: 401, contentType: 'application/json', headers, body: JSON.stringify({ error: 'unauthorized' }) });
                    body = { success: true, user: fixtureUser };
                }
                else if (url.pathname.endsWith('/user/profile')) body = { success: true, profile: fixtureUser, bookings: profileBookings };
                else if (url.pathname.endsWith('/owned/bookings/fixture-cancellation/cancellation/receipt')) {
                    cancellationReceiptRequests++;
                    assert.equal(request.headers().authorization, `Bearer ${userToken}`);
                    return request.respond({ status: 200, contentType: 'application/pdf', headers, body: '%PDF-1.4\nfixture cancellation receipt\n%%EOF' });
                }
                else if (url.pathname.endsWith('/owned/bookings/fixture-cancellation/cancellation/status')) {
                    cancellationStatusRequests++;
                    body = { status: 'cancelled', success: true, customer_refund_status: cancellationStatusRequests > 1 ? 'completed' : 'pending',
                        customer_refund: { amount: '330.52', currency_code: 'AED' }, cancellation_reference: 'CAN-FIXTURE', receipt_status: cancellationStatusRequests > 1 ? 'sent' : 'pending' };
                }
                else if (url.pathname.endsWith('/owned/bookings/fixture-cancellation/cancellation')) {
                    assert.equal(request.headers().authorization, `Bearer ${userToken}`);
                    if (request.method() === 'POST') {
                        cancellationRequests++;
                        assert.deepEqual(JSON.parse(request.postData()), { confirm_cancellation: true, quote_token: 'fixture-cancellation-quote' });
                        body = { status: 'cancelled', success: true, customer_refund_status: 'pending' };
                    } else if (++cancellationPolicyRequests === 1) body = { mode: 'checking', retry_after_ms: 3000 };
                    else body = { mode: 'automatic', policy: 'Fixture supplier cancellation policy',
                        fee: { amount: '36.73', currency_code: 'AED' }, refund: { amount: '330.52', currency_code: 'AED' },
                        quote_token: 'fixture-cancellation-quote', expires_at: Date.now() + 300000 };
                }
                else if (url.pathname.endsWith('/display-rates')) {
                    exchangeRequests++;
                    if (!exchangeAvailable) return request.respond({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ success: false, error: 'DISPLAY_RATES_UNAVAILABLE' }) });
                    body = { success: true, date: new Date().toISOString().slice(0, 10), rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 } };
                }
                else if (url.pathname.endsWith('/search/suggest')) {
                    suggestionRequests.push(url.searchParams.get('language'));
                    const query = url.searchParams.get('query');
                    if (query === 'Unavailable') return request.respond({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ success: false, error: 'SUGGESTIONS_UNAVAILABLE' }) });
                    body = { success: true, suggestions: { hotels: [], regions: query === 'No matches' ? [] : [{ id: 6053839, name: 'Dubai' }] } };
                }
                else if (url.pathname.endsWith('/search/rates/region') || url.pathname.endsWith('/search/rates')) {
                    lastSearch = JSON.parse(request.postData());
                    if (lastSearch.currency !== 'USD') return request.respond({ status: 400, contentType: 'application/json', headers, body: JSON.stringify({ success: false, error: 'INVALID_SEARCH_CRITERIA', message: 'unknown currency' }) });
                    body = { hotels: lastSearch.hids ? hotels.filter(hotel => lastSearch.hids.includes(hotel.hid)) : hotels };
                }
                else if (url.pathname.endsWith('/search/hotelpage')) {
                    lastHotelPage = JSON.parse(request.postData());
                    if (lastHotelPage.currency !== 'USD') return request.respond({ status: 400, contentType: 'application/json', headers, body: JSON.stringify({ success: false, error: 'INVALID_HOTELPAGE_CRITERIA', message: 'unknown currency' }) });
                    body = { hotel: { ...hotels[1], name: 'Hotel', images: [`${base}/icon-192.png?photo=live`] }, rates: [
                        rate(60), { ...rate(70), meal: 'nomeal' },
                        { ...rate(80), room_name: 'Supplier Twin Room', rg_ext: { ...doubleClassification, bedding: 4 } }
                    ] };
                }
                else if (url.pathname.endsWith('/affiliate/availability')) body = { search: true, booking: true };
                else if (url.pathname.endsWith('/affiliate/hotels/2/rates')) {
                    affiliateRateRequests++;
                    const criteria = JSON.parse(request.postData());
                    lastAffiliateHotelPage = criteria;
                    assert.equal(criteria.currency, 'USD');
                    body = { success: true, rates: [{
                        book_hash: 'affiliate-hotel-rate', room_name: 'Test Hotel Double Room', meal: 'breakfast',
                        contract_source: 'affiliate', display_amount: '80.00', display_currency: 'USD',
                        affiliate_offer_token: 'signed.affiliate-fixture', affiliate_booking_enabled: true,
                        payment_options: { payment_types: [{ type: 'hotel', amount: '75.00', currency_code: 'AED',
                            show_amount: '80.00', show_currency_code: 'USD', is_need_credit_card_data: false }] }
                    }] };
                }
                else if (url.pathname.endsWith('/booking/prebook')) {
                    b2bPrebookRequests++;
                    const prebook = JSON.parse(request.postData());
                    assert.match(prebook.hash, /^test-(?:USD|AED)-60$/);
                    body = { success: true, rate: rate(60), bookHash: 'test-USD-60' };
                }
                else if (url.pathname.endsWith('/affiliate/bookings')) {
                    affiliateBookingRequests++;
                    affiliateBookingPayload = JSON.parse(request.postData());
                    assert.match(request.headers()['idempotency-key'], /^[a-f\d-]{36}$/);
                    assert.equal(affiliateBookingPayload.contract_source, 'affiliate');
                    assert.equal(affiliateBookingPayload.affiliate_offer_token, 'signed.affiliate-fixture');
                    body = { process_id: affiliateProcessId, access_token: affiliateAccessToken, status: 'processing', confirmed: false };
                }
                else if (url.pathname.endsWith(`/affiliate/bookings/${affiliateProcessId}/status`)) {
                    affiliateBookingStatusRequests++;
                    assert.equal(request.headers()['x-affiliate-status-token'], affiliateAccessToken);
                    body = { process_id: affiliateProcessId, status: 'confirmed', confirmed: true, supplier_reference: 'TEST-AFFILIATE-ORDER' };
                }
                else if (url.pathname.endsWith('/reviews/google/availability')) body = { enabled: true };
                else if (url.pathname.endsWith('/reviews/ratehawk')) {
                    const offset = Number(url.searchParams.get('offset') || 0);
                    const reviews = Array.from({ length: 11 }, (_, index) => ({ id: String(index), author: `Fixture ETG Guest ${index}`,
                        rating: 10 - index, positive: 'Fixture positive stay feedback', negative: 'Fixture negative stay feedback',
                        publishedAt:'2026-10-01T12:00:00Z', roomName:'Supplier Double Room', nights:2 }));
                    body = { status:'ready', source:'ratehawk', environment:'sandbox', scale:10, resolvedLanguage:'en', googleAvailable:true,
                        summary:{score:5,count:11,ratedCount:11,categories:[{key:'cleanness',score:7,count:11}]}, total:11,
                        reviews:reviews.slice(offset, offset + 10), hasMore:offset === 0, nextOffset:Math.min(offset + 10, 11) };
                }
                else if (url.pathname.endsWith('/reviews/google')) {
                    googleReviewsRequests++;
                    assert.equal(url.searchParams.get('language'), 'ar');
                    body = { status: 'ready', source: 'google', rating: 4.3, count: 321, url: 'https://www.google.com/maps?cid=123&reviews=1',
                        reviews: [{ rating: 1, text: 'Fixture translated review', textLanguage: 'en', originalText: 'Fixture original review', originalLanguage: 'es',
                            publishedAt: '2026-10-01T12:00:00Z', visitDate: { year: 2026, month: 9 }, url: 'https://www.google.com/maps/reviews/fixture',
                            author: { name: 'Fixture Google Author', url: 'https://www.google.com/maps/contrib/fixture', photo: '' } }], attributions: [] };
                }
                else if (url.pathname.includes('/v1/hotels/')) body = { hotel: { ...hotels[1], images: Array.from({ length: 6 }, (_, index) => `${base}/icon-512.png?photo=${index}`), room_groups: [
                    { room_group_id: 90, name: 'Test Double Room', rg_ext: doubleClassification, images: [`${base}/missing-hotel-photo.jpg`, `${base}/icon-512.png?room=double`] },
                    { room_group_id: 91, name: 'Supplier Twin Room', rg_ext: { ...doubleClassification, bedding: 4 }, images: [`${base}/icon-512.png?room=twin`] }
                ] } };
                else if (url.pathname.endsWith('/payment/availability')) body = { enabled: paymentEnabled };
                else if (url.pathname.endsWith('/payment/quote')) {
                    const data = JSON.parse(request.postData());
                    assert.equal(request.headers().authorization, `Bearer ${userToken}`);
                    const rates = { USD: 1, AED: 3.6725, SAR: 3.75, KWD: 0.3068, BHD: 0.376, OMR: 0.384, QAR: 3.64, EUR: 0.87088, GBP: 0.77, INR: 83 };
                    body = { currency: data.payment_currency, amount: Math.round(data.total / rates[data.currency] * rates[data.payment_currency] * 100) / 100,
                        expires_at: Date.now() + 1200000, token: 'fixture-payment-quote' };
                }
                else if (url.pathname.endsWith(`/payment/ziina/${checkoutReference}/status`)) {
                    statusRequests++;
                    assert.equal(request.headers().authorization, `Bearer ${accessToken}`);
                    body = { reference: checkoutReference, status: checkoutStatus, confirmed: checkoutStatus === 'booking_confirmed',
                        ...(checkoutStatus === 'awaiting_payment' ? { payment_url: 'https://pay.ziina.com/test' } : {}),
                        ...(checkoutStatus === 'booking_confirmed' ? { supplier_reference: 'TEST-SUPPLIER-ORDER', voucher_delivery: voucherDelivery } : {}) };
                }
                else if (url.pathname.endsWith('/payment/ziina/intent')) {
                    if (paymentUnauthorized) {
                        rejectedPaymentRequests++;
                        paymentUnauthorized = false;
                        return request.respond({ status: 401, contentType: 'application/json', headers, body: JSON.stringify({ error: 'unauthorized' }) });
                    }
                    assert.equal(request.headers().authorization, `Bearer ${userToken}`);
                    paymentRequests++;
                    paymentPayload = JSON.parse(request.postData());
                    assert.match(request.headers()['idempotency-key'], /^[a-f\d-]{36}$/);
                    if (!paymentEnabled || !['AED', 'USD'].includes(paymentPayload.currency)) return request.respond({ status: 400, contentType: 'application/json', headers, body: JSON.stringify({ error: 'UNSUPPORTED_PAYMENT' }) });
                    body = { reference: checkoutReference, access_token: accessToken,
                        payment_url: `${base}/checkout?payment=success&ref=${checkoutReference}` };
                }
                else { paymentRequests++; return request.abort(); }
                return request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
            }
            // This suite exercises the local build with intercepted APIs. External
            // fonts and photos must not make navigation depend on the network.
            if (url.pathname === '/missing-hotel-photo.jpg') return request.respond({ status: 404, body: '' });
            if (url.origin === base) return request.continue();
            return request.abort();
        });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(base, { waitUntil: 'networkidle0' });
        assert.match(await page.title(), /Remal|رمال/);
        assert.match(await page.$eval('link[rel="canonical"]', link => link.href), /\?lang=ar$/);
        const destinationInput = await page.$('#destination-search');
        const fillDestination = async value => {
            await destinationInput.click({ clickCount: 3 });
            await destinationInput.press('Backspace');
            await destinationInput.type(value);
        };
        await fillDestination('No matches');
        await page.waitForFunction(() => document.querySelector('#search-error')?.textContent.includes('لا توجد وجهات'));
        await page.click('form button[type="submit"]');
        assert.match(await page.$eval('#search-error', element => element.textContent), /لا توجد وجهات/);
        assert.equal(await page.$('#destination-suggestions'), null);
        await fillDestination('Unavailable');
        await page.waitForFunction(() => document.querySelector('#search-error')?.textContent.includes('تعذر تحميل اقتراحات'));
        await page.click('form button[type="submit"]');
        assert.match(await page.$eval('#search-error', element => element.textContent), /تعذر تحميل اقتراحات/);
        await fillDestination('Du');
        await page.waitForSelector('#destination-suggestions [role="option"]', { visible: true });
        assert.equal(await page.$('#search-destination-error'), null);
        await page.click('#destination-suggestions [role="option"]');
        assert.equal(await page.$eval('#destination-search', element => element.value), 'Dubai');
        await page.click('form button[type="submit"]');
        assert.match(await page.$eval('#search-error', element => element.textContent), /اختر جنسية الضيف/);
        await page.select('#search-residency', 'gb');
        await page.click('form button[type="submit"]');
        assert.match(await page.$eval('#search-error', element => element.textContent), /حدد تاريخ الوصول والمغادرة/);
        assert(suggestionRequests.length >= 3);
        assert(suggestionRequests.every(language => language === 'ar'));
        console.log('PASS: fresh destination suggestions, real response envelope, selection, empty results, network errors and recovery.');
        await page.evaluate(value => sessionStorage.setItem('remal_search', JSON.stringify(value)), search);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article');
        assert.equal(await page.$$eval('article', cards => cards.length), 3);
        const resultCardChecks = await page.$$eval('#results-heading article', cards => cards.map(card => ({
            detailHref: card.querySelector('h3 a')?.getAttribute('href') || '',
            chooseHref: card.querySelector('a.cta-red')?.getAttribute('href') || '',
            text: card.textContent || ''
        })));
        assert(resultCardChecks.every(card => card.detailHref.startsWith('/hotel/')));
        assert(resultCardChecks.every(card => card.chooseHref.startsWith('/hotel/')));
        assert(resultCardChecks.every(card => !/Popular|Great Deal|سعر استثنائي|اختيار مناسب للمقارنة|عرض يستحق المراجعة/.test(card.text)));
        assert.equal(lastSearch.currency, 'USD');
        assert.equal(lastSearch.language, 'ar');
        assert.match(await page.$eval('header', element => element.textContent), /USD/);
        assert.match(await page.$eval('#search-filters label', element => element.textContent), /USD/);
        const lowest = await page.$eval('#results-heading', element => element.innerText);
        assert.match(lowest, /أقل إجمالي مطابق للفلاتر\s+Test Hotel 60/);
        await page.select('#results-heading select', 'price');
        assert.match(await page.$eval('article', element => element.innerText), /Test Hotel 60/);
        assert((await page.$eval('article', element => element.textContent)).includes(formatMoney(60, 'USD')));
        assert(!(await page.$eval('article', element => element.textContent)).includes(formatMoney(60, 'AED')));
        for (const [currency, multiplier] of [['AED', 3.6725], ['SAR', 3.75], ['EUR', 0.87088]]) {
            await page.select('select[aria-label="عملة عرض السعر"]', currency);
            await page.waitForFunction(value => document.querySelector('article')?.textContent.includes(value), {}, formatMoney(60 * multiplier, currency));
            const card = await page.$eval('article', element => element.textContent);
            assert(card.includes(formatMoney(60, 'USD')));
            assert.match(card, /تقديري.*سعر المورد/);
            assert.equal(lastSearch.currency, 'USD');
            assert.match(await page.$eval('#search-filters label', element => element.textContent), /USD/);
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article');
        assert.equal(await page.$eval('select[aria-label="عملة عرض السعر"]', element => element.value), 'EUR');
        assert(exchangeRequests > 0);
        await page.$eval('article[aria-labelledby="hotel-1"]', node => node.scrollIntoView());
        await page.waitForFunction(() => {
            const img = document.querySelector('article[aria-labelledby="hotel-1"] img');
            return img?.src.endsWith('/icon-512.png') && img.complete && img.naturalWidth > 0;
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        exchangeAvailable = false;
        await page.evaluate(() => localStorage.removeItem('remal_usd_display_rates'));
        await page.select('select[aria-label="عملة عرض السعر"]', 'USD');
        await page.select('select[aria-label="عملة عرض السعر"]', 'AED');
        await page.waitForFunction(() => document.querySelector('article')?.textContent.includes('سعر الصرف غير متاح'));
        assert((await page.$$eval('article', cards => cards.find(card => card.textContent.includes('Test Hotel 60'))?.textContent)).includes(formatMoney(60, 'USD')));
        exchangeAvailable = true;
        await page.select('select[aria-label="عملة عرض السعر"]', 'USD');
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-desktop.png'), fullPage: true });

        for (const width of [390, 320]) {
            await page.setViewport({ width, height: 844 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            assert.equal(overflow, false, `horizontal overflow at ${width}px`);
        }
        await page.setViewport({ width: 390, height: 844 });
        await page.click('[aria-controls="search-filters"]');
        assert.equal(await page.$eval('#search-filters', element => getComputedStyle(element).display !== 'none'), true);
        await page.$eval('#search-filters input[type="number"]', element => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(element, '70');
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('#search-filters input[type="number"]')?.value === '70');
        await page.waitForFunction(() => document.querySelectorAll('#results-heading ul[aria-label] article').length === 2);
        assert.equal(await page.$$eval('article', cards => cards.length), 2);
        const mobileResults = await page.$('#results-heading ul[aria-label]');
        assert(mobileResults, 'Expected semantic hotel results list');
        assert.equal(await page.$eval('#results-heading ul[aria-label]', list => getComputedStyle(list).scrollSnapType.includes('x')), true);
        assert.equal(await page.$$eval('#results-heading ul[aria-label] > li', items => items.length), 2);
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-mobile.png'), fullPage: true });
        const openGuestEditor = async () => {
            const guestButton = await page.$('#search-guests');
            if (guestButton) {
                await guestButton.click();
                return;
            }
            await page.click('[data-search-compact] button');
            await page.waitForSelector('dialog[open] #search-guests');
            await page.click('dialog[open] #search-guests');
        };
        const closeGuestEditor = async () => {
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('#search-guests-panel'));
        };
        await openGuestEditor();
        await page.select('select[aria-label="الأطفال في غرفة 1"]', '1');
        await page.select('select[aria-label="عمر الطفل 1 في غرفة 1"]', '5');
        await closeGuestEditor();
        await page.click('form button[type="submit"]');
        await page.waitForFunction(() => document.querySelector('#search-submit')?.disabled === false);
        assert.deepEqual(lastSearch.guests, [{ adults: 2, children: [5] }]);
        const hotelSearch = { ...search, query: 'Test Hotel 60', residency: 'gb', guests: lastSearch.guests, destination: { type: 'hotel', hotel_id: 2, label: 'Test Hotel 60' } };
        await page.evaluate(value => sessionStorage.setItem('remal_search', JSON.stringify(value)), hotelSearch);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article');
        assert.deepEqual(lastSearch.hids, [2]);
        assert.equal(lastSearch.currency, 'USD');
        assert.equal(lastSearch.residency, 'gb');
        await page.click('#results-heading article a.cta-red');
        await page.waitForFunction(() => location.pathname.startsWith('/hotel/'));
        await page.waitForSelector('article[aria-labelledby^="room-"] button', { visible: true });
        assert.match(await page.title(), /Test Hotel 60/);
        assert.match(await page.$eval('link[rel="canonical"]', link => link.href), /\/hotel\/2\?lang=en$/);
        assert.equal(await page.$eval('html', element => element.lang), 'ar');
        assert.match(await page.$eval('main', element => element.textContent), /عن هذا المكان/);
        assert.deepEqual(await page.$$eval('link[rel="alternate"][data-remal-hreflang]', links => links.map(link => link.hreflang).sort()), ['en', 'x-default']);
        assert.equal(await page.$eval('main', element => element.innerText.includes('كاش باك')), false);
        assert.match(await page.$eval('main h1', node => node.innerText), /Test Hotel 60/);
        await page.click('[data-open-hotel-gallery]');
        await page.waitForSelector('[data-hotel-gallery]');
        assert.equal(await page.$$eval('[data-hotel-gallery] nav button', nodes => nodes.length), 7, 'Retain all static photos and live photos');
        assert.equal(await page.$eval('[data-gallery-photo]', node => getComputedStyle(node).objectFit), 'contain');
        await page.keyboard.press('End');
        await page.waitForFunction(() => document.querySelector('[data-gallery-photo]')?.src.includes('photo=live'));
        await page.click('[data-gallery-next]');
        await page.waitForFunction(() => document.querySelector('[data-gallery-photo]')?.src.includes('photo=0'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-hotel-gallery]'));
        await page.waitForSelector('[data-ratehawk-rating]');
        assert.match(await page.$eval('[data-ratehawk-rating]', n => n.textContent), /5\.0/);
        assert.equal(await page.$$eval('[data-ratehawk-review]', nodes => nodes.length), 10);
        assert.match(await page.$eval('[data-ratehawk-review]', n => n.textContent), /Fixture negative stay feedback/);
        await page.$eval('[data-more-ratehawk-reviews]', n => n.scrollIntoView({block:'center',behavior:'instant'}));
        await page.click('[data-more-ratehawk-reviews]');
        await page.waitForFunction(() => document.querySelectorAll('[data-ratehawk-review]').length === 11);
        assert.match(await page.$eval('[data-ratehawk-review]:last-of-type', n => n.textContent), /0\.0/);
        await page.$eval('[data-google-review-option] summary', n => n.scrollIntoView({block:'center',behavior:'instant'}));
        await page.click('[data-google-review-option] summary');
        await page.waitForSelector('[data-load-google-reviews]', { visible:true });
        assert.equal(googleReviewsRequests, 0, 'Do not prefetch paid Google reviews before the visitor asks');
        await page.$eval('[data-load-google-reviews]', n => n.scrollIntoView({block:'center',behavior:'instant'}));
        await page.click('[data-load-google-reviews]');
        await page.waitForSelector('[data-google-rating]');
        assert.equal(googleReviewsRequests, 1);
        assert.match(await page.$eval('[data-google-rating]', n => n.textContent), /4\.3/);
        assert.match(await page.$eval('[data-google-review]', n => n.textContent), /Fixture Google Author/);
        assert.match(await page.$eval('[data-google-review]', n => n.textContent), /1\/5/, 'Never hide a negative review');
        assert.equal(await page.$eval('[data-google-review] a', n => n.href), 'https://www.google.com/maps/contrib/fixture');
        await page.click('[data-google-original]');
        await page.waitForFunction(() => document.querySelector('[data-google-review]')?.textContent.includes('Fixture original review'));
        assert.equal(await page.$eval('[data-google-all-reviews]', n => n.href), 'https://www.google.com/maps?cid=123&reviews=1');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(lastHotelPage.currency, 'USD');
        assert.equal(lastHotelPage.residency, 'gb');
        assert.equal(lastAffiliateHotelPage.residency, 'gb');
        assert(affiliateRateRequests > 0, 'Affiliate rates should be fetched through their separate endpoint');
        assert.equal(await page.$$eval('article[data-contract-source="affiliate"]', cards => cards.length), 1);
        assert.equal(await page.$$eval('article[data-contract-source="b2b"]', cards => cards.length), 3);
        assert.equal(await page.$$eval('[data-room-type]', groups => groups.length), 3, 'Separate room types and supplier contracts');
        assert.deepEqual(await page.$$eval('[data-room-type]', groups => groups.map(group => group.querySelectorAll('article').length)), [2, 1, 1]);
        await page.$eval('article[data-contract-source="b2b"]', card => card.scrollIntoView());
        await page.waitForFunction(() => {
            const image = document.querySelector('article[data-contract-source="b2b"] [data-room-photo]');
            return image?.src.includes('room=double') && image.complete && image.naturalWidth > 0;
        });
        assert.deepEqual(await page.$$eval('article[data-contract-source="b2b"] [data-room-photo]', images => images.map(image => new URL(image.src).searchParams.get('room'))), ['double', 'double', 'twin']);
        assert.equal(await page.$$eval('article[data-contract-source="affiliate"] [data-room-photo]', images => images.length), 0, 'No property photo is substituted for an unclassified room');
        assert.equal(await page.$eval('article[aria-labelledby^="room-"] button', element => element.disabled), false);
        assert((await page.$eval('article[aria-labelledby^="room-"]', element => element.textContent)).includes(formatMoney(60, 'USD')));
        assert.match(await page.$eval('article[aria-labelledby^="room-"]', element => element.textContent), /Local tax 15 AED/);
        await page.select('select[aria-label="عملة عرض السعر"]', 'SAR');
        await page.waitForFunction(value => document.querySelector('article[aria-labelledby^="room-"]')?.textContent.includes(value), {}, formatMoney(225, 'SAR'));
        assert.equal(await page.$eval('article[aria-labelledby^="room-"] button', element => element.disabled), false);
        assert.match(await page.$eval('article[aria-labelledby^="room-"]', element => element.textContent), /Local tax 15 AED/);
        await page.select('select[aria-label="عملة عرض السعر"]', 'USD');
        const booking = { hid: 2, hotelName: hotels[1].name, checkin: search.checkin, checkout: search.checkout, guests: hotelSearch.guests, room: normalizeRoom(rate(60), hotels[1], hotelSearch.guests) };
        paymentEnabled = false;
        await page.evaluate(value => sessionStorage.setItem('remal_checkout', JSON.stringify(value)), booking);
        await page.goto(`${base}/checkout`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#guest-first-name');
        assert.equal(await page.$eval('meta[name="robots"]', element => element.content), 'noindex,follow');
        assert.match(await page.$eval('link[rel="canonical"]', link => link.href), /\/checkout\?lang=ar$/);
        assert.equal(await page.$eval('button[type="submit"]', element => element.disabled), true);
        assert.equal(await page.$eval('[data-payment-currency]', element => element.value), 'AED');
        assert.doesNotMatch(await page.$eval('main', element => element.textContent), /عملة الخصم: الدرهم/);
        await page.$eval('form', form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await page.waitForSelector('#guest-first-name');
        assert.equal(paymentRequests, 0);
        paymentEnabled = false;
        booking.room = normalizeRoom(rate(60, 'AED'), hotels[1], hotelSearch.guests);
        await page.evaluate(value => sessionStorage.setItem('remal_checkout', JSON.stringify(value)), booking);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#guest-first-name');
        await page.type('#guest-first-name', 'Local');
        await page.type('#guest-last-name', 'Test');
        await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(await page.$eval('#guest-first-name', element => element.value), 'Local');
        assert.equal(await page.$eval('button[type="submit"]', element => element.disabled), true);
        assert.match(await page.$eval('main', element => element.innerText), /طفل، 5 سنوات/);
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-checkout.png'), fullPage: true });
        paymentEnabled = true;
        const mockGuestCount = [{ adults: 1, children: [] }];
        booking.guests = mockGuestCount;
        booking.room = normalizeRoom(rate(60, 'AED'), hotels[1], mockGuestCount);
        await page.evaluate(value => {
            sessionStorage.setItem('remal_checkout', JSON.stringify(value));
            sessionStorage.removeItem('remal_guest_draft');
        }, booking);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-payment-currency]');
        assert.equal(await page.$eval('[data-payment-currency]', element => element.value), 'AED');
        await page.select('select[aria-label="عملة عرض السعر"]', 'EUR');
        assert.equal(await page.$eval('[data-payment-currency]', element => element.value), 'AED');
        await page.type('#guest-first-name', 'Local');
        await page.type('#guest-last-name', 'Test');
        await page.type('#guest-email', 'local@example.test');
        await page.type('#guest-phone', '+971501234567');
        await page.click('form input[type="checkbox"]');
        assert.equal(await page.$eval('button[type="submit"]', element => element.disabled), false);
        await page.click('button[type="submit"]');
        await page.waitForSelector('[data-checkout-sign-in]');
        assert.equal(paymentRequests, 0, 'Missing authentication must not create a payment request');
        const signInAndReturn = async () => {
            await page.click('[data-checkout-sign-in]');
            await page.waitForSelector('input[type="password"]');
            await page.type('input[type="email"]', fixtureUser.email);
            await page.type('input[type="password"]', 'fixture-password');
            await page.click('form button');
            await page.waitForSelector('#guest-first-name');
            assert.equal(await page.$eval('#guest-first-name', element => element.value), 'Local');
            assert.equal(await page.$eval('#guest-email', element => element.value), fixtureUser.email);
            assert.equal(await page.evaluate(() => location.pathname), '/checkout');
            await page.click('form input[type="checkbox"]');
            await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.disabled === false);
        };
        await signInAndReturn();
        paymentUnauthorized = true;
        await page.click('button[type="submit"]');
        await page.waitForSelector('[data-checkout-sign-in]');
        assert.equal(rejectedPaymentRequests, 1);
        assert.equal(paymentRequests, 0, 'An expired session must not trigger another payment request');
        const savedOperationKey = await page.evaluate(() => sessionStorage.getItem('remal_checkout_idempotency_key'));
        assert.equal(await page.evaluate(() => sessionStorage.getItem('rimal_user_access_token')), null);
        await signInAndReturn();
        assert.equal(await page.evaluate(() => sessionStorage.getItem('remal_checkout_idempotency_key')), savedOperationKey);
        console.log('PASS: missing and expired checkout sessions require sign-in, preserve guest details and the operation key, and never retry payment automatically.');
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => location.search.includes('payment=success'));
        assert.equal(paymentRequests, 1);
        assert.equal(paymentPayload.currency, 'AED');
        assert.equal(paymentPayload.total, 60);
        assert.equal(paymentPayload.book_hash, 'test-AED-60');
        assert.deepEqual(paymentPayload.guests, mockGuestCount);
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('نعمل على تأكيد حجزك'));
        assert.match(await page.$eval('main', element => element.innerText), /نعمل على تأكيد حجزك/);
        assert.doesNotMatch(await page.$eval('main', element => element.innerText), /تم تأكيد الحجز/);
        await page.waitForFunction(reference => document.querySelector('main')?.innerText.includes(reference), {}, checkoutReference);
        assert.match(await page.$eval('main', element => element.innerText), /مرجع الطلب/);
        assert.equal(await page.$('[data-checkout-resume-payment]'), null);
        assert(statusRequests > 0);
        checkoutStatus = 'awaiting_payment';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-booking-live]');
        assert.match(await page.$eval('main h1', element => element.innerText), /جارٍ التحقق من طلبك/);
        assert.match(await page.$eval('main', element => element.innerText), /لا يلزمك أي إجراء الآن/);
        assert.doesNotMatch(await page.$eval('main', element => element.innerText), /checkout\.[a-zA-Z]+/);
        assert.equal(await page.$('[data-checkout-resume-payment]'), null);
        assert.equal(await page.$('a[href^="https://pay.ziina.com"]'), null);
        assert.equal(await page.$$eval('.booking-live__steps .is-done', nodes => nodes.length), 0, 'A return URL alone never verifies a payment');
        assert.equal(paymentRequests, 1);
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-awaiting-payment-mobile.png'), fullPage: true });
        const awaitingStatusRequests = statusRequests;
        checkoutStatus = 'booking_confirmed';
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('TEST-SUPPLIER-ORDER'), { timeout: 15000 });
        assert(statusRequests > awaitingStatusRequests, 'Return from Ziina continues checking automatically without reload or payment actions');
        assert.match(await page.$eval('main', element => element.innerText), /TEST-SUPPLIER-ORDER/);
        assert.equal(await page.$eval('[data-booking-live]', node => node.dataset.trackingState), 'confirmed');
        assert.equal(await page.$$eval('.booking-live__steps .is-done', nodes => nodes.length), 2);
        const confirmedStatusRequests = statusRequests;
        voucherDelivery = 'sent';
        await page.waitForSelector('[data-tracking-state="sent"]', { timeout: 15000 });
        assert(statusRequests > confirmedStatusRequests, 'Keep polling after confirmation until voucher email is sent');
        assert.equal(await page.$$eval('.booking-live__steps .is-done', nodes => nodes.length), 3);
        assert.doesNotMatch(await page.$eval('main', node => node.innerText), /tracking\.[a-zA-Z]+|checkout\.[a-zA-Z]+/);
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-live-confirmation-mobile.png'), fullPage: true });
        assert.equal(await page.$('[data-checkout-resume-payment]'), null);
        assert.equal(paymentRequests, 1);
        checkoutStatus = 'preflight_failed';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('العرض لم يعد متاحًا بهذا السعر'));
        const rejectedOffer = await page.$eval('main', element => element.innerText);
        assert.match(rejectedOffer, /لم تُنشأ عملية دفع لهذه المحاولة/);
        assert.doesNotMatch(rejectedOffer, /بانتظار التحقق/);
        assert.equal(paymentRequests, 1);
        console.log('PASS: a failed supplier preflight is terminal, explains no payment was created, and never starts another payment.');
        paymentEnabled = false;
        await page.goto(`${base}/checkout?payment=success`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('main h1');
        const returned = await page.$eval('main', element => element.innerText);
        assert.match(returned, /متابعة حالة طلبك/);
        assert.doesNotMatch(returned, /ستُحدَّث هذه الصفحة تلقائيًا|checkout\.[a-zA-Z]+/);
        assert.equal(await page.$('[data-checkout-resume-payment]'), null);
        assert.doesNotMatch(returned, /تم الدفع بنجاح/);
        assert.equal(paymentRequests, 1);
        paymentEnabled = true;
        await page.evaluate(() => sessionStorage.removeItem('remal_payment_attempt'));
        await page.goto(`${base}/checkout?payment=success&ref=${checkoutReference}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('main h1')?.innerText.includes('متابعة حالة طلبك'));
        const missingSessionStatus = await page.$eval('main', element => element.innerText);
        assert.match(missingSessionStatus, /المتصفح الذي بدأت منه الدفع/);
        assert.doesNotMatch(missingSessionStatus, /جارٍ التحقق من طلبك|ستُحدَّث هذه الصفحة تلقائيًا/);
        assert.equal(await page.$('[data-checkout-resume-payment]'), null);
        assert.equal(paymentRequests, 1);
        checkoutStatus = 'booking_pending';
        booking.room = normalizeRoom(rate(60), hotels[1], mockGuestCount);
        await page.evaluate(value => {
            sessionStorage.setItem('remal_checkout', JSON.stringify(value));
            sessionStorage.removeItem('remal_guest_draft');
            sessionStorage.removeItem('remal_checkout_idempotency_key');
            sessionStorage.removeItem('remal_payment_attempt');
        }, booking);
        await page.goto(`${base}/checkout`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#guest-first-name');
        await page.select('select[aria-label="عملة عرض السعر"]', 'AED');
        await page.waitForFunction(value => document.querySelector('aside')?.textContent.includes(value), {}, formatMoney(220.35, 'AED'));
        await page.select('[data-payment-currency]', 'KWD');
        await page.waitForFunction(value => document.querySelector('aside')?.textContent.includes(value), {}, formatMoney(18.41, 'KWD'));
        assert.equal(paymentRequests, 1, 'Changing currency must not create a payment');
        await page.select('[data-payment-currency]', 'SAR');
        await page.waitForFunction(value => document.querySelector('aside')?.textContent.includes(value), {}, formatMoney(225, 'SAR'));
        await page.select('[data-payment-currency]', 'AED');
        await page.waitForFunction(value => document.querySelector('aside')?.textContent.includes(value), {}, formatMoney(220.35, 'AED'));
        await page.type('#guest-first-name', 'Local');
        await page.type('#guest-last-name', 'Test');
        await page.type('#guest-email', 'local@example.test');
        await page.type('#guest-phone', '+971501234567');
        await page.click('form input[type="checkbox"]');
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => location.search.includes('payment=success'));
        assert.equal(paymentRequests, 2);
        assert.equal(paymentPayload.currency, 'USD');
        assert.equal(paymentPayload.total, 60);
        checkoutStatus = 'refund_completed';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('تم تأكيد الاسترداد'));
        console.log('PASS: USD supplier search, four display currencies, FX fallback, original tax currency, mobile layout, disabled checkout availability, simulated AED and USD supplier-currency intents, private pending/confirmed/refunded statuses and no browser errors.');

        const affiliateSearch = new URLSearchParams({ checkin: search.checkin, checkout: search.checkout,
            guests: JSON.stringify(mockGuestCount), lang: 'en' });
        const b2bPrebookCountBeforeAffiliate = b2bPrebookRequests;
        const ziinaIntentCountBeforeAffiliate = paymentRequests;
        await page.goto(`${base}/hotel/2?${affiliateSearch}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article[data-contract-source="affiliate"] button.cta-red:not([disabled])');
        await page.click('article[data-contract-source="affiliate"] button.cta-red:not([disabled])');
        await page.waitForFunction(() => location.pathname === '/checkout');
        await page.waitForSelector('#guest-first-name');
        await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.disabled === false);
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('remal_checkout') || 'null')?.room?.contract_source), 'affiliate');
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('remal_guest_draft') || 'null')?.key), 'affiliate:affiliate-hotel-rate');
        await page.type('#guest-first-name', 'Affiliate');
        await page.type('#guest-last-name', 'Guest');
        await page.type('#guest-email', 'affiliate@example.test');
        await page.type('#guest-phone', '+971501112233');
        await page.click('form input[type="checkbox"]');
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => location.search.includes('affiliate=pending'));
        assert.equal(affiliateBookingRequests, 1);
        assert.equal(affiliateBookingPayload.expected_price, '80');
        assert.equal(affiliateBookingPayload.expected_currency, 'USD');
        assert.equal(affiliateBookingPayload.rooms[0].guests[0].firstName, 'Affiliate');
        assert.equal(paymentRequests, ziinaIntentCountBeforeAffiliate, 'Affiliate must not create a Ziina payment intent');
        assert.equal(await page.evaluate(() => sessionStorage.getItem('remal_payment_attempt')), null);
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('TEST-AFFILIATE-ORDER'));
        assert.match(await page.$eval('main', element => element.innerText), /TEST-AFFILIATE-ORDER/);
        assert(affiliateBookingStatusRequests > 0);
        assert.equal(b2bPrebookRequests, b2bPrebookCountBeforeAffiliate, 'Affiliate must not issue a B2B prebook request');
        assert.deepEqual(errors, []);
        console.log('PASS: Affiliate Pay at Hotel carries its signed contract and guest details only to Affiliate booking/status routes, without Ziina or B2B booking calls.');
        profileBookings = [{ bookingReference: 'fixture-cancellation', hotelName: 'Cancellation Test Hotel',
            provider: 'ratehawk', status: 'active', supplierStatus: 'COMPLETED', price: 367.25, priceCurrency: 'AED',
            checkInDate: '2027-10-15', checkOutDate: '2027-10-17' }];
        await page.evaluate(({ fixtureUser, userToken }) => {
            localStorage.setItem('rimal_current_user', JSON.stringify(fixtureUser));
            sessionStorage.setItem('rimal_user_access_token', userToken);
        }, { fixtureUser, userToken });
        await page.goto(`${base}/bookings?lang=ar`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('main h1')?.innerText.includes('حجوزاتي'));
        assert.equal(await page.$('main input[type="email"]'), null);
        await page.click('button[aria-controls="mobile-navigation"]');
        await page.waitForSelector('#mobile-navigation [data-nav-bookings]');
        await page.click('#mobile-navigation [data-nav-bookings]');
        assert.equal(await page.$('#mobile-navigation'), null);
        assert.equal(new URL(page.url()).pathname, '/bookings');
        await page.waitForSelector('[data-booking-cancellation]');
        await page.click('[data-booking-cancellation]');
        await page.waitForSelector('[data-cancellation-policy-wait]');
        await page.waitForFunction(() => document.querySelector('[data-cancellation-policy-wait]')?.innerText.includes('نعيد التحقق تلقائيًا'));
        assert.equal(await page.$('[data-cancellation-confirm]'), null, 'No cancellation action before a verified supplier quote');
        assert.equal(cancellationRequests, 0);
        await page.waitForSelector('[data-cancellation-confirm]');
        assert.equal(cancellationPolicyRequests, 2, 'Slow supplier policy is checked automatically');
        assert.equal(await page.$eval('[data-cancellation-confirm]', node => node.disabled), true);
        assert.match(await page.$eval('dialog', node => node.innerText), /36.73|٣٦٫٧٣/);
        assert.match(await page.$eval('dialog', node => node.innerText), /330.52|٣٣٠٫٥٢/);
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-cancellation-review-mobile.png'), fullPage: true });
        assert.equal(cancellationRequests, 0);
        await page.click('dialog button[aria-label="إغلاق"]');
        assert.equal(cancellationRequests, 0, 'Opening or dismissing policy review never cancels');
        await page.click('[data-booking-cancellation]');
        await page.waitForSelector('[data-cancellation-accept]');
        await page.click('[data-cancellation-accept]');
        await page.$eval('[data-cancellation-confirm]', node => { node.click(); node.click(); });
        await page.waitForSelector('[data-cancellation-outcome][data-refund-state="pending"]');
        assert.match(await page.$eval('dialog', node => node.innerText), /طلب الاسترداد قيد المعالجة/);
        await page.evaluate(() => {
            const original = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
                if (this.download?.startsWith('Remal-Cancellation-')) { window.receiptFilename = this.download; return; }
                return original.call(this);
            };
        });
        await page.click('[data-cancellation-receipt]');
        await page.waitForFunction(() => window.receiptFilename === 'Remal-Cancellation-fixture-cancellation.pdf');
        assert.equal(cancellationReceiptRequests, 1);
        await page.waitForSelector('[data-cancellation-outcome][data-refund-state="completed"]', { timeout: 15000 });
        assert.match(await page.$eval('dialog', node => node.innerText), /أُرسلت قسيمة الإلغاء/);
        assert.equal(cancellationRequests, 1, 'Repeated clicks cannot submit duplicate cancellation requests');
        assert.doesNotMatch(await page.$eval('dialog', node => node.innerText), /cancel\.[a-zA-Z]+/);
        await page.click('dialog button[aria-label="إغلاق"]');
        console.log('PASS: owned cancellation fee and refund review, explicit consent, dismissal without mutation, duplicate-click protection and refund status.');
        await page.evaluate(() => sessionStorage.clear());
        await page.setBypassServiceWorker(false);
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#destination-search');
        await page.evaluate(() => navigator.serviceWorker.ready);
        const manifest = await page.evaluate(async () => {
            const url = document.querySelector('link[rel="manifest"]').href;
            return (await fetch(url)).json();
        });
        assert.equal(manifest.display, 'standalone');
        assert.equal(manifest.icons.length, 2);
        const cached = await page.evaluate(async () => {
            const names = await caches.keys();
            return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat();
        });
        assert(cached.includes('/offline.html'));
        assert(cached.includes('/icon-192.png'));
        assert.equal(cached.some(path => path.includes('/api/') || path.includes('/checkout')), false);
        const workerTarget = await browser.waitForTarget(target =>
            target.type() === 'service_worker' && target.url().startsWith(base), { timeout: 15000 });
        await page.setOfflineMode(true);
        const workerSession = await workerTarget.createCDPSession();
        await workerSession.send('Network.enable');
        await workerSession.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        await page.goto(`${base}/offline-check`, { waitUntil: 'domcontentloaded' });
        assert.match(await page.$eval('h1', heading => heading.textContent), /غير متصل بالإنترنت/);
        await page.screenshot({ path: path.join(screenshotDirectory, 'test-offline.png'), fullPage: true });
        console.log('PASS: install manifest, cached icons/offline page, no API or checkout caching, and offline navigation fallback.');
    } catch (error) {
        // Keep failures actionable without relying on Puppeteer's generic timeout stack.
        const pages = browser ? await browser.pages().catch(() => []) : [];
        const activePage = pages.at(-1);
        if (activePage && !activePage.isClosed()) {
            console.error('UI failure context:', await activePage.evaluate(() => ({
                path: location.pathname,
                destination: document.querySelector('#destination-search')?.value,
                feedback: document.querySelector('#search-error')?.textContent,
                title: document.title
            })).catch(() => ({ page: 'unavailable' })));
        }
        console.error('UI page errors:', errors);
        throw error;
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            if (ownsScreenshotDirectory && screenshotDirectory) {
                await fs.rm(screenshotDirectory, { recursive: true, force: true });
            }
        }
    }
}

module.exports = { run };

if (require.main === module) {
    run().catch(error => { console.error(error); process.exitCode = 1; });
}
