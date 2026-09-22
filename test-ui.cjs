const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const base = 'http://127.0.0.1:5178';
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
    const suggestionRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = new URL(request.url());
            if (url.pathname.includes('/api/')) {
                const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-api-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
                if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
                let body;
                if (url.pathname.endsWith('/search/suggest')) {
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
                else if (url.pathname.includes('/v1/hotels/')) body = { hotel: hotels[1] };
                else if (url.pathname.endsWith('/payment/availability')) body = { enabled: paymentEnabled };
                else { paymentRequests++; return request.abort(); }
                return request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
            }
            if (url.origin === base || ['images.unsplash.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return request.continue();
            return request.abort();
        });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(base, { waitUntil: 'networkidle0' });
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
        await page.waitForSelector('#destination-suggestions button', { visible: true });
        assert.equal(await page.$('#search-error'), null);
        await page.click('#destination-suggestions button');
        assert.equal(await page.$eval('#destination-search', element => element.value), 'Dubai');
        await page.click('form button[type="submit"]');
        assert.match(await page.$eval('#search-error', element => element.textContent), /حدد تاريخ الوصول والمغادرة/);
        assert(suggestionRequests.length >= 3);
        assert(suggestionRequests.every(language => language === 'ar'));
        console.log('PASS: fresh destination suggestions, real response envelope, selection, empty results, network errors and recovery.');
        await page.evaluate(value => sessionStorage.setItem('remal_search', JSON.stringify(value)), search);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('article');
        assert.equal(await page.$$eval('article', cards => cards.length), 3);
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
        await page.type('#search-filters input[type="number"]', '70');
        assert.equal(await page.$$eval('article', cards => cards.length), 2);
        await page.screenshot({ path: 'frontend/dist/test-mobile.png', fullPage: true });
        await page.click('form details summary');
        await page.select('select[aria-label="الأطفال في غرفة 1"]', '1');
        await page.select('select[aria-label="عمر الطفل 1 في غرفة 1"]', '5');
        await page.click('form details summary');
        await page.click('form button[type="submit"]');
        await page.waitForNetworkIdle();
        assert.deepEqual(lastSearch.guests, [{ adults: 2, children: [5] }]);
        const hotelSearch = { ...search, query: 'Test Hotel 60', guests: lastSearch.guests, destination: { type: 'hotel', hotel_id: 2, label: 'Test Hotel 60' } };
        await page.evaluate(value => sessionStorage.setItem('remal_search', JSON.stringify(value)), hotelSearch);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('article');
        assert.deepEqual(lastSearch.hids, [2]);
        assert.equal(lastSearch.currency, 'USD');
        await page.click('article button');
        await page.waitForFunction(() => location.pathname.startsWith('/hotel/'));
        await page.waitForSelector('article[aria-labelledby^="room-"] button', { visible: true });
        assert.equal(await page.$eval('main', element => element.innerText.includes('كاش باك')), false);
        assert.equal(lastHotelPage.currency, 'USD');
        assert.equal(await page.$eval('article[aria-labelledby^="room-"] button', element => element.disabled), true);
        assert((await page.$eval('article[aria-labelledby^="room-"]', element => element.textContent)).includes(formatMoney(60, 'USD')));
        assert.match(await page.$eval('article[aria-labelledby^="room-"]', element => element.textContent), /Local tax 15 AED/);
        const booking = { hid: 2, hotelName: hotels[1].name, checkin: search.checkin, checkout: search.checkout, guests: hotelSearch.guests, room: normalizeRoom(rate(60), hotels[1], hotelSearch.guests) };
        paymentEnabled = true;
        await page.evaluate(value => sessionStorage.setItem('remal_checkout', JSON.stringify(value)), booking);
        await page.goto(`${base}/checkout`, { waitUntil: 'networkidle0' });
        assert.equal(await page.$eval('button[type="submit"]', element => element.disabled), true);
        assert.match(await page.$eval('main', element => element.textContent), /عملة العرض: USD/);
        assert.doesNotMatch(await page.$eval('main', element => element.textContent), /عملة الخصم: الدرهم/);
        await page.$eval('form', form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await page.waitForNetworkIdle();
        assert.equal(paymentRequests, 0);
        paymentEnabled = false;
        booking.room = normalizeRoom(rate(60, 'AED'), hotels[1], hotelSearch.guests);
        await page.evaluate(value => sessionStorage.setItem('remal_checkout', JSON.stringify(value)), booking);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('#guest-first-name');
        await page.type('#guest-first-name', 'Local');
        await page.type('#guest-last-name', 'Test');
        await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(await page.$eval('#guest-first-name', element => element.value), 'Local');
        assert.equal(await page.$eval('button[type="submit"]', element => element.disabled), true);
        assert.match(await page.$eval('main', element => element.innerText), /طفل، 5 سنوات/);
        await page.screenshot({ path: 'frontend/dist/test-checkout.png', fullPage: true });
        await page.goto(`${base}/checkout?payment=success`, { waitUntil: 'networkidle0' });
        const returned = await page.$eval('main', element => element.innerText);
        assert.match(returned, /بانتظار التحقق/);
        assert.doesNotMatch(returned, /تم الدفع بنجاح/);
        assert.equal(paymentRequests, 0);
        assert.deepEqual(errors, []);
        console.log('PASS: USD region/hotel/room search, same-currency lowest price, original tax currency, sorting, mobile filters, 320/390px layout, child ages, blocked USD payment, AED checkout recovery, unverified return and no browser errors.');
        await page.evaluate(() => sessionStorage.clear());
        await page.setBypassServiceWorker(false);
        await page.goto(base, { waitUntil: 'networkidle0' });
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