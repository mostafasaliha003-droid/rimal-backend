/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compile the actual pure TS modules with the installed compiler. Native storage
// is dependency-injected below; tests never load an emulator or contact a host.
function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(__dirname, file);
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} }; cache.set(full, module);
    const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
    }).outputText;
    const requireHere = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (!name.startsWith('.')) return require(name);
      let target = path.resolve(path.dirname(full), name);
      if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!path.extname(target)) target += '.ts';
      return load(target);
    };
    new Function('require', 'module', 'exports', 'process', output)(requireHere, module, module.exports,
      { env: { EXPO_PUBLIC_API_ENV: 'staging' } });
    return module.exports;
  }
  return load;
}
const load = loader();
const { ApiError } = load('../errors.ts');
const { createTransport, allowedRoute } = load('../transport.ts');
const { createApiClient } = load('../client.ts');
const adapters = load('../adapters.ts');
const { resolveEnvironment, endpoints, APP_ENV } = load('../config.ts');
const { bookingWebsiteUrl, websiteUrl } = load('../links.ts');
const { validateSearchCriteria, COUNTRY_CODES } = load('../validation.ts');
const { createSessionManager } = load('../../auth/session.ts');
const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const criteria = () => ({ checkin: '2099-02-16', checkout: '2099-02-18', residency: 'ae', currency: 'USD',
  guests: [{ adults: 2, children: [0, 17] }], regionId: 6053839, language: 'ar' });
// Use a bounded future date relative to the test clock, like the website model.
function futureCriteria() { const date = new Date(); date.setDate(date.getDate() + 30); const start = date.toISOString().slice(0, 10);
  date.setDate(date.getDate() + 2); return { ...criteria(), checkin: start, checkout: date.toISOString().slice(0, 10) }; }
const rg = Object.fromEntries(['class','quality','sex','bathroom','bedding','family','capacity','club','bedrooms','balcony','view','floor'].map(key => [key, 0]));
const rate = (hash = 'h-fixture', amount = '107.00', code = 'USD') => ({ book_hash: hash, room_name: 'Supplier double', rg_ext: rg,
  offer_context: 'signed.hotelpage', customer_display_amount: amount, customer_display_currency: code,
  payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD',
    cancellation_penalties: { free_cancellation_before: '2099-02-15T12:00:00', policies: [
      { start_at: null, end_at: '2099-02-15T12:00:00', amount_charge: '0.00', amount_show: '99.00' },
      { start_at: '2099-02-15T12:00:00', end_at: null, amount_charge: '100.00' }
    ] } }] } });
const user = name => ({ name, email: `${name}@example.test` });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function memoryStorage(initial = null) { let value = initial; return { async get() { return value; }, async set(next) { value = next; }, async clear() { value = null; }, value: () => value }; }
const authNetwork = overrides => ({ login: async email => ({ user: user(email), token: 'a'.repeat(64) }),
  session: async () => user('restored'), logout: async () => {}, requestRegistration: async () => {},
  verifyRegistration: async () => ({ user: user('verified'), token: 'b'.repeat(64) }), ...overrides });

test('environment and routes are fixed allowlists; financial/private endpoints cannot be called', async () => {
  assert.equal(resolveEnvironment(undefined), 'staging');
  assert.equal(APP_ENV, 'staging');
  assert.equal(endpoints('production').api, 'https://rimal-api.onrender.com/api');
  for (const invalid of ['https://api.ratehawk.com', 'Production', 'https://evil.test/api']) assert.throws(() => endpoints(invalid), /invalid_app_environment/);
  let requests = 0;
  const request = createTransport({ environment: 'staging', fetcher: async () => { requests++; return response({ success: true }); } });
  for (const target of ['/payment/ziina/intent', '/v1/booking/finish', '/auth/session/../login', '//evil.test', 'https://api.ratehawk.com']) {
    await assert.rejects(request('POST', target), error => error.kind === 'configuration');
  }
  assert.equal(allowedRoute('POST', '/booking/prebook'), true);
  assert.equal(requests, 0);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../config.ts'), 'utf8'), /process\.env\.EXPO_PUBLIC_API_ENV/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../config.ts'), 'utf8'), /EXPO_PUBLIC_APP_ENV/);
});

test('website handoff preserves only validated search context and never carries session/offer/guest identity', () => {
  const input = { ...futureCriteria(), access_token: 'private', book_hash: 'private', email: 'private@example.test' };
  const url = new URL(bookingWebsiteUrl(10004834, input, 'ar'));
  assert.equal(url.origin, 'https://rimal-api-staging.onrender.com');
  assert.equal(url.pathname, '/hotel/10004834');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['checkin', 'checkout', 'guests', 'lang', 'residency']);
  assert.deepEqual(JSON.parse(url.searchParams.get('guests')), input.guests);
  assert.doesNotMatch(url.href, /private|access_token|book_hash/);
  assert.equal(websiteUrl('/account', 'production'), 'https://remalbookings.com/account');
  for (const invalid of ['/account?token=private', '//evil.test', 'https://evil.test', '/bookings']) assert.throws(() => websiteUrl(invalid));
  assert.throws(() => bookingWebsiteUrl('100/../auth', input, 'en'));
});

test('criteria and copied country allowlist follow the existing backend/website bounds', () => {
  const value = futureCriteria(); assert.equal(validateSearchCriteria(value).valid, true);
  for (const patch of [{ residency: 'zz' }, { currency: 'usd' }, { checkin: '2026-02-30' }, { checkout: value.checkin },
    { guests: [{ adults: 0, children: [] }] }, { guests: [{ adults: 2, children: [18] }] }, { regionId: undefined, hids: [] }]) {
    assert.equal(validateSearchCriteria({ ...value, ...patch }).valid, false);
  }
  const original = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../../../shared/ratehawkResidencies.json'), 'utf8'));
  assert.deepEqual(COUNTRY_CODES, original);
});

test('HTTP failures remain typed and bounded, membership is not an authentication bypass', async () => {
  let invalidated = 0;
  const token = 'a'.repeat(64);
  let value = response({ error: 'membership_approval_required' }, 403);
  const request = createTransport({ environment: 'staging', getToken: async () => token,
    onUnauthorized: async () => { invalidated++; }, fetcher: async (url, init) => {
      assert.equal(new URL(url).origin, 'https://rimal-api-staging.onrender.com');
      assert.equal(init.headers.Authorization, `Bearer ${token}`); return value;
    } });
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'membership');
  assert.equal(invalidated, 0);
  value = response({ error: 'membership_authentication_required' }, 401);
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'membership');
  assert.equal(invalidated, 1);
  value = response({ error: 'unauthorized' }, 401);
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'auth');
  assert.equal(invalidated, 2);
  value = response({ error: 'private echoed debug email@example.test' }, 429, { 'Retry-After': '60' });
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'rate_limit' && error.retryAfterSeconds === 60 && !error.message.includes('private'));
});

test('an expired membership session is cleared while a valid approval-denied identity is retained', async () => {
  const storage = memoryStorage('a'.repeat(64));
  let manager;
  let status = 403, code = 'membership_approval_required';
  const request = createTransport({ environment: 'staging', getToken: () => manager.getToken(),
    onUnauthorized: token => manager.invalidate(token), fetcher: async () => response({ error: code }, status) });
  manager = createSessionManager(authNetwork(), storage);
  await manager.restore();
  await assert.rejects(request('POST', '/search/rates/region', { body: {} }), error => error.kind === 'membership');
  assert.equal(manager.getSnapshot().status, 'signedIn'); assert.equal(storage.value(), 'a'.repeat(64));
  status = 401; code = 'membership_authentication_required';
  await assert.rejects(request('POST', '/search/rates/region', { body: {} }), error => error.kind === 'membership');
  assert.equal(manager.getSnapshot().status, 'signedOut'); assert.equal(await manager.getToken(), null); assert.equal(storage.value(), null);
});

test('malformed/redirected responses and private network failures never become content or raw errors', async () => {
  let value = new Response('<html>login</html>', { status: 200 });
  const request = createTransport({ environment: 'staging', fetcher: async () => { if (value instanceof Error) throw value; return value; } });
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'invalid_response');
  value = response({ success: true }); Object.defineProperty(value, 'url', { value: 'https://api.ratehawk.com/private' });
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'invalid_response');
  value = new Error('private-token@host');
  await assert.rejects(request('GET', '/auth/session'), error => error.kind === 'network' && error.message === 'network_unavailable');
});

test('timeouts and cancellation reject late responses and do not automatically retry', async () => {
  let calls = 0;
  const timeout = createTransport({ environment: 'staging', timeoutMs: 3, fetcher: (_url, init) => {
    calls++; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  await assert.rejects(timeout('GET', '/auth/session'), error => error.kind === 'timeout'); assert.equal(calls, 1);
  const held = deferred(), controller = new AbortController();
  const request = createTransport({ environment: 'staging', fetcher: async () => held.promise });
  const pending = request('GET', '/auth/session', { signal: controller.signal });
  await tick(); controller.abort(); held.resolve(response({ success: true, user: user('late') }));
  await assert.rejects(pending, error => error.kind === 'aborted');
  const tokenRead = deferred(); let sent = 0;
  const blockedStorage = createTransport({ environment: 'staging', timeoutMs: 3, getToken: () => tokenRead.promise,
    fetcher: async () => { sent++; return response({ success: true }); } });
  await assert.rejects(blockedStorage('GET', '/auth/session'), error => error.kind === 'timeout');
  tokenRead.resolve('a'.repeat(64)); await tick(); assert.equal(sent, 0);
  const nonCancelable = createTransport({ environment: 'staging', timeoutMs: 3, fetcher: () => new Promise(() => {}) });
  await assert.rejects(nonCancelable('GET', '/auth/session'), error => error.kind === 'timeout');
});

test('customer totals and cancellation amounts keep authoritative currency and zero values', () => {
  const offer = adapters.normalizeOffers([rate()])[0];
  assert.deepEqual(offer.price, { amount: '107.00', currency: 'USD' });
  assert.deepEqual(offer.cancellation.policies[0], { startAt: null, endAt: '2099-02-15T12:00:00.000Z', amount: '0.00', currency: 'USD' });
  assert.equal(offer.cancellation.freeUntil, '2099-02-15T12:00:00.000Z');
  const net = rate(); delete net.customer_display_amount; delete net.customer_display_currency;
  assert.equal(adapters.normalizeOffers([net])[0].price, null);
  const malformed = rate(); malformed.payment_options.payment_types[0].cancellation_penalties.policies[0].end_at = '2099-02-30T12:00:00';
  assert.equal(adapters.normalizeOffers([malformed])[0].cancellation.policies[0].amount, null);
  const hotel = adapters.normalizeHotel({ hid: 123, name: 'Supplier hotel', rates: [rate('h-eur', '1', 'EUR'), rate('h-usd', '107', 'USD')] }, 'USD');
  assert.deepEqual(hotel.price, { amount: '107', currency: 'USD' });
});

test('taxes preserve selected-payment amounts/currencies/zero and never infer inclusion or conversion', () => {
  const value = rate();
  const supplied = [
    { name: 'vat', amount: '0.00', currency_code: 'AED', included_by_supplier: true },
    { name: 'city_tax', amount: '25.30', currency_code: 'EUR', included_by_supplier: false },
    { name: 'resort_fee', amount: 0, currency_code: 'USD' },
    { name: 'unspecified_fee', amount: null, currency_code: 'USD', included_by_supplier: 'false' },
    { name: 'malformed_fee', amount: 'private-debug', currency_code: 'usd', included_by_supplier: null }
  ];
  value.payment_options.payment_types.unshift({ type: 'hotel', tax_data: { taxes: [{ name: 'wrong_payment', amount: '999', currency_code: 'USD' }] } });
  value.payment_options.payment_types[1].tax_data = { taxes: supplied };
  assert.deepEqual(adapters.normalizeOffers([value])[0].taxes, [
    { name: 'vat', amount: '0.00', currency_code: 'AED', included_by_supplier: true },
    { name: 'city_tax', amount: '25.30', currency_code: 'EUR', included_by_supplier: false },
    { name: 'resort_fee', amount: '0', currency_code: 'USD', included_by_supplier: null },
    { name: 'unspecified_fee', amount: null, currency_code: 'USD', included_by_supplier: null },
    { name: 'malformed_fee', amount: null, currency_code: null, included_by_supplier: null }
  ]);
  assert.deepEqual(adapters.normalizeOffers([rate()])[0].taxes, []);
});

test('all offer identities survive and only complete static rg_ext matches supply room photographs', () => {
  const group = { rg_ext: rg, images_ext: [{ url: 'https://cdn.worldota.net/t/{size}/content/room.jpeg', category_slug: 'bedroom' }] };
  const hotel = { room_groups: [group], image: 'https://cdn.worldota.net/t/640x480/content/hotel.jpeg' };
  const rows = Array.from({ length: 27 }, (_, index) => ({ ...rate(`h-${index}`), images: [hotel.image] }));
  const offers = adapters.normalizeOffers(rows, hotel);
  assert.equal(offers.length, 27); assert.equal(new Set(offers.map(item => item.id)).size, 27);
  assert.deepEqual(offers.map(item => item.bookHash), rows.map(item => item.book_hash));
  assert.deepEqual(offers[0].images, ['https://cdn.worldota.net/t/640x480/content/room.jpeg']);
  rows[0].rg_ext = { ...rg, view: 1 }; assert.deepEqual(adapters.normalizeOffers(rows, hotel)[0].images, []);
  assert.deepEqual(adapters.images({ category_slug: 'bedroom', width: 800 }), []);
  assert.deepEqual(adapters.images('https://cdn.worldota.net.evil.test/x', 'javascript:alert(1)'), []);
});

test('actual BFF envelopes adapt suggestions/search/details; wrong hotel IDs and malformed lists fail closed', async () => {
  let calls = [];
  const request = createTransport({ environment: 'staging', fetcher: async (url, init) => {
    calls.push({ url, init }); const pathname = new URL(url).pathname;
    if (pathname.endsWith('/search/suggest')) return response({ success: true, suggestions: { regions: [{ id: 6053839, name: 'Dubai' }], hotels: [{ hid: 123, name: { content: 'Supplier hotel' } }] } });
    if (/\/v1\/hotels\/123$/.test(pathname)) return response({ success: true, hotel: { hid: 123, name: 'Supplier hotel',
      description_struct: [{ paragraphs: ['Actual supplied text'] }], metapolicy_struct: { test: [{ price: 0, included: false, note: null }] } } });
    if (pathname.endsWith('/search/hotelpage')) return response({ success: true, hotel: { hid: 123 }, rates: [rate()] });
    return response({ success: true, hotels: [{ hid: 123, name: 'Supplier hotel', rates: [rate()] }] });
  } });
  const api = createApiClient(request);
  assert.equal((await api.searchSuggestions('Dubai', 'ar'))[0].regionId, 6053839);
  assert.equal((await api.searchHotels(futureCriteria()))[0].price.amount, '107.00');
  const details = await api.getHotel(123, futureCriteria(), 'ar');
  assert.deepEqual(details.description, ['Actual supplied text']);
  assert.deepEqual(details.policies.test, [{ price: 0, included: false, note: null }]);
  assert.equal(JSON.parse(calls.find(item => item.url.endsWith('/search/rates/region')).init.body).language, 'en');
  assert.throws(() => adapters.normalizeDetails(123, {}, { hotel: { hid: 456 }, rates: [] }, 'USD'));
  assert.throws(() => adapters.normalizeSuggestions({ success: true, suggestions: {} }));
});

test('readonly prebook retains exact hashes and proof, detects changed customer price, and exposes no financial create method', async () => {
  let body;
  const api = createApiClient(createTransport({ environment: 'staging', fetcher: async (_url, init) => {
    body = JSON.parse(init.body); return response({ success: true, hotels: [{ hid: 123, rates: [rate('p-fixture', '110.00')] }],
      prebook_context: 'signed.prebook', changes: { price_changed: true } });
  } }));
  const selected = adapters.normalizeOffers([rate()])[0];
  const result = await api.prebook(123, selected);
  assert.deepEqual(body, { hash: 'h-fixture', offer_context: 'signed.hotelpage' });
  assert.equal(result.offer.bookHash, 'p-fixture'); assert.equal(result.priceChanged, true);
  assert.equal(result.prebookContext, 'signed.prebook'); assert.equal(api.createBooking, undefined); assert.equal(api.createPayment, undefined);
  await assert.rejects(api.prebook(123, { ...selected, offerContext: undefined }), /fresh_hotelpage_required/);
});

test('prebook preserves photos only for the exact room classification and rejects a different room or malformed proof', async () => {
  let next = rate('p-fixture');
  let proof = 'signed.prebook';
  const api = createApiClient(createTransport({ environment: 'staging', fetcher: async () => response({ success: true,
    hotels: [{ hid: 123, rates: [next] }], prebook_context: proof }) }));
  const selected = { ...adapters.normalizeOffers([rate()])[0], images: ['https://cdn.worldota.net/t/640x480/fixture.jpg'] };
  assert.deepEqual((await api.prebook(123, selected)).offer.images, selected.images);
  next = { ...rate('p-fixture'), rg_ext: { ...rg, quality: 1 } };
  await assert.rejects(api.prebook(123, selected), error => error.kind === 'invalid_response');
  next = rate('p-fixture');
  for (const value of ['', 'signed proof', 'signed\nproof', 'a'.repeat(131073)]) {
    proof = value; await assert.rejects(api.prebook(123, selected), error => error.kind === 'invalid_response');
  }
});

test('prebook compares authoritative decimal prices without floating point rounding', async () => {
  let amount = '107.000';
  const api = createApiClient(createTransport({ environment: 'staging', fetcher: async () => response({ success: true,
    hotels: [{ hid: 123, rates: [rate('p-fixture', amount)] }], prebook_context: 'signed.prebook' }) }));
  const selected = adapters.normalizeOffers([rate()])[0];
  assert.equal((await api.prebook(123, selected)).priceChanged, false);
  selected.price.amount = '9007199254740992.01'; amount = '9007199254740992.02';
  assert.equal((await api.prebook(123, selected)).priceChanged, true);
});

test('owned booking history uses only the authenticated profile endpoint without email query or financial writes', async () => {
  const calls = [];
  const api = createApiClient(createTransport({ environment: 'staging', getToken: async () => 'a'.repeat(64),
    fetcher: async (url, options) => { calls.push({ url, options }); return response({ success: true, bookings: [] }); } }));
  assert.deepEqual(await api.getBookings(), []);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://rimal-api-staging.onrender.com/api/user/profile');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
  assert.equal(calls[0].options.body, undefined); assert.equal(allowedRoute('POST', '/user/profile'), false);
});

test('auth revision changes across restore, same-account sign-in, logout and invalidation without exposing tokens', async () => {
  const manager = createSessionManager(authNetwork({ login: async () => ({ user: user('same'), token: 'a'.repeat(64) }) }), memoryStorage());
  const versions = [manager.getRevision()];
  await manager.restore(); versions.push(manager.getRevision());
  await manager.signIn('same@example.test', 'password'); versions.push(manager.getRevision());
  await manager.signIn('same@example.test', 'password'); versions.push(manager.getRevision());
  await manager.invalidate('a'.repeat(64)); versions.push(manager.getRevision());
  await manager.signOut(); versions.push(manager.getRevision());
  assert.equal(versions.every((value, index) => Number.isInteger(value) && (index === 0 || value > versions[index - 1])), true);
  assert.equal(manager.getSnapshot().access_token, undefined);
});

test('account deletion intake uses only exact authenticated routes and never accepts caller identity selectors', async () => {
  const calls = [];
  const api = createApiClient(createTransport({ environment: 'staging', getToken: async () => 'a'.repeat(64),
    fetcher: async (url, options) => { calls.push({ url, options }); return response({ success: true, request: null, data_deleted: false }); } }));
  assert.deepEqual(await api.getAccountDeletionRequest(), { request: null, dataDeleted: false });
  assert.equal(calls[0].url, 'https://rimal-api-staging.onrender.com/api/auth/account-deletion');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
  assert.equal(calls[0].options.body, undefined);
  for (const [method, target] of [['DELETE', '/auth/account-deletion'], ['POST', '/user/delete'], ['GET', '/auth/account-deletion?email=other@example.test']]) {
    assert.equal(allowedRoute(method, target), false);
  }
});

test('request intake sends exact current password without trimming or a registration-length rule and drops extra response fields', async () => {
  let sent;
  const api = createApiClient(createTransport({ environment: 'staging', getToken: async () => 'a'.repeat(64),
    fetcher: async (_url, options) => { sent = JSON.parse(options.body); return response({ success: true,
      request: { reference: `del_${'1'.repeat(32)}`, status: 'requested', requested_at: '2026-11-17T12:00:00.000Z',
        email: 'must-not-copy@example.test', ownerSubject: 'private' }, data_deleted: false }); } }));
  const receipt = await api.requestAccountDeletion(' x ');
  assert.deepEqual(sent, { password: ' x ', confirm_account_deletion: true });
  assert.deepEqual(receipt, { request: { reference: `del_${'1'.repeat(32)}`, status: 'requested', requestedAt: '2026-11-17T12:00:00.000Z' }, dataDeleted: false });
  await assert.rejects(api.requestAccountDeletion(''), /invalid_password/);
  await assert.rejects(api.requestAccountDeletion('x'.repeat(257)), /invalid_password/);
});

test('wrong deletion reauthentication does not invalidate a valid session or imply request acceptance', async () => {
  let invalidated = 0;
  const api = createApiClient(createTransport({ environment: 'staging', getToken: async () => 'a'.repeat(64),
    onUnauthorized: async () => { invalidated++; }, fetcher: async () => response({ success: false, error: 'reauthentication_failed' }, 400) }));
  await assert.rejects(api.requestAccountDeletion('wrong'), error => error.status === 400 && error.code === 'reauthentication_failed');
  assert.equal(invalidated, 0);
});

test('deletion intake never invents completion from unknown, missing or malformed server outcomes', async () => {
  let payload;
  const api = createApiClient(createTransport({ environment: 'staging', fetcher: async () => response(payload) }));
  const valid = { reference: `del_${'1'.repeat(32)}`, status: 'requested', requested_at: '2026-11-17T12:00:00.000Z' };
  for (const patch of [{}, { data_deleted: true }, { request: null }, { request: { ...valid, status: 'completed' } },
    { request: { ...valid, reference: 'predictable' } }, { request: { ...valid, requested_at: '2026-02-30T00:00:00Z' } }]) {
    payload = { success: true, request: valid, data_deleted: false, ...patch };
    if (!Object.keys(patch).length) delete payload.data_deleted;
    await assert.rejects(api.requestAccountDeletion('valid'), error => error.kind === 'invalid_response');
  }
});

test('public deletion resource is a fixed environment URL with no account or credential query', () => {
  assert.equal(websiteUrl('/account-deletion', 'production'), 'https://remalbookings.com/account-deletion');
  assert.equal(websiteUrl('/account-deletion', 'staging'), 'https://rimal-api-staging.onrender.com/account-deletion');
  for (const invalid of ['/account-deletion?token=private', '/account-deletion/other', '//evil.test/account-deletion']) assert.throws(() => websiteUrl(invalid));
});

test('native storage uses environment-separated SecureStore; web preview stays memory-only', async () => {
  const entries = new Map(); let writes = 0;
  const secure = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7, async getItemAsync(key) { return entries.get(key) || null; },
    async setItemAsync(key, value, options) { assert.equal(options.keychainAccessible, 7); writes++; entries.set(key, value); },
    async deleteItemAsync(key) { entries.delete(key); } };
  const native = loader({ 'react-native': { Platform: { OS: 'android' } }, 'expo-secure-store': secure })('../../auth/storage.ts').createTokenStorage;
  const staging = native('staging'), production = native('production');
  await staging.set('a'.repeat(64)); assert.equal(await production.get(), null); assert.equal(writes, 1);
  await staging.clear(); assert.equal(await staging.get(), null);
  const web = loader({ 'react-native': { Platform: { OS: 'web' } }, 'expo-secure-store': secure })('../../auth/storage.ts').createTokenStorage('staging');
  await web.set('b'.repeat(64)); assert.equal(await web.get(), 'b'.repeat(64)); assert.equal(writes, 1);
  const failure = loader({ 'react-native': { Platform: { OS: 'android' } }, 'expo-secure-store': { async getItemAsync() { throw new Error('native unavailable'); } } })('../../auth/storage.ts').createTokenStorage('staging');
  await assert.rejects(failure.get(), error => error.kind === 'storage');
});

test('session restoration validates the server and logout clears locally even when server revocation is unavailable', async () => {
  const storage = memoryStorage('a'.repeat(64)); let revoked;
  const manager = createSessionManager(authNetwork({ logout: async token => { revoked = token; throw new ApiError('network', 'network_unavailable'); } }), storage);
  await manager.restore(); assert.equal(manager.getSnapshot().status, 'signedIn');
  await assert.rejects(manager.signOut(), error => error.kind === 'network');
  assert.equal(revoked, 'a'.repeat(64)); assert.equal(storage.value(), null); assert.equal(manager.getSnapshot().user, null);
});

test('older sign-in results and stale 401s cannot replace or clear a newer account', async () => {
  const a = deferred(), b = deferred(), storage = memoryStorage(), retired = [];
  const manager = createSessionManager(authNetwork({ login: email => email === 'a' ? a.promise : b.promise,
    logout: async token => { retired.push(token); } }), storage);
  const first = manager.signIn('a', 'password'); await tick();
  const second = manager.signIn('b', 'password'); await tick();
  b.resolve({ user: user('b'), token: 'b'.repeat(64) }); await second;
  a.resolve({ user: user('a'), token: 'a'.repeat(64) }); await assert.rejects(first, error => error.kind === 'aborted');
  await manager.invalidate('a'.repeat(64));
  assert.equal(manager.getSnapshot().user.name, 'b'); assert.equal(storage.value(), 'b'.repeat(64));
  assert.deepEqual(retired, ['a'.repeat(64)]);
});

test('logout while SecureStore is writing cannot resurrect a token after logout', async () => {
  const entered = deferred(), release = deferred(), storage = memoryStorage();
  const originalSet = storage.set;
  storage.set = async value => { entered.resolve(); await release.promise; await originalSet(value); };
  const manager = createSessionManager(authNetwork(), storage);
  const login = manager.signIn('a', 'password'); await entered.promise;
  const logout = manager.signOut(); release.resolve();
  await assert.rejects(login, error => error.kind === 'aborted'); await logout;
  assert.equal(storage.value(), null); assert.equal(await manager.getToken(), null); assert.equal(manager.getSnapshot().status, 'signedOut');
});

test('an older failed logout cannot overwrite a later successful sign-in', async () => {
  const held = deferred(), storage = memoryStorage('a'.repeat(64));
  const manager = createSessionManager(authNetwork({ login: async () => ({ user: user('b'), token: 'b'.repeat(64) }), logout: () => held.promise }), storage);
  await manager.restore(); const logout = manager.signOut(); await tick();
  await manager.signIn('b', 'password'); held.reject(new ApiError('network', 'network_unavailable'));
  await assert.rejects(logout); assert.equal(manager.getSnapshot().user.name, 'b'); assert.equal(storage.value(), 'b'.repeat(64));
});

test('failed secure persistence never authenticates and retires the newly issued server session', async () => {
  let revoked;
  const storage = memoryStorage(); storage.set = async () => { throw new Error('private native failure'); };
  const manager = createSessionManager(authNetwork({ logout: async token => { revoked = token; } }), storage);
  await assert.rejects(manager.signIn('a', 'password'), error => error.kind === 'storage');
  assert.equal(manager.getSnapshot().status, 'signedOut'); assert.equal(await manager.getToken(), null);
  assert.equal(revoked, 'a'.repeat(64));
});
