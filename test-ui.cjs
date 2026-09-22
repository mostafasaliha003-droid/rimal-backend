const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const base = 'http://127.0.0.1:5178';
const rate = amount => ({
    book_hash: `test-${amount}`, room_name: 'Test Double Room', meal: 'breakfast',
    payment_options: { payment_types: [{ type: 'deposit', amount: String(amount), currency_code: 'AED',
        cancellation_penalties: { free_cancellation_before: '2099-10-10T12:00:00', policies: [] },
        tax_data: { taxes: [{ name: 'Local tax', amount: '15', currency_code: 'AED', included_by_supplier: false }] }
    }] }
});
const hotels = [
    { hid: 1, name: 'Test Hotel 312', stars: 4, rates: [rate(312)], images: [`${base}/icon-512.png`] },
    { hid: 2, name: 'Test Hotel 60', stars: 3, rates: [rate(60)] },
    { hid: 3, name: 'Test Hotel 68', stars: 5, rates: [rate(68)] }
];
const search = { query: 'Dubai', destination: { label: 'Dubai', type: 'region', region_id: 6053839 }, checkin: '2099-10-15', checkout: '2099-10-17', guests: [{ adults: 2, children: [] }] };

async function run() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    let lastSearch;
    let paymentRequests = 0;
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
                if (url.pathname.endsWith('/search/suggest')) body = { regions: [{ id: 6053839, name: 'Dubai' }] };
                else if (url.pathname.endsWith('/search/rates/region')) { lastSearch = JSON.parse(request.postData()); body = { hotels }; }
                else if (url.pathname.endsWith('/search/hotelpage')) body = { hotel: hotels[1], rates: hotels[1].rates };
                else if (url.pathname.includes('/v1/hotels/')) body = { hotel: hotels[1] };
                else if (url.pathname.endsWith('/payment/availability')) body = { enabled: false };
                else { paymentRequests++; return request.abort(); }
                return request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
            }
            if (url.origin === base || ['images.unsplash.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return request.continue();
            return request.abort();
        });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(base, { waitUntil: 'networkidle0' });
        await page.evaluate(value => sessionStorage.setItem('remal_search', JSON.stringify(value)), search);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('article');
        assert.equal(await page.$$eval('article', cards => cards.length), 3);
        assert.equal(lastSearch.currency, 'AED');
        assert.equal(lastSearch.language, 'ar');
        const lowest = await page.$eval('#results-heading', element => element.innerText);
        assert.match(lowest, /أقل إجمالي مطابق للفلاتر\s+Test Hotel 60/);
        await page.select('#results-heading select', 'price');
        assert.match(await page.$eval('article', element => element.innerText), /Test Hotel 60/);
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
        await page.click('article button');
        await page.waitForFunction(() => location.pathname.startsWith('/hotel/'));
        await page.waitForSelector('article[aria-labelledby^="room-"] button', { visible: true });
        assert.equal(await page.$eval('main', element => element.innerText.includes('كاش باك')), false);
        await page.click('article[aria-labelledby^="room-"] button');
        await page.waitForFunction(() => location.pathname === '/checkout');
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
        console.log('PASS: AED search, lowest price, sorting, mobile filters, 320/390px layout, child ages, checkout recovery, disabled payments, unverified return and no browser errors.');
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