const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const base = process.env.REMAL_UI_TEST_BASE || 'http://127.0.0.1:5178';
const checkoutReference = '11111111-1111-4111-8111-111111111111';
const accessToken = 'a'.repeat(64);
const affiliateProcessId = 'f'.repeat(64);
const affiliateAccessToken = 'd'.repeat(64);
const rate = (amount, currency = 'USD') => ({
    book_hash: `test-${currency}-${amount}`, room_name: 'Test Double Room', meal: 'breakfast',
    payment_options: { payment_types: [{ type: 'deposit', amount: String(amount), currency_code: currency,
        cancellation_penalties: { free_cancellation_before: '2099-10-10T12:00:00', policies: [] },
        tax_data: { taxes: [{ name: 'Local tax', amount: '15', currency_code: 'AED', included_by_supplier: false }] }
    }] }
});
const hotels = [
    { hid: 1, name: 'Test Hotel 312', stars: 4, rates: [rate(312)], images: [`${base}/icon-512.png`] },
    { hid: 2, name: 'Test Hotel 60', stars: 3, rates: [rate(312), rate(1, 'AED'), rate(60)] },
    { hid: 3, name: 'Test Hotel 68', stars: 5, rates: [rate(68)] }
];
const search = { query: 'Dubai', destination: { label: 'Dubai', type: 'region', region_id: 6053839 }, checkin: '2099-10-15', checkout: '2099-10-17', guests: [{ adults: 2, children: [] }] };

async function run() {
    const { formatMoney, normalizeRoom } = await import('./frontend/src/services/offers.js');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    let lastSearch;
    let lastHotelPage;
    let paymentEnabled = false;
    let paymentRequests = 0;
    let paymentPayload;
    let affiliateBookingRequests = 0;
    let affiliateBookingPayload;
    let affiliateBookingStatusRequests = 0;
    let affiliateRateRequests = 0;
    let b2bPrebookRequests = 0;
    let checkoutStatus = 'booking_pending';
    let statusRequests = 0;
    let exchangeAvailable = true;
    let exchangeRequests = 0;
    const suggestionRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = new URL(request.url());
            if (url.pathname.includes('/api/')) {
                const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-api-key,authorization,idempotency-key,x-affiliate-status-token', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
                if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
                let body;
                if (url.pathname.endsWith('/display-rates')) {
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
                    body = { hotel: hotels[1], rates: [rate(60)] };
                }
                else if (url.pathname.endsWith('/affiliate/availability')) body = { search: true, booking: true };
                else if (url.pathname.endsWith('/affiliate/hotels/2/rates')) {
                    affiliateRateRequests++;
                    const criteria = JSON.parse(request.postData());
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
                else if (url.pathname.includes('/v1/hotels/')) body = { hotel: hotels[1] };
                else if (url.pathname.endsWith('/payment/availability')) body = { enabled: paymentEnabled };
                else if (url.pathname.endsWith(`/payment/ziina/${checkoutReference}/status`)) {
                    statusRequests++;
                    assert.equal(request.headers().authorization, `Bearer ${accessToken}`);
                    body = { reference: checkoutReference, status: checkoutStatus, confirmed: checkoutStatus === 'booking_confirmed',
                        ...(checkoutStatus === 'booking_confirmed' ? { supplier_reference: 'TEST-SUPPLIER-ORDER' } : {}) };
                }
                else if (url.pathname.endsWith('/payment/ziina/intent')) {
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
            if (url.origin === base || ['images.unsplash.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return request.continue();
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
        exchangeAvailable = false;
        await page.evaluate(() => localStorage.removeItem('remal_usd_display_rates'));
        await page.select('select[aria-label="عملة عرض السعر"]', 'USD');
        await page.select('select[aria-label="عملة عرض السعر"]', 'AED');
        await page.waitForFunction(() => document.querySelector('article')?.textContent.includes('سعر الصرف غير متاح'));
        assert((await page.$$eval('article', cards => cards.find(card => card.textContent.includes('Test Hotel 60'))?.textContent)).includes(formatMoney(60, 'USD')));
        exchangeAvailable = true;
        await page.select('select[aria-label="عملة عرض السعر"]', 'USD');
        await page.screenshot({ path: 'frontend/dist/test-desktop.png', fullPage: true });

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
        await page.waitForFunction(() => document.querySelectorAll('#results-heading article').length === 2);
        assert.equal(await page.$$eval('article', cards => cards.length), 2);
        const mobileResults = await page.$('#results-heading ul[aria-label]');
        assert(mobileResults, 'Expected semantic hotel results list');
        assert.equal(await page.$eval('#results-heading ul[aria-label]', list => getComputedStyle(list).scrollSnapType.includes('x')), true);
        assert.equal(await page.$$eval('#results-heading ul[aria-label] > li', items => items.length), 2);
        await page.screenshot({ path: 'frontend/dist/test-mobile.png', fullPage: true });
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
        const hotelSearch = { ...search, query: 'Test Hotel 60', guests: lastSearch.guests, destination: { type: 'hotel', hotel_id: 2, label: 'Test Hotel 60' } };
        await page.evaluate(value => sessionStorage.setItem('remal_search', JSON.stringify(value)), hotelSearch);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article');
        assert.deepEqual(lastSearch.hids, [2]);
        assert.equal(lastSearch.currency, 'USD');
        await page.click('#results-heading article a.cta-red');
        await page.waitForFunction(() => location.pathname.startsWith('/hotel/'));
        await page.waitForSelector('article[aria-labelledby^="room-"] button', { visible: true });
        assert.match(await page.title(), /Test Hotel 60/);
        assert.match(await page.$eval('link[rel="canonical"]', link => link.href), /\/hotel\/2\?lang=en$/);
        assert.equal(await page.$eval('html', element => element.lang), 'ar');
        assert.match(await page.$eval('main', element => element.textContent), /عن هذا المكان/);
        assert.deepEqual(await page.$$eval('link[rel="alternate"][data-remal-hreflang]', links => links.map(link => link.hreflang).sort()), ['en', 'x-default']);
        assert.equal(await page.$eval('main', element => element.innerText.includes('كاش باك')), false);
        assert.equal(lastHotelPage.currency, 'USD');
        assert(affiliateRateRequests > 0, 'Affiliate rates should be fetched through their separate endpoint');
        assert.equal(await page.$$eval('article[data-contract-source="affiliate"]', cards => cards.length), 1);
        assert.equal(await page.$$eval('article[data-contract-source="b2b"]', cards => cards.length), 1);
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
        assert.match(await page.$eval('main', element => element.textContent), /عملة العرض: USD/);
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
        await page.screenshot({ path: 'frontend/dist/test-checkout.png', fullPage: true });
        paymentEnabled = true;
        const mockGuestCount = [{ adults: 1, children: [] }];
        booking.guests = mockGuestCount;
        booking.room = normalizeRoom(rate(60, 'AED'), hotels[1], mockGuestCount);
        await page.evaluate(value => {
            sessionStorage.setItem('remal_checkout', JSON.stringify(value));
            sessionStorage.removeItem('remal_guest_draft');
        }, booking);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(value => document.querySelector('aside')?.textContent.includes(value), {}, formatMoney(60 / 3.6725, 'USD'));
        assert((await page.$eval('aside', element => element.textContent)).includes(formatMoney(60, 'AED')));
        await page.select('select[aria-label="عملة عرض السعر"]', 'EUR');
        await page.waitForFunction(value => document.querySelector('aside')?.textContent.includes(value), {}, formatMoney(60 / 3.6725 * 0.87088, 'EUR'));
        assert((await page.$eval('aside', element => element.textContent)).includes(formatMoney(60, 'AED')));
        await page.type('#guest-first-name', 'Local');
        await page.type('#guest-last-name', 'Test');
        await page.type('#guest-email', 'local@example.test');
        await page.type('#guest-phone', '+971501234567');
        await page.click('form input[type="checkbox"]');
        assert.equal(await page.$eval('button[type="submit"]', element => element.disabled), false);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => location.search.includes('payment=success'));
        assert.equal(paymentRequests, 1);
        assert.equal(paymentPayload.currency, 'AED');
        assert.equal(paymentPayload.total, 60);
        assert.equal(paymentPayload.book_hash, 'test-AED-60');
        assert.deepEqual(paymentPayload.guests, mockGuestCount);
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('بانتظار التحقق من الدفع والحجز'));
        assert.match(await page.$eval('main', element => element.innerText), /بانتظار التحقق من الدفع والحجز/);
        assert.doesNotMatch(await page.$eval('main', element => element.innerText), /تم تأكيد الحجز/);
        await page.waitForFunction(reference => document.querySelector('main')?.innerText.includes(reference), {}, checkoutReference);
        assert.match(await page.$eval('main', element => element.innerText), /مرجع المتابعة/);
        assert(statusRequests > 0);
        checkoutStatus = 'booking_confirmed';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('TEST-SUPPLIER-ORDER'));
        assert.match(await page.$eval('main', element => element.innerText), /TEST-SUPPLIER-ORDER/);
        assert.equal(paymentRequests, 1);
        paymentEnabled = false;
        await page.goto(`${base}/checkout?payment=success`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('main h1');
        const returned = await page.$eval('main', element => element.innerText);
        assert.match(returned, /بانتظار التحقق/);
        assert.doesNotMatch(returned, /تم الدفع بنجاح/);
        assert.equal(paymentRequests, 1);
        paymentEnabled = true;
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
        assert((await page.$eval('aside', element => element.textContent)).includes(formatMoney(60, 'USD')));
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
        await page.setOfflineMode(true);
        const workerTarget = browser.targets().find(target => target.type() === 'service_worker' && target.url().startsWith(base));
        assert(workerTarget);
        const workerSession = await workerTarget.createCDPSession();
        await workerSession.send('Network.enable');
        await workerSession.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        await page.goto(`${base}/offline-check`, { waitUntil: 'domcontentloaded' });
        assert.match(await page.$eval('h1', heading => heading.textContent), /غير متصل بالإنترنت/);
        await page.screenshot({ path: 'frontend/dist/test-offline.png', fullPage: true });
        console.log('PASS: install manifest, cached icons/offline page, no API or checkout caching, and offline navigation fallback.');
    } finally {
        await browser.close();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });