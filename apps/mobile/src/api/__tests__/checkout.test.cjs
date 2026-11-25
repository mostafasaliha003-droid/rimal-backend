/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (full.endsWith('.json')) return JSON.parse(fs.readFileSync(full, 'utf8'));
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (!name.startsWith('.')) return require(name);
    let next = path.resolve(path.dirname(full), name); if (!path.extname(next)) next += '.ts';
    return load(next);
  }, module, module.exports);
  return module.exports;
}
const { createCheckoutApi, normalizeCheckoutAttempt, normalizeCheckoutQuote, normalizeCheckoutCreate,
  normalizeCheckoutRecovery, normalizePaymentAvailability, checkoutPaymentUrl } = load('../checkout.ts');
const { createTransport, allowedRoute } = load('../transport.ts');
const { createApiClient } = load('../client.ts');
const reference = 'd54aac0d-55a1-4737-a157-4ccc158e2139';
const accessToken = 'b'.repeat(64), sessionToken = 'a'.repeat(64), key = 'native-checkout-key-123456';
const now = Date.parse('2026-11-18T12:00:00Z');
const checkin = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const checkout = new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10);
const signed = 'e30.' + 'c'.repeat(64);
function review(patch = {}) {
  return { hid: 123, hotelName: 'Hotel fixture', prebookContext: 'opaque.prebook-context',
    criteria: { checkin, checkout, currency: 'USD', residency: 'ae', guests: [{ adults: 1, children: [7] }] },
    offer: { id: 'p-fixture:0', name: 'Twin fixture', bookHash: 'p-fixture', price: { amount: '107.00', currency: 'USD' },
      roomIdentity: 'full-identity', taxes: [], cancellation: { freeUntil: null, policies: [] }, images: [] }, ...patch };
}
const guests = () => ({ guest: { firstName: 'أحمد', lastName: 'Fixture', email: 'fixture@example.test', phone: '+971500000000', specialRequests: 'Quiet room\nLate arrival\tplease' },
  rooms: [{ guests: [{ firstName: '', lastName: '', is_child: false }, { firstName: 'Child', lastName: 'Fixture', is_child: true, age: 7 }] }] });
const quotePayload = (patch = {}) => ({ currency: 'USD', amount: 107, amount_formatted: '107.00', expires_at: now + 60_000, token: signed, ...patch });
const statusPayload = (patch = {}) => ({ reference, status: 'awaiting_payment', confirmed: false, ...patch });
function fixture({ enabled = true, mode = 'sandbox', financialWritesEnabled = false, result = statusPayload(), failStatus } = {}) {
  const calls = [], invalidations = [];
  const transport = createTransport({ environment: 'staging', getToken: async () => sessionToken,
    onUnauthorized: async token => { invalidations.push(token); }, fetcher: async (url, options) => {
      const u = new URL(url); calls.push({ url, path: u.pathname, options });
      let data = u.pathname.endsWith('/availability') ? { enabled, mode }
        : u.pathname.endsWith('/quote') ? quotePayload()
          : u.pathname.endsWith('/recover') ? { found: true, ...result, access_token: accessToken }
            : u.pathname.endsWith('/intent') ? { ...result, access_token: accessToken, payment_url: 'https://pay.ziina.com/fixture' } : result;
      const status = failStatus && u.pathname.endsWith('/status') ? failStatus : 200;
      if (status >= 400) data = { error: 'checkout_not_found' };
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    } });
  return { api: createCheckoutApi(transport, { environment: 'staging', financialWritesEnabled, now: () => now }), transport, calls, invalidations };
}

test('native creation defaults OFF through the real public client before any fetch', async context => {
  const previous = process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED; delete process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED;
  context.after(() => { if (previous === undefined) delete process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED; else process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED = previous; });
  const f = fixture(), client = createApiClient(f.transport);
  assert.equal(client.checkout.creationEnabled, false);
  await assert.rejects(client.checkout.create({}, key), /native_checkout_disabled/);
  assert.equal(f.calls.length, 0);
});

test('bare envelopes are allowed only for exact checkout routes and privileged supplier routes remain blocked', async () => {
  const request = createTransport({ environment: 'staging', fetcher: async () => new Response('{}') });
  await assert.rejects(request('GET', '/auth/session'), /invalid_response/);
  for (const route of ['/booking/form', '/booking/finish', '/booking/status', '/booking/card-token', '/v1/bookings/retrieve', '/payment/stripe/intent']) {
    assert.equal(allowedRoute('POST', route), false); await assert.rejects(request('POST', route), /endpoint_not_allowed/);
  }
  await assert.rejects(request('POST', '/payment/ziina/intent'), /invalid_idempotency_key/);
  await assert.rejects(request('POST', '/payment/ziina/recover', { idempotencyKey: key, query: { token: accessToken } }), /invalid_checkout_request/);
});

test('same-currency quote binds the checked p-offer and uses only the user session bearer', async () => {
  const f = fixture(), selected = review(), before = JSON.stringify(selected);
  assert.deepEqual(await f.api.quote(selected), { currency: 'USD', amount: '107', amountFormatted: '107.00', expiresAt: now + 60_000, token: signed });
  const post = f.calls.find(call => call.path.endsWith('/quote'));
  assert.equal(post.options.headers.Authorization, 'Bearer ' + sessionToken);
  assert.deepEqual(JSON.parse(post.options.body), { hid: 123, hotelName: 'Hotel fixture', roomName: 'Twin fixture', book_hash: 'p-fixture',
    prebook_context: selected.prebookContext, checkin, checkout, guests: [{ adults: 1, children: [7] }],
    currency: 'USD', total: '107.00', payment_currency: 'USD' });
  assert.equal(JSON.stringify(selected), before); assert.equal(f.calls.every(call => !call.url.includes('token=')), true);
});

test('quote refuses changed prices, foreign formatted currencies, expired/malformed data and unsafe precision', () => {
  for (const patch of [{ amount: 108 }, { amount_formatted: '107.01' }, { currency: 'EUR' }, { expires_at: now },
    { expires_at: now + 21 * 60_000 }, { token: 'not-signed' }, { amount: '107.001' }, { amount: '1e2' }]) {
    assert.throws(() => normalizeCheckoutQuote(quotePayload(patch), review(), now), /invalid_response/);
  }
  const selected = review(); selected.offer.price.amount = '107.000';
  assert.equal(normalizeCheckoutQuote(quotePayload({ amount: '107.000', amount_formatted: '107.0000' }), selected, now).amount, '107.000');
  const kwd = review(); kwd.offer.price = { amount: '1.0100', currency: 'KWD' };
  assert.equal(normalizeCheckoutQuote(quotePayload({ currency: 'KWD', amount: '1.010', amount_formatted: '1.010' }), kwd, now).currency, 'KWD');
  assert.throws(() => normalizeCheckoutQuote(quotePayload({ currency: 'KWD', amount: '1.001', amount_formatted: '1.001' }), kwd, now), /invalid_response/);
});

test('the guest-chosen payment currency is requested, and only a quote in that currency is accepted', async () => {
  const aed = review({ paymentCurrency: 'AED' });
  // The server's signed conversion of the USD offer; its amount differs from the USD total.
  const accepted = normalizeCheckoutQuote(quotePayload({ currency: 'AED', amount: '392.96', amount_formatted: '392.96' }), aed, now);
  assert.deepEqual([accepted.currency, accepted.amount], ['AED', '392.96']);
  for (const patch of [{}, { currency: 'AED', amount: '392.96', amount_formatted: '392.97' }, { currency: 'SAR', amount: '401.25', amount_formatted: '401.25' }]) {
    assert.throws(() => normalizeCheckoutQuote(quotePayload(patch), aed, now), /invalid_response/);
  }
  assert.throws(() => normalizeCheckoutQuote(quotePayload(), review({ paymentCurrency: 'XYZ' }), now), /unsupported_payment_currency/);
  const f = fixture();
  await assert.rejects(f.api.quote(aed)); // The fixture answers in USD, which an AED checkout must refuse.
  const post = f.calls.find(call => call.path.endsWith('/quote'));
  assert.equal(JSON.parse(post.options.body).payment_currency, 'AED');
});

test('accepted recheck currency is authoritative even when original search currency differs', async () => {
  const selected = review(); selected.criteria.currency = 'AED';
  const f = fixture(); assert.equal((await f.api.quote(selected)).currency, 'USD');
});

test('mode mismatches prevent quote, recovery and capability status; disabled readiness still allows owned reads', async () => {
  const wrong = fixture({ mode: 'production' });
  await assert.rejects(wrong.api.quote(review()), /checkout_environment_mismatch/);
  await assert.rejects(wrong.api.recover(key), /checkout_environment_mismatch/);
  await assert.rejects(wrong.api.status({ reference, accessToken }), /checkout_environment_mismatch/);
  assert.equal(wrong.calls.every(call => call.path.endsWith('/availability')), true);
  const disabled = fixture({ enabled: false });
  assert.equal((await disabled.api.recover(key)).found, true);
  assert.equal((await disabled.api.status({ reference, accessToken })).status, 'awaiting_payment');
  await assert.rejects(disabled.api.quote(review()), /checkout_unavailable/);
  assert.throws(() => normalizePaymentAvailability({ enabled: true, mode: 'unconfigured' }), /invalid_response/);
});

test('fixture-enabled create preserves exact occupancy, private context and idempotency without mutating guest data', async () => {
  const f = fixture({ financialWritesEnabled: true }), selected = review(), people = guests(), before = JSON.stringify(people);
  const result = await f.api.create({ review: selected, guests: people, quote: normalizeCheckoutQuote(quotePayload(), selected, now) }, key);
  assert.equal(result.attempt.status, 'awaiting_payment'); assert.equal(result.capability.accessToken, accessToken);
  const post = f.calls.find(call => call.path.endsWith('/intent')), sent = JSON.parse(post.options.body);
  assert.equal(post.options.headers.Authorization, 'Bearer ' + sessionToken); assert.equal(post.options.headers['Idempotency-Key'], key);
  assert.equal(sent.prebook_context, selected.prebookContext); assert.equal(sent.payment_quote, signed);
  assert.equal(sent.app_return, 'mkhadda-preview');
  assert.equal(sent.rooms[0].guests[0].firstName, people.guest.firstName); assert.equal(sent.rooms[0].guests[1].age, 7);
  assert.equal(sent.guest.specialRequests, people.guest.specialRequests); assert.equal(JSON.stringify(people), before);
  const bad = guests(); bad.rooms[0].guests[1].age = 8;
  await assert.rejects(f.api.create({ review: selected, guests: bad, quote: normalizeCheckoutQuote(quotePayload(), selected, now) }, key), /invalid_checkout_guests/);
  const childFirst = guests(); childFirst.rooms[0].guests.reverse();
  await assert.rejects(f.api.create({ review: selected, guests: childFirst, quote: normalizeCheckoutQuote(quotePayload(), selected, now) }, key), /invalid_checkout_guests/);
  assert.equal(f.calls.filter(call => call.path.endsWith('/intent')).length, 1);
});

test('status capability never leaks to URLs or user-session invalidation, including 401/404 responses', async () => {
  for (const failStatus of [401, 404]) {
    const f = fixture({ failStatus }); await assert.rejects(f.api.status({ reference, accessToken }));
    const get = f.calls.find(call => call.path.endsWith('/status'));
    assert.equal(get.options.headers.Authorization, 'Bearer ' + accessToken); assert.equal(get.url.includes(accessToken), false);
    assert.deepEqual(f.invalidations, []);
  }
  const f = fixture({ result: statusPayload({ access_token: accessToken, email: 'private@example.test', payment_url: 'https://pay.ziina.com/private' }) });
  assert.deepEqual(await f.api.status({ reference, accessToken }), { reference, status: 'awaiting_payment', confirmed: false, paymentVerified: false });
});

test('confirmation requires matching final state, verified payment and a real supplier reference', () => {
  const good = statusPayload({ status: 'booking_confirmed', confirmed: true, payment_verified: true, supplier_reference: 'supplier-fixture', voucher_delivery: 'pending' });
  assert.equal(normalizeCheckoutAttempt(good).confirmed, true);
  for (const patch of [{ status: 'booking_pending' }, { confirmed: false }, { payment_verified: undefined }, { payment_verified: false },
    { supplier_reference: undefined }, { supplier_reference: '' }, { reference: 'not-a-uuid' }]) assert.throws(() => normalizeCheckoutAttempt({ ...good, ...patch }), /invalid_response/);
  assert.throws(() => normalizeCheckoutAttempt(good, '64c986c5-784f-4dfa-8756-94743bda27d5'), /invalid_response/);
});

test('recovery absence cannot carry another owner capability and only Ziina HTTPS payment URLs are accepted', () => {
  assert.deepEqual(normalizeCheckoutRecovery({ found: false }), { found: false });
  assert.throws(() => normalizeCheckoutRecovery({ found: false, access_token: accessToken }), /invalid_response/);
  const known = normalizeCheckoutRecovery({ found: true, ...statusPayload({ status: 'preflight_failed' }), access_token: accessToken });
  assert.equal(known.attempt.status, 'preflight_failed'); assert.equal(known.paymentUrl, undefined);
  for (const url of ['http://pay.ziina.com/x', 'https://ziina.com.evil.test/x', 'https://evil-ziina.com/x',
    'https://user@pay.ziina.com/x', 'https://pay.ziina.com:8443/x', 'javascript:alert(1)']) assert.throws(() => checkoutPaymentUrl(url), /invalid_response/);
  assert.throws(() => normalizeCheckoutCreate({ ...statusPayload({ status: 'intent_unknown' }), access_token: accessToken, payment_url: 'https://pay.ziina.com/x' }), /invalid_response/);
});

test('composite quote/create/recovery pin the starting session across an asynchronous mode check', async () => {
  for (const operation of ['quote', 'create', 'recover']) {
    let currentToken = sessionToken, release, entered, captures = 0;
    const mode = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const posts = [];
    const transport = createTransport({ environment: 'staging', getToken: async () => { captures++; return currentToken; }, fetcher: async (url, options) => {
      if (url.endsWith('/availability')) { entered(); await mode; return new Response(JSON.stringify({ enabled: true, mode: 'sandbox' })); }
      posts.push(options);
      return new Response(JSON.stringify(operation === 'quote' ? quotePayload() : operation === 'recover'
        ? { found: false } : { ...statusPayload(), access_token: accessToken }));
    } });
    const api = createCheckoutApi(transport, { environment: 'staging', financialWritesEnabled: true, now: () => now });
    const selected = review(), pending = operation === 'quote' ? api.quote(selected) : operation === 'recover' ? api.recover(key)
      : api.create({ review: selected, guests: guests(), quote: normalizeCheckoutQuote(quotePayload(), selected, now) }, key);
    await started; currentToken = 'd'.repeat(64); release(); await pending;
    assert.equal(captures, 1); assert.equal(posts.length, 1); assert.equal(posts[0].headers.Authorization, 'Bearer ' + sessionToken);
  }
});

test('aborting a pinned operation during mode lookup prevents its authenticated POST', async () => {
  let release, entered, posts = 0;
  const mode = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const transport = createTransport({ environment: 'staging', getToken: async () => sessionToken, fetcher: async (url) => {
    if (url.endsWith('/availability')) { entered(); await mode; return new Response(JSON.stringify({ enabled: true, mode: 'sandbox' })); }
    posts++; return new Response('{}');
  } });
  const api = createCheckoutApi(transport), controller = new AbortController();
  const pending = api.recover(key, controller.signal); await started; controller.abort(); release();
  await assert.rejects(pending, error => error.kind === 'aborted'); assert.equal(posts, 0);
});

test('Tabby: availability flag, its own checkout host, payment errors only on failed attempts, and an allowed eligibility route', () => {
  assert.equal(normalizePaymentAvailability({ enabled: true, mode: 'sandbox', tabby: true }).tabby, true);
  assert.equal(normalizePaymentAvailability({ enabled: true, mode: 'sandbox' }).tabby, false);
  assert.equal(normalizePaymentAvailability({ enabled: false, mode: 'sandbox', tabby: true, reason: 'checkout_unavailable' }).tabby, false, 'never offered while checkout is closed');
  assert.equal(checkoutPaymentUrl('https://checkout.tabby.ai/?sessionId=abc'), 'https://checkout.tabby.ai/?sessionId=abc');
  for (const bad of ['https://checkout.tabby.ai.evil.example/', 'https://eviltabby.ai/', 'http://checkout.tabby.ai/']) assert.throws(() => checkoutPaymentUrl(bad));
  const failed = normalizeCheckoutAttempt({ reference, status: 'payment_failed', confirmed: false, payment_method: 'tabby', payment_error: 'tabby_order_amount_too_high' });
  assert.deepEqual([failed.paymentMethod, failed.paymentError], ['tabby', 'tabby_order_amount_too_high']);
  assert.throws(() => normalizeCheckoutAttempt({ reference, status: 'awaiting_payment', confirmed: false, payment_error: 'tabby_expired' }));
  assert.throws(() => normalizeCheckoutAttempt({ reference, status: 'payment_failed', confirmed: false, payment_error: 'Card <b>' }));
  assert.equal(allowedRoute('POST', '/payment/tabby/eligibility'), true);
  assert.equal(allowedRoute('GET', '/payment/tabby/eligibility'), false);
});
