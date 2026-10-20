const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');
async function run() {
    let browser;
    const base = process.env.REMAL_UI_TEST_BASE || 'http://127.0.0.1:5173';
    const output = process.env.REMAL_UI_SCREENSHOT_DIR;
    let eligible = false, caseRecord, stored = [], sequence = 0, failDelivery = true, customerWrites = 0, financialRequests = 0;
    const userToken = 'e'.repeat(64), adminToken = 'f'.repeat(64), id = 'b'.repeat(64);
    const context = { reference: 'owned-booking', hotelName: 'Hyatt Place Dubai Jumeirah Residences',
        bookingStatus: 'active', paymentStatus: 'booking_confirmed', paid: true, amount: '141.46', currency: 'AED', voucherStatus: 'sent' };
    const errors = [];
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
        console.log('Support UI: browser started');
        const configure = async page => {
            await page.setBypassServiceWorker(true);
            await page.evaluateOnNewDocument(() => Object.defineProperty(document, 'hidden', { get: () => false }));
            page.on('pageerror', error => errors.push(error.message));
            await page.setRequestInterception(true);
            page.on('request', request => {
                const url = new URL(request.url());
                if (!url.pathname.includes('/api/')) return url.origin === base ? request.continue() : request.abort();
                const headers = { 'Access-Control-Allow-Origin': base,
                    'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' };
                if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
                const staff = url.pathname.includes('/v1/admin/');
                const token = request.headers().authorization;
                const respond = (body, status = 200) => request.respond({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
                if (url.pathname.endsWith('/v1/admin/login')) return respond({ access_token: adminToken });
                if (token !== `Bearer ${staff ? adminToken : userToken}`) return respond({ error: 'unauthorized' }, 401);
                if (url.pathname.endsWith('/v1/admin/session')) return respond({ success: true, email: 'staff@example.test' });
                if (url.pathname.endsWith('/v1/admin/logout')) return respond({ success: true });
                if (!url.pathname.includes('/support/')) { financialRequests++; return request.abort(); }
                if (url.pathname.endsWith('/eligibility')) return respond({ references: eligible ? [{ reference: 'owned-booking', hotelName: context.hotelName }] : [] });
                if (url.pathname.endsWith('/conversations')) {
                    if (request.method() === 'POST') {
                        assert.equal(JSON.parse(request.postData()).reference, 'owned-booking');
                        caseRecord ||= { id, reference: 'owned-booking', customerName: 'Test Guest', hotelName: context.hotelName,
                            topic: 'booking', status: 'open', priority: 'normal', updatedAt: new Date().toISOString() };
                        return respond({ conversation: caseRecord, context });
                    }
                    return respond({ conversations: caseRecord ? [caseRecord] : [], counts: { open: caseRecord?.status === 'open' ? 1 : 0, waiting: caseRecord?.status === 'waiting' ? 1 : 0, resolved: caseRecord?.status === 'resolved' ? 1 : 0 } });
                }
                if (url.pathname.endsWith('/messages')) {
                    const body = JSON.parse(request.postData());
                    let message = stored.find(row => row.clientId === body.clientId);
                    if (!message) {
                        message = { id: String(++sequence).padStart(64, '0'), clientId: body.clientId, body: body.body,
                            role: staff ? 'admin' : 'user', kind: staff && body.kind === 'note' ? 'note' : 'message', createdAt: new Date().toISOString() };
                        stored.push(message);
                        if (!staff) customerWrites++;
                    }
                    if (!staff && failDelivery) { failDelivery = false; return respond({ error: 'uncertain_delivery' }, 503); }
                    return respond({ message });
                }
                if (url.pathname.endsWith(`/conversations/${id}`)) {
                    if (request.method() === 'PATCH') {
                        const changes = JSON.parse(request.postData());
                        Object.assign(caseRecord, changes, changes.assignToMe ? { assignedTo: 'staff@example.test' } : {});
                        return respond({ conversation: caseRecord });
                    }
                    return respond({ conversation: caseRecord, context, hasMore: false,
                        messages: stored.filter(row => staff || row.kind === 'message') });
                }
                return respond({ error: 'not_found' }, 404);
            });
        };
        const customer = await browser.newPage(); await configure(customer); await customer.setViewport({ width: 390, height: 844 });
        await customer.goto(`${base}/support?lang=ar`, { waitUntil: 'domcontentloaded' });
        await customer.waitForFunction(() => document.querySelector('.support-gate h2')?.innerText.includes('سجّل الدخول'));
        assert.equal(await customer.$('[data-support-draft]'), null);
        await customer.evaluate(token => sessionStorage.setItem('rimal_user_access_token', token), userToken);
        await customer.reload();
        await customer.waitForFunction(() => document.querySelector('.support-gate')?.innerText.includes('عملية دفع مؤكدة'));
        assert.equal(await customer.$('[data-support-draft]'), null);
        eligible = true;
        console.log('Support UI: sign-in and eligibility gates passed');
        await customer.goto(`${base}/support?reference=owned-booking&lang=ar`);
        await customer.waitForSelector('[data-support-draft]');
        await customer.type('[data-support-draft]', '<script>window.supportXss=true</script> Please help');
        await customer.click('[data-support-send]');
        await customer.waitForSelector('.support-composer [role="alert"]');
        assert.match(await customer.$eval('[data-support-draft]', node => node.value), /Please help/);
        await customer.click('[data-support-send]');
        await customer.waitForFunction(() => document.querySelector('[data-support-draft]')?.value === '');
        assert.equal(customerWrites, 1); assert.equal(await customer.evaluate(() => window.supportXss), undefined);
        console.log('Support UI: uncertain delivery retry passed');
        const operator = await browser.newPage(); await configure(operator); await operator.setViewport({ width: 1440, height: 1000 });
        await operator.goto(`${base}/customer-service?lang=ar`);
        await operator.waitForSelector('[data-support-login]');
        await operator.type('[data-support-email]', 'staff@example.test'); await operator.type('[data-support-password]', 'fixture-only');
        await operator.click('[data-support-login]');
        await operator.waitForSelector('[data-support-case]'); await operator.click('[data-support-case]');
        console.log('Support UI: staff signed in and opened conversation');
        await operator.waitForSelector('[data-support-draft]');
        await operator.click('[data-support-note]'); await operator.type('[data-support-draft]', 'PRIVATE-ONLY-TEAM'); await operator.click('[data-support-send]');
        await operator.waitForSelector('[data-message-kind="note"]');
        await operator.click('.support-compose-options button:first-child');
        await operator.type('[data-support-draft]', 'We are reviewing your request.'); await operator.click('[data-support-send]');
        await customer.waitForFunction(() => document.querySelector('[data-support-messages]')?.innerText.includes('We are reviewing your request.'), { timeout: 15000, polling: 100 });
        console.log('Support UI: live reply and private notes passed');
        assert.doesNotMatch(await customer.$eval('main', node => node.innerText), /PRIVATE-ONLY-TEAM/);
        await operator.click('[data-support-resolve]');
        await operator.waitForFunction(() => document.querySelector('[data-support-resolve]')?.innerText.includes('إعادة فتح'), { polling: 100 });
        assert.equal(caseRecord.status, 'resolved');
        for (const [page, name] of [[customer, 'customer-ar-390'], [operator, 'staff-ar-1440']]) {
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            if (output) { await fs.mkdir(output, { recursive: true }); await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); }
        }
        await operator.setViewport({ width: 390, height: 844 });
        assert.equal(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (output) await operator.screenshot({ path: path.join(output, 'staff-ar-390.png'), fullPage: true });
        await customer.goto(`${base}/support?reference=owned-booking&lang=en`, { waitUntil: 'domcontentloaded' });
        await customer.waitForSelector('[data-support-draft]');
        assert.match(await customer.$eval('main h1', node => node.innerText), /A little care/);
        assert.equal(financialRequests, 0); assert.deepEqual(errors, []);
        console.log('PASS: support sign-in and eligibility gates, two-sided live replies, persistent history on reload, private notes, uncertain-send deduplication, case resolution, Arabic/English and mobile/desktop layouts. APIs simulated; no financial or email requests.');
    } catch (error) {
        if (browser) for (const page of await browser.pages()) {
            console.error('Support UI failure context:', await page.evaluate(() => ({ path: location.pathname, text: document.querySelector('main')?.innerText?.slice(0, 2000) })).catch(() => ({})));
        }
        throw error;
    } finally { if (browser) await browser.close(); }
}
module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
