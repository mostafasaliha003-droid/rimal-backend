const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer');

const frontend = path.join(__dirname, 'frontend');
const backend = path.resolve(__dirname, '..', 'rimal-backend-search-fix-20261013');
const requireBackend = createRequire(path.join(backend, 'package.json'));
const express = requireBackend('express');
const ratehawkService = requireBackend('./services/ratehawkService');
const { validateRatehawkPublicSearchCriteria } = requireBackend('./services/ratehawkPublicSearchCriteria');

const hotel = { hid: 1, id: 'fixture-hotel-1', name: 'Local HTTP Fixture Hotel', city: 'Dubai', stars: 4, image: '', images: [], rates: [] };
const rate = {
    book_hash: 'local-fixture-book-hash',
    room_name: 'Local fixture room',
    meal: 'Breakfast included',
    payment_options: { payment_types: [{ type: 'deposit', amount: '150', currency_code: 'USD' }] }
};
const fixtureState = { suggestions: [], searches: [], hotelpages: [], blockedOperations: [] };
const originals = new Map();
let apiServer;
let viteServer;
let browser;

function replaceClientMethod(name, implementation) {
    originals.set(name, ratehawkService.client[name]);
    ratehawkService.client[name] = implementation;
}

function createLocalApi() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '32kb' }));
    app.get('/api/display-rates', (_req, res) => res.json({
        success: true, date: new Date().toISOString().slice(0, 10),
        rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 }
    }));

    app.get('/api/search/suggest', async (req, res) => {
        const { query, language = 'en' } = req.query;
        const displayLanguage = req.query.display_language || language;
        if (typeof query !== 'string' || !query.trim() || query.length > 160) {
            return res.status(400).json({ success: false, error: 'INVALID_QUERY' });
        }
        fixtureState.suggestions.push({ query, language, displayLanguage });
        try {
            const suggestions = await ratehawkService.getAutocompleteSuggestions(query, language, displayLanguage);
            return res.json({ success: true, suggestions });
        } catch {
            return res.status(502).json({ success: false, error: 'SUGGESTIONS_UNAVAILABLE' });
        }
    });

    app.post('/api/search/rates', async (req, res) => {
        try {
            const criteria = validateRatehawkPublicSearchCriteria('hotel_ids', req.body, ratehawkService);
            fixtureState.searches.push({ kind: 'hotel_ids', criteria });
            return res.json({ success: true, ...await ratehawkService.searchLiveRates(criteria) });
        } catch (error) {
            return res.status(error.ratehawkError === 'invalid_params' ? 400 : 502).json({
                success: false,
                error: error.ratehawkError === 'invalid_params' ? 'INVALID_SEARCH_CRITERIA' : 'SEARCH_UNAVAILABLE'
            });
        }
    });

    app.post('/api/search/rates/region', async (req, res) => {
        try {
            const criteria = validateRatehawkPublicSearchCriteria('region', req.body, ratehawkService);
            fixtureState.searches.push({ kind: 'region', criteria });
            return res.json({ success: true, ...await ratehawkService.searchLiveRatesByRegion(criteria) });
        } catch (error) {
            return res.status(error.ratehawkError === 'invalid_params' ? 400 : 502).json({
                success: false,
                error: error.ratehawkError === 'invalid_params' ? 'INVALID_SEARCH_CRITERIA' : 'SEARCH_UNAVAILABLE'
            });
        }
    });

    app.post('/api/search/hotelpage', async (req, res) => {
        try {
            const criteria = validateRatehawkPublicSearchCriteria('hotelpage', req.body, ratehawkService);
            fixtureState.hotelpages.push(criteria);
            const result = await ratehawkService.validatedHotelPageRates(criteria);
            const hotels = Array.isArray(result) ? result : result?.hotels || [];
            return res.json({ success: true, hotels, hotel: hotels[0] || null, rates: hotels[0]?.rates || [] });
        } catch (error) {
            return res.status(error.ratehawkError === 'invalid_params' ? 400 : 502).json({
                success: false,
                error: error.ratehawkError === 'invalid_params' ? 'INVALID_HOTELPAGE_CRITERIA' : 'HOTELPAGE_UNAVAILABLE'
            });
        }
    });

    app.get('/api/v1/hotels/:hid', (req, res) => String(req.params.hid) === String(hotel.hid)
        ? res.json({ success: true, hotel })
        : res.status(404).json({ success: false }));
    app.get('/api/affiliate/availability', (_req, res) => res.json({ search: false, booking: false }));

    // Search/details only. Fail closed if the browser ever attempts an operation
    // that would prebook, create a booking, or initiate a payment.
    app.all(/^\/api\/(?:booking|payment|v1\/hotels\/book)(?:\/|$)/, (req, res) => {
        fixtureState.blockedOperations.push({ method: req.method, path: req.path });
        return res.status(403).json({ success: false, error: 'OUT_OF_SCOPE_TEST_OPERATION_BLOCKED' });
    });
    app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND' }));
    return app;
}

async function run() {
    const oldCwd = process.cwd();
    const pageErrors = [];
    const externalRequestsAborted = [];
    const externalResponses = [];
    try {
        assert(fs.existsSync(path.join(backend, 'package.json')), 'The isolated backend workspace must be next to the frontend workspace.');
        replaceClientMethod('suggestHotelAndRegion', async (query, language) => ({
            regions: [{ id: 6053839, name: query.toLowerCase().includes('dubai') ? 'Dubai' : query }],
            hotels: [], language
        }));
        replaceClientMethod('searchHotelsByRegion', async () => ({ hotels: [{ ...hotel, rates: [rate] }] }));
        replaceClientMethod('searchHotels', async () => ({ hotels: [{ ...hotel, rates: [rate] }] }));
        replaceClientMethod('getHotelPageRates', async () => ({ hotels: [{ ...hotel, rates: [rate] }] }));

        apiServer = createLocalApi().listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => {
            apiServer.once('listening', resolve);
            apiServer.once('error', reject);
        });
        const apiPort = apiServer.address().port;
        process.chdir(frontend);
        const requireFrontend = createRequire(path.join(frontend, 'package.json'));
        const { createServer } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
        const { default: configure } = await import(pathToFileURL(path.join(frontend, 'vite.config.js')).href);
        const config = configure({ command: 'serve', mode: 'development' });
        viteServer = await createServer({
            ...config, configFile: false, root: frontend,
            plugins: config.plugins.filter(plugin => plugin.name !== 'github-pages-fallback'),
            server: {
                host: '127.0.0.1', port: 0, open: false,
                proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } }
            },
            logLevel: 'warn'
        });
        await viteServer.listen();
        const base = `http://127.0.0.1:${viteServer.httpServer.address().port}`;
        const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        browser = await puppeteer.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });

        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        await page.setViewport({ width: 1440, height: 1000 });
        await page.setBypassServiceWorker(true);
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('response', response => {
            if (new URL(response.url()).origin !== base) externalResponses.push(new URL(response.url()).origin);
        });
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (new URL(request.url()).origin === base) return request.continue();
            externalRequestsAborted.push(new URL(request.url()).origin);
            return request.abort();
        });

        console.log('CHECK: browser search calls the local HTTP API and backend validation/service functions');
        await page.goto(`${base}/?lang=en`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#hotel-search-form');
        await page.type('#destination-search', 'Dubai');
        await page.waitForSelector('#destination-suggestions [role="option"]', { visible: true });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        const setInput = (selector, value) => page.$eval(selector, (input, nextValue) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, nextValue);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        await setInput('#search-checkin', '2027-10-15');
        await setInput('#search-checkout', '2027-10-17');
        await page.select('#search-residency', 'gb');
        await page.click('#search-submit');
        await page.waitForSelector('ul[aria-label] article a.cta-red', { visible: true });

        assert(fixtureState.suggestions.length > 0, 'Autocomplete must traverse HTTP and the backend service.');
        assert.equal(fixtureState.searches.length, 1, 'Exactly one SERP request must reach the backend HTTP route.');
        assert.equal(fixtureState.searches[0].kind, 'region');
        assert.equal(fixtureState.searches[0].criteria.region_id, 6053839);
        assert.equal(fixtureState.searches[0].criteria.residency, 'gb');

        console.log('CHECK: opening the result loads hotelpage rates through the local backend');
        await page.click('ul[aria-label] article a.cta-red');
        await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Local HTTP Fixture Hotel'));
        await page.waitForFunction(() => document.body.innerText.includes('Local fixture room'));
        assert(fixtureState.hotelpages.length > 0, 'Hotel details must call the hotelpage route.');
        assert(fixtureState.hotelpages.every(criteria => criteria.hid === 1 && criteria.residency === 'gb'),
            `Every hotelpage request must preserve the selected hotel and residency: ${JSON.stringify(fixtureState.hotelpages)}`);
        assert.deepEqual(fixtureState.blockedOperations, [], 'No prebook, booking, or payment request is in scope.');
        assert.deepEqual(externalResponses, [], 'External requests must not receive a network response.');
        assert.deepEqual(pageErrors, [], 'The page must not produce uncaught browser errors.');

        console.log('PASS: browser → Vite proxy → local HTTP API → validated backend service → mocked RateHawk → hotel details.');
        console.log(`PASS: ${externalRequestsAborted.length} optional external resource request(s) were blocked; no live supplier was contacted.`);
        console.log('LIMIT: supplier responses are local deterministic fixtures, not a live RateHawk test.');
    } finally {
        await browser?.close();
        if (viteServer) await viteServer.close();
        if (apiServer?.listening) await new Promise(resolve => apiServer.close(resolve));
        for (const [name, implementation] of originals) ratehawkService.client[name] = implementation;
        process.chdir(oldCwd);
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});