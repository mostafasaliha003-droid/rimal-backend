const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const puppeteer = require('puppeteer');

const root = __dirname;
const frontend = path.join(root, 'frontend');
const storedSearch = {
    query: 'Dubai', destination: { type: 'region', region_id: 6053839, label: 'Dubai' },
    checkin: '2099-10-15', checkout: '2099-10-17', guests: [{ adults: 2, children: [] }]
};
const rate = { book_hash: 'test-room', room_name: 'Test room', payment_options: { payment_types: [{ type: 'deposit', amount: '150', currency_code: 'USD' }] } };

async function run() {
    const oldCwd = process.cwd();
    let server;
    let browser;
    let context;
    try {
        process.chdir(frontend);
        const requireFrontend = createRequire(path.join(frontend, 'package.json'));
        const { createServer } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
        const { default: configure } = await import(pathToFileURL(path.join(frontend, 'vite.config.js')).href);
        const config = configure({ command: 'serve', mode: 'development' });
        server = await createServer({ ...config, configFile: false, root: frontend,
            plugins: config.plugins.filter(plugin => plugin.name !== 'github-pages-fallback'),
            server: { host: '127.0.0.1', port: 0, proxy: {}, open: false }, logLevel: 'warn' });
        await server.listen();
        const base = `http://127.0.0.1:${server.httpServer.address().port}`;
        browser = await puppeteer.launch({ headless: true });
        const pageErrors = [];
        const requests = { suggestions: [], searches: [], failSuggestions: true, failSearch: false, searchDelay: 0 };

        const fresh = async ({ width = 1440, language = 'en', search = null } = {}) => {
            await context?.close();
            context = await browser.createBrowserContext();
            const page = await context.newPage();
            page.setDefaultTimeout(12000);
            await page.setViewport({ width, height: 1000 });
            await page.setBypassServiceWorker(true);
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.evaluateOnNewDocument(({ language, search }) => {
                localStorage.setItem('remal_language', language);
                if (search) sessionStorage.setItem('remal_search', JSON.stringify(search));
            }, { language, search });
            await page.setRequestInterception(true);
            page.on('request', async request => {
                try {
                    const url = new URL(request.url());
                    if (url.pathname.includes('/api/')) {
                        let body = {};
                        let status = 200;
                        if (url.pathname.endsWith('/search/suggest')) {
                            const query = url.searchParams.get('query');
                            requests.suggestions.push({ query, language: url.searchParams.get('language') });
                            if (query === 'Old') await delay(1000);
                            if (query === 'Unavailable' && requests.failSuggestions) status = 503;
                            body = { success: status === 200, suggestions: {
                                regions: query === 'No matches' ? [] : [{ id: 6053839, name: query === 'Old' ? 'Old response' : 'Dubai' }, { id: 2, name: 'Dubai Marina' }],
                                hotels: query === 'No matches' ? [] : [{ hid: 3, name: 'Dubai Hotel' }]
                            } };
                        } else if (url.pathname.endsWith('/search/rates/region') || url.pathname.endsWith('/search/rates')) {
                            requests.searches.push(JSON.parse(request.postData()));
                            if (requests.searchDelay) await delay(requests.searchDelay);
                            status = requests.failSearch ? 503 : 200;
                            body = { hotels: Array.from({ length: 12 }, (_, index) => ({ hid: index + 1, name: `Test Hotel ${index + 1}`, rates: [rate], stars: 4 })) };
                        }
                        return await request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
                    }
                    if (url.hostname === 'api.frankfurter.dev') return await request.respond({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
                    if (url.origin === base) return await request.continue();
                    await request.abort();
                } catch (error) {
                    // Aborted suggestion requests are expected; unexpected handler errors fail the test.
                    if (!/Invalid InterceptionId|Target closed|Session closed|already handled/i.test(error.message)) pageErrors.push(error.message);
                }
            });
            await page.goto(base, { waitUntil: 'networkidle0' });
            await page.waitForSelector('#hotel-search-form');
            await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
            return page;
        };
        const type = async (page, selector, value) => {
            await page.click(selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(selector, value);
        };
        const focusIs = async (page, id) => page.waitForFunction(value => document.activeElement?.id === value, {}, id);
        const noOverflow = async (page, label) => {
            const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
            assert(result.scroll <= result.width + 1, `${label}: page overflow ${JSON.stringify(result)}`);
        };

        console.log('CHECK: combobox, independent loading and per-field validation');
        let page = await fresh();
        await page.click('#search-submit');
        await focusIs(page, 'destination-search');
        assert.equal(await page.$eval('#destination-search', input => input.getAttribute('aria-invalid')), 'true');
        assert.equal(await page.$eval('#destination-search', input => input.getAttribute('aria-describedby')), 'search-destination-error');
        await type(page, '#destination-search', 'Du');
        assert.equal(await page.$eval('#search-submit', button => button.disabled), false);
        await page.waitForSelector('#destination-suggestions [role="option"]', { visible: true });
        assert.equal(await page.$eval('#destination-search', input => input.closest('label')), null);
        assert.equal(await page.$eval('#destination-suggestions', list => Boolean(list.closest('form'))), false);
        const beforeEnter = requests.searches.length;
        await page.keyboard.press('ArrowDown');
        await focusIs(page, 'destination-search');
        assert.equal(await page.$eval('#destination-search', input => document.getElementById(input.getAttribute('aria-activedescendant'))?.textContent.includes('Dubai')), true);
        await page.keyboard.press('Enter');
        assert.equal(requests.searches.length, beforeEnter, 'Selecting an option submitted the form');
        await page.waitForFunction(() => document.getElementById('destination-search').value === 'Dubai');
        await page.click('#search-submit');
        await focusIs(page, 'search-checkin');
        assert.equal(await page.$eval('#search-checkin', input => input.getAttribute('aria-invalid')), 'true');
        await page.keyboard.press('Escape');
        await type(page, '#destination-search', 'Du');
        await page.waitForSelector('#destination-suggestions', { visible: true });
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.$eval('#destination-search', input => document.getElementById(input.getAttribute('aria-activedescendant'))?.textContent.includes('Dubai Hotel')), true);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#destination-suggestions', { hidden: true });
        assert.equal(await page.$eval('#destination-search', input => input.value), 'Du');
        await page.keyboard.press('ArrowDown');
        await page.waitForSelector('#destination-suggestions', { visible: true });
        await page.keyboard.press('Tab');
        await page.waitForSelector('#destination-suggestions', { hidden: true });
        assert.notEqual(await page.evaluate(() => document.activeElement.id), 'destination-search');

        console.log('CHECK: stale responses, no results, retry and localization');
        await type(page, '#destination-search', 'Old');
        await page.waitForRequest(request => request.url().includes('query=Old'));
        await type(page, '#destination-search', 'Du');
        await page.waitForSelector('#destination-suggestions', { visible: true });
        await delay(1100);
        assert(!(await page.$eval('#destination-suggestions', list => list.textContent)).includes('Old response'));
        await type(page, '#destination-search', 'No matches');
        await page.waitForFunction(() => document.getElementById('search-error')?.textContent.includes('No matching'));
        assert.equal(await page.$('#destination-suggestions'), null);
        await type(page, '#destination-search', 'Unavailable');
        await page.waitForFunction(() => document.getElementById('search-error')?.textContent.includes('Could not load'));
        requests.failSuggestions = false;
        await page.click('#search-error button');
        await page.focus('#destination-search');
        await page.waitForSelector('#destination-suggestions', { visible: true });
        await page.select('#language-select', 'ar');
        await type(page, '#destination-search', 'Dubai');
        await page.waitForSelector('#destination-suggestions', { visible: true });
        assert(requests.suggestions.some(request => request.language === 'ar'));
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        console.log('PASS: combobox and suggestion lifecycle.');

        console.log('CHECK: dates, guests, request locking and error retry');
        page = await fresh({ search: storedSearch });
        await type(page, '#search-checkin', '2099-10-20');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.getElementById('search-checkout').value === '2099-10-21');
        await type(page, '#search-checkout', '2099-02-30');
        await page.keyboard.press('Escape');
        const invalidBefore = requests.searches.length;
        await page.click('#search-submit');
        await focusIs(page, 'search-checkout');
        assert.equal(requests.searches.length, invalidBefore);
        await page.keyboard.press('Escape');
        await type(page, '#search-checkout', '2099-10-23');
        await page.keyboard.press('Escape');
        await page.click('#search-guests');
        await page.waitForSelector('#search-guests-panel', { visible: true });
        await page.select('#guests-0-children', '1');
        await page.keyboard.press('Escape');
        await focusIs(page, 'search-guests');
        await page.click('#search-submit');
        await page.waitForSelector('#search-guests-error');
        await focusIs(page, 'search-guests');
        await page.click('#search-guests');
        await page.select('#guests-0-age-0', '0');
        await page.keyboard.press('Escape');
        requests.searchDelay = 1000;
        const before = requests.searches.length;
        await page.click('#search-submit');
        await page.waitForFunction(() => document.getElementById('search-submit').disabled);
        await page.$eval('#hotel-search-form', form => { form.requestSubmit(); form.requestSubmit(); });
        await page.waitForFunction(() => !document.getElementById('search-submit').disabled);
        assert.equal(requests.searches.length, before + 1);
        assert.deepEqual(requests.searches.at(-1).guests, [{ adults: 2, children: [0] }]);
        assert.equal(requests.searches.at(-1).checkin, '2099-10-20');
        requests.failSearch = true;
        requests.searchDelay = 0;
        await page.click('#search-submit');
        await page.waitForFunction(() => !document.getElementById('search-submit').disabled && document.getElementById('search-error'));
        assert.equal(await page.$eval('#destination-search', input => input.value), 'Dubai');
        requests.failSearch = false;
        await page.click('#search-submit');
        await page.waitForFunction(() => !document.getElementById('search-submit').disabled && !document.getElementById('search-error'));
        console.log('PASS: valid dates/guests, duplicate prevention and retry.');

        console.log('CHECK: responsive layout, sticky behavior and reduced motion');
        for (const language of ['ar', 'en', 'es']) {
            await page.select('#language-select', language);
            for (const width of [320, 360, 390, 768, 1024, 1280, 1440]) {
                await page.setViewport({ width, height: 1000 });
                await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
                await page.waitForSelector('#hotel-search-form', { visible: true });
                await delay(100);
                await noOverflow(page, `${language}/${width}`);
                const fields = await page.$$eval('#hotel-search-form input, #search-guests, #search-submit', elements => elements.map(element => {
                    const rect = element.getBoundingClientRect();
                    return { id: element.id, width: rect.width, left: rect.left, right: rect.right };
                }));
                assert(fields.every(field => field.left >= 0 && field.right <= width + 1 && field.width >= 45), `Clipped fields: ${JSON.stringify(fields)}`);
            }
        }
        await page.setViewport({ width: 1440, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-search-shell]').offsetTop + 250));
        await delay(150);
        assert.equal(await page.$eval('[data-search-shell]', element => getComputedStyle(element).position), 'sticky');
        assert(Math.abs(await page.$eval('[data-search-shell]', element => element.getBoundingClientRect().top)) < 2);
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        const reducedMotionSuggestions = page.waitForRequest(request => {
            try {
                const url = new URL(request.url());
                return url.pathname.endsWith('/search/suggest') && url.searchParams.get('query') === 'Du';
            } catch {
                return false;
            }
        });
        await type(page, '#destination-search', 'Du');
        await page.waitForFunction(() => document.getElementById('destination-search')?.value === 'Du');
        await reducedMotionSuggestions;
        await page.waitForFunction(() => {
            const option = document.querySelector('#destination-suggestions [role="option"]');
            const popover = option?.closest('.search-popover');
            if (!option || !popover) return false;
            const optionStyle = getComputedStyle(option);
            const popoverStyle = getComputedStyle(popover);
            const rect = option.getBoundingClientRect();
            return optionStyle.display !== 'none' && optionStyle.visibility !== 'hidden'
                && popoverStyle.display !== 'none' && popoverStyle.visibility !== 'hidden'
                && rect.width > 0 && rect.height > 0;
        });
        assert(Number.parseFloat(await page.$eval('.search-popover', element => getComputedStyle(element).animationDuration)) < 0.01);
        await page.keyboard.press('Escape');
        console.log('PASS: requested widths, RTL/LTR, desktop sticky and reduced motion.');

        console.log('CHECK: mobile dialogs, focus, single form and retained state');
        page = await fresh({ width: 390, search: storedSearch });
        await page.click('#search-guests');
        await page.waitForSelector('dialog[open] #guests-0-adults');
        await page.select('#guests-0-children', '1');
        await page.select('#guests-0-age-0', '5');
        await page.keyboard.press('Escape');
        await focusIs(page, 'search-guests');
        await page.focus('#destination-search');
        await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-search-shell]').offsetTop + 650));
        await delay(200);
        assert.equal(await page.$('[data-search-compact]'), null, 'Collapsed while typing');
        await page.evaluate(() => document.activeElement.blur());
        await page.waitForSelector('[data-search-compact]', { visible: true });
        assert.equal(await page.$('#hotel-search-form'), null);
        const beforeTop = await page.$eval('#results-heading', element => element.getBoundingClientRect().top);
        await page.click('[data-search-compact] button');
        await page.waitForSelector('dialog[open] #hotel-search-form');
        await focusIs(page, 'destination-search');
        assert.equal(await page.$$eval('#destination-search', elements => elements.length), 1);
        assert.equal(await page.$eval('#search-checkin', input => input.value), storedSearch.checkin);
        assert((await page.$eval('#search-guests-value', element => element.textContent)).includes('3'));
        for (let index = 0; index < 15; index++) {
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open]'))), true, 'Focus escaped modal');
        }
        await type(page, '#destination-search', 'Du');
        await page.waitForSelector('dialog[open] #destination-suggestions', { visible: true });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.click('#search-guests');
        await page.waitForSelector('dialog[open] #search-guests-panel', { visible: true });
        await page.select('#guests-0-age-0', '7');
        await page.keyboard.press('Escape');
        assert.equal(await page.$$eval('dialog[open]', elements => elements.length), 1);
        await page.click('dialog[open] [data-dialog-close]');
        await page.waitForSelector('dialog[open]', { hidden: true });
        assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[data-search-compact]'))), true);
        const afterTop = await page.$eval('#results-heading', element => element.getBoundingClientRect().top);
        assert(Math.abs(afterTop - beforeTop) < 3, `Layout jumped after modal: ${beforeTop} -> ${afterTop}`);
        await page.click('[data-search-compact] button');
        await page.waitForSelector('dialog[open] #destination-search');
        await page.click('#search-guests');
        await page.waitForSelector('#guests-0-age-0');
        assert.equal(await page.$eval('#guests-0-age-0', input => input.value), '7');
        await page.keyboard.press('Escape');
        for (const width of [320, 360, 390, 768]) {
            await page.setViewport({ width, height: 640 });
            await noOverflow(page, `modal/${width}`);
        }
        await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
        await page.click('#search-submit');
        await page.waitForFunction(() => document.getElementById('search-error')?.textContent.includes('offline'));
        assert.equal(await page.$eval('#destination-search', input => input.value), 'Dubai');
        assert.equal(await page.$eval('#search-submit', button => button.disabled), false);
        await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
        await page.click('dialog[open] [data-dialog-close]');
        assert.deepEqual(pageErrors, []);
        console.log('PASS: mobile focus containment/return, portals, retained draft, no layout jump and offline handling.');
    } finally {
        await browser?.close();
        await server?.close();
        process.chdir(oldCwd);
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });