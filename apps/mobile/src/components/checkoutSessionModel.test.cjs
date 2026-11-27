/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    let full = path.resolve(__dirname, file);
    if (!fs.existsSync(full)) full += '.ts';
    if (cache.has(full)) return cache.get(full).exports;
    const module = { exports: {} }; cache.set(full, module);
    const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', output)(name => Object.hasOwn(overrides, name) ? overrides[name]
      : name.startsWith('.') ? load(path.resolve(path.dirname(full), name)) : require(name), module, module.exports);
    return module.exports;
  }
  return load;
}
const load = loader();
const { createCheckoutSession } = load('./checkoutSessionModel.ts');
const { createRecoveryStorage, validateRecoveryRecord, recoveryStorageKey } = load('./checkoutRecoveryStorage.types.ts');
const { ApiError } = load('../api/errors.ts');
const key = '11111111-1111-4111-8111-111111111111';
const reference = '22222222-2222-4222-8222-222222222222';
const otherKey = '33333333-3333-4333-8333-333333333333';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const travelers = () => ({ guest: { firstName: 'Fixture', lastName: 'Traveler', email: 'fixture@example.test', phone: '+971500000000' },
  rooms: [{ guests: [{ firstName: 'Fixture', lastName: 'Traveler', is_child: false }] }] });
function memory() {
  const values = new Map();
  return { values, backend: { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); } } };
}
function fixture(options = {}) {
  let clock = 1_000_000, enabled = true;
  let identity = { environment: 'staging', ownerDigest: 'a'.repeat(64), revision: 1 };
  let selected = { selectionId: 'review-1', expiresAt: clock + 300_000, termsAccepted: true,
    review: { hid: 10004834, hotelName: 'Fixture hotel', prebookContext: 'private-prebook-proof', criteria: { checkin: '2099-02-16', checkout: '2099-02-18', residency: 'ae', currency: 'USD', guests: [{ adults: 1, children: [] }], hids: [10004834] },
      offer: { id: 'selected', name: 'Fixture room', bookHash: 'p-private', offerContext: 'private-offer-proof', price: { amount: '100', currency: 'USD' }, images: [], taxes: [], cancellation: { freeUntil: null, policies: [] } } } };
  const mem = options.memory || memory(), storage = options.storage || createRecoveryStorage(mem.backend), calls = [];
  const quote = () => ({ currency: 'USD', amount: '100.00', amountFormatted: 'USD 100.00', expiresAt: clock + 60_000, token: 'private-quote-token' });
  const attempt = (status = 'awaiting_payment') => ({ reference, status, confirmed: status === 'booking_confirmed', paymentVerified: status === 'booking_confirmed',
    ...(status === 'booking_confirmed' ? { supplierReference: 'fixture-supplier-reference' } : {}) });
  const result = (status = 'awaiting_payment') => ({ attempt: attempt(status), capability: { reference, accessToken: 'c'.repeat(64) }, ...(status === 'awaiting_payment' ? { paymentUrl: 'https://pay.example.test/fixture' } : {}) });
  const api = {
    creationEnabled: true,
    availability: async () => { calls.push({ kind: 'availability' }); return { enabled: true, mode: 'sandbox' }; },
    quote: async () => { calls.push({ kind: 'quote' }); return quote(); },
    create: async (input, idempotencyKey) => { calls.push({ kind: 'create', input, idempotencyKey }); return result(); },
    status: async capability => { calls.push({ kind: 'status', capability }); return attempt(); },
    recover: async idempotencyKey => { calls.push({ kind: 'recover', idempotencyKey }); return { found: false }; },
    ...options.api
  };
  const session = createCheckoutSession({ api, storage, getOwner: () => identity, getReview: () => selected,
    canCreate: () => enabled, randomUUID: () => key, now: () => clock });
  return { session, api, calls, storage, memory: mem, quote, result, attempt, owner: () => identity, selection: () => selected,
    setOwner: value => { identity = value; }, setSelection: value => { selected = value; }, gate: value => { enabled = value; },
    advance: ms => { clock += ms; }, now: () => clock,
    init: async () => { await session.recover(); await session.loadAvailability(); await session.quote(); } };
}

test('quote remains available with creation disabled; no traveler collection, key or create dispatch', async () => {
  const f = fixture(); f.gate(false); await f.init();
  assert.equal(f.session.presentation().quote.amount, '100.00');
  assert.equal(f.session.presentation().canCollectTravelers, false);
  await f.session.submit(travelers(), true);
  assert.equal(f.calls.filter(x => x.kind === 'create').length, 0);
  assert.equal(f.memory.values.size, 0);
  f.gate(true); f.api.creationEnabled = false;
  assert.equal(f.session.presentation().canSubmit, false);
});
test('website fallback waits for local recovery, blocks stale clicks during work and masks read failure/owner change', async () => {
  const read = deferred(), base = createRecoveryStorage(memory().backend);
  const storage = { ...base, read: async () => read.promise };
  const f = fixture({ storage }); const restoring = f.session.recover(); await tick();
  assert.equal(f.session.presentation().recoveryChecked, false); assert.equal(f.session.canOpenWebsite(), false);
  read.resolve(null); await restoring;
  assert.equal(f.session.presentation().recoveryChecked, true); assert.equal(f.session.canOpenWebsite(), true);
  await f.session.loadAvailability(); const quote = deferred(); f.api.quote = async () => quote.promise;
  const checking = f.session.quote(); assert.equal(f.session.canOpenWebsite(), false); quote.resolve(f.quote()); await checking;
  assert.equal(f.session.canOpenWebsite(), true);
  const creating = f.session.submit(travelers(), true); assert.equal(f.session.canOpenWebsite(), false); await creating;
  assert.equal(f.session.canOpenWebsite(), false);
  f.storage.read = async () => { throw new ApiError('storage', 'checkout_recovery_unavailable'); }; await f.session.recover();
  assert.equal(f.session.presentation().recoveryChecked, false); assert.equal(f.session.canOpenWebsite(), false);
  f.setOwner(null); assert.equal(f.session.presentation().recoveryChecked, false); assert.equal(f.session.canOpenWebsite(), false);
});
test('one submit persists only a safe recovery key before dispatch; public snapshots contain no PII or capabilities', async () => {
  const f = fixture(); await f.init();
  const original = f.api.create;
  f.api.create = async (input, idempotencyKey) => {
    const stored = await f.storage.read(f.owner());
    assert.equal(stored.idempotencyKey, idempotencyKey);
    assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'environment', 'idempotencyKey', 'ownerDigest', 'version']);
    return original(input, idempotencyKey);
  };
  const form = travelers(); const pending = f.session.submit(form, true); form.guest.firstName = 'Changed after press';
  await pending;
  assert.equal(f.calls.find(x => x.kind === 'create').input.guests.guest.firstName, 'Fixture');
  const publicText = JSON.stringify(f.session.presentation());
  assert.doesNotMatch(publicText, /fixture@example|private-|accessToken|paymentUrl|p-private/);
  assert.equal(f.session.getPaymentHandoff(), 'https://pay.example.test/fixture');
  assert.equal(f.session.presentation().attempt.confirmed, false);
});
test('single-flight unknown create never resubmits; missing recovery is still unknown and later recovery can restore status', async () => {
  const held = deferred(), f = fixture(); await f.init();
  f.api.create = async () => { f.calls.push({ kind: 'create' }); return held.promise; };
  const one = f.session.submit(travelers(), true), two = f.session.submit(travelers(), true); await tick();
  assert.equal(one, two);
  assert.equal(f.calls.filter(x => x.kind === 'create').length, 1);
  held.reject(new ApiError('timeout', 'request_timeout')); await Promise.all([one, two]);
  assert.equal(f.session.presentation().phase, 'unknown');
  await f.session.recover(); await f.session.submit(travelers(), true);
  assert.equal(f.session.presentation().phase, 'unknown');
  assert.equal(f.calls.filter(x => x.kind === 'create').length, 1);
  f.api.recover = async recoveredKey => { assert.equal(recoveredKey, key); return { found: true, ...f.result() }; };
  await f.session.recover(); assert.equal(f.session.presentation().phase, 'active');
  assert.equal(f.session.presentation().attempt.reference, reference);
  f.api.recover = async () => ({ found: true, ...f.result(), paymentUrl: undefined });
  await f.session.recover(); assert.equal(f.session.getPaymentHandoff(), null);
});
test('restart resumes by authenticated key without a guest payload or a new create', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), true);
  const next = fixture({ memory: f.memory }); next.api.recover = async value => { assert.equal(value, key); return { found: true, ...next.result('booking_confirmed') }; };
  await next.session.recover();
  assert.equal(next.session.presentation().attempt.confirmed, true);
  assert.equal(next.calls.filter(x => x.kind === 'create').length, 0);
  assert.equal(next.session.getPaymentHandoff(), null);
});
test('changed owner masks synchronously and discards a late create, retaining only the old owner recovery key', async () => {
  const held = deferred(), f = fixture(); await f.init();
  f.api.create = async () => held.promise;
  const submitting = f.session.submit(travelers(), true); await tick();
  const firstOwner = f.owner();
  f.setOwner({ ...firstOwner, ownerDigest: 'b'.repeat(64), revision: 2 });
  assert.equal(f.session.presentation().hasRecovery, false);
  assert.equal(f.session.getSnapshot().attempt, null);
  f.session.sync(); await submitting;
  held.resolve(f.result('booking_confirmed')); await tick();
  await f.session.recover(); assert.equal(f.session.presentation().attempt, null);
  assert.ok(await f.storage.read(firstOwner));
  assert.equal(await f.storage.read(f.owner()), null);
  assert.equal(f.session.getPaymentHandoff(), null);
});
test('owner change while storage is pending prevents dispatch after persistence finishes', async () => {
  const gate = deferred(), mem = memory(), base = createRecoveryStorage(mem.backend);
  const storage = { ...base, write: async record => { await gate.promise; await base.write(record); } };
  const f = fixture({ memory: mem, storage }); await f.init();
  const submitting = f.session.submit(travelers(), true); await tick();
  f.setOwner(null); f.session.sync(); gate.resolve(); await submitting;
  assert.equal(f.calls.filter(x => x.kind === 'create').length, 0);
  assert.equal(f.session.presentation().canSubmit, false);
});
test('expiry or disabled readiness during persistence retains an unknown key without dispatch', async () => {
  for (const stop of ['expiry', 'local-gate', 'backend-gate']) {
    const gate = deferred(), mem = memory(), base = createRecoveryStorage(mem.backend);
    const storage = { ...base, write: async record => { await gate.promise; await base.write(record); } };
    const f = fixture({ memory: mem, storage }); await f.init();
    const submitting = f.session.submit(travelers(), true); await tick();
    if (stop === 'expiry') f.advance(60_001);
    if (stop === 'local-gate') f.gate(false);
    if (stop === 'backend-gate') { f.api.availability = async () => ({ enabled: false, mode: 'sandbox' }); await f.session.loadAvailability(); }
    gate.resolve(); await submitting;
    assert.equal(f.calls.filter(x => x.kind === 'create').length, 0);
    assert.equal(f.session.presentation().phase, 'unknown');
    assert.equal((await f.storage.read(f.owner())).idempotencyKey, key);
  }
});
test('expired or replaced proof/quote cannot collect or submit; late quote cannot repopulate a new selection', async () => {
  const f = fixture(); await f.init(); f.advance(60_001);
  assert.equal(f.session.presentation().canCollectTravelers, false);
  await f.session.submit(travelers(), true); assert.equal(f.memory.values.size, 0);
  f.session.sync(); assert.equal(f.session.presentation().quote, null);
  const held = deferred(); f.api.quote = async () => held.promise;
  const quoting = f.session.quote(); await tick();
  f.setSelection({ ...f.selection(), selectionId: 'review-2' }); held.resolve(f.quote()); await quoting;
  assert.equal(f.session.presentation().quote, null);
  assert.equal(f.session.presentation().phase, 'error');
});
test('selection deadline exists without a quote and notifies the view exactly when freshness expires', async () => {
  const f = fixture(); await f.session.recover();
  assert.equal(f.session.getDeadline(), f.selection().expiresAt);
  assert.equal(f.session.presentation().canQuote, true);
  let notifications = 0; const remove = f.session.subscribe(() => notifications++);
  f.session.sync(); assert.equal(notifications, 0);
  f.advance(300_001); f.session.sync();
  assert.equal(notifications, 1); assert.equal(f.session.presentation().canQuote, false); assert.equal(f.session.getDeadline(), null);
  f.session.sync(); assert.equal(notifications, 1);
  assert.equal(f.calls.filter(x => ['quote', 'create', 'recover'].includes(x.kind)).length, 0); remove();
});
test('consent and matching backend environment are required independently of configured creation', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), false);
  assert.equal(f.memory.values.size, 0);
  f.api.availability = async () => ({ enabled: true, mode: 'production' }); await f.session.loadAvailability();
  assert.equal(f.session.presentation().canCollectTravelers, false);
  assert.equal(f.session.presentation().availability.enabled, false);
});
test('quote must match the selected customer currency and exact decimal amount, including beyond numeric precision', async () => {
  for (const change of [{ currency: 'EUR' }, { amount: '101.00' }, { amount: '100.00000000000000001' }]) {
    const f = fixture(); await f.session.recover(); await f.session.loadAvailability();
    f.api.quote = async () => ({ ...f.quote(), ...change }); await f.session.quote();
    assert.equal(f.session.presentation().quote, null); assert.equal(f.session.presentation().canSubmit, false);
  }
  const f = fixture(); await f.init(); assert.equal(f.session.presentation().quote.amount, '100.00');
});
test('confirmed status requires both verified payment and a nonempty supplier confirmation reference', async () => {
  for (const change of [{ paymentVerified: false }, { supplierReference: undefined }, { supplierReference: ' ' }]) {
    const f = fixture(); await f.init();
    f.api.create = async () => ({ ...f.result('booking_confirmed'), attempt: { ...f.attempt('booking_confirmed'), ...change } });
    await f.session.submit(travelers(), true);
    assert.equal(f.session.presentation().phase, 'unknown'); assert.equal(f.session.presentation().attempt, null);
  }
  const f = fixture(); await f.init();
  f.api.create = async () => ({ ...f.result('booking_confirmed'), attempt: { ...f.attempt('booking_confirmed'), supplierReference: 'r'.repeat(256) } });
  await f.session.submit(travelers(), true); assert.equal(f.session.presentation().attempt.supplierReference.length, 256);
});
test('malformed status or wrong reference stays unknown and never becomes a confirmation or payment handoff', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), true);
  f.api.status = async () => ({ ...f.attempt('booking_confirmed'), reference: otherKey }); await f.session.refreshStatus();
  assert.equal(f.session.presentation().phase, 'unknown');
  assert.equal(f.session.presentation().attempt.confirmed, false);
  assert.equal(f.session.getPaymentHandoff(), null);
  f.api.status = async () => ({ ...f.attempt('booking_confirmed'), confirmed: false }); await f.session.refreshStatus();
  assert.equal(f.session.presentation().phase, 'unknown');
});
test('pending/refund-review attempts cannot be cleared; explicit completed clear requires a fresh selection', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), true);
  f.api.status = async () => ({ ...f.attempt('refund_review'), paymentVerified: true }); await f.session.refreshStatus();
  assert.equal(await f.session.clearCompleted(), false); assert.equal(f.session.presentation().hasRecovery, true);
  f.api.status = async () => f.attempt('booking_confirmed'); await f.session.refreshStatus();
  assert.equal(f.session.presentation().canClearCompleted, true);
  assert.equal(await f.session.clearCompleted(), true); assert.equal(await f.storage.read(f.owner()), null);
  assert.equal(f.session.presentation().canQuote, false);
  f.setSelection({ ...f.selection(), selectionId: 'fresh-review' }); assert.equal(f.session.presentation().canQuote, true);
});
test('a finished attempt yields to a newly chosen room; an open attempt or the same room does not', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), true);
  assert.equal(f.session.presentation().replaceCompleted, false);
  f.setSelection({ ...f.selection(), selectionId: 'new-room' });
  assert.equal(f.session.presentation().replaceCompleted, false, 'awaiting payment is never replaced');
  f.api.status = async () => f.attempt('booking_confirmed'); await f.session.refreshStatus();
  assert.equal(f.session.presentation().replaceCompleted, true);
  f.setSelection({ ...f.selection(), selectionId: 'review-1' });
  assert.equal(f.session.presentation().replaceCompleted, false, 'the booked room itself does not clear its own status');
  f.setSelection({ ...f.selection(), selectionId: 'new-room' });
  assert.equal(await f.session.clearCompleted(), true);
  assert.equal(f.session.presentation().attempt, null); assert.equal(f.session.presentation().canQuote, true);
});
test('storage corruption or partial write failure cannot become a new financial dispatch', async () => {
  const mem = memory(), f = fixture({ memory: mem }); mem.values.set(recoveryStorageKey(f.owner()), '{broken');
  await f.init(); assert.equal(f.session.presentation().canSubmit, false); assert.equal(f.calls.filter(x => x.kind === 'quote').length, 0);
  mem.values.clear(); await f.session.recover(); await f.session.quote();
  mem.backend.set = async (storedKey, value) => { mem.values.set(storedKey, value); throw Error('native failed after write'); };
  await f.session.submit(travelers(), true);
  assert.equal(f.session.presentation().canSubmit, false); assert.equal(f.calls.filter(x => x.kind === 'create').length, 0);
  await f.session.recover(); assert.equal(f.session.presentation().phase, 'unknown');
});
test('recovery records reject extras, separate owner/environment, serialize competing writes and compare-and-remove', async () => {
  const mem = memory(), store = createRecoveryStorage(mem.backend), f = fixture();
  const record = { version: 1, ...f.owner(), idempotencyKey: key, createdAt: 1 };
  delete record.revision;
  assert.throws(() => validateRecoveryRecord({ ...record, email: 'fixture@example.test' }));
  await store.write(record);
  assert.equal(await store.read({ ...record, environment: 'production' }), null);
  assert.equal(await store.read({ ...record, ownerDigest: 'b'.repeat(64) }), null);
  await assert.rejects(store.write({ ...record, idempotencyKey: otherKey }), error => error.code === 'checkout_recovery_pending');
  assert.equal(await store.remove({ ...record, idempotencyKey: otherKey }), false);
  assert.equal((await store.read(record)).idempotencyKey, key);
  assert.equal(await store.remove(record), true);
});
test('native recovery uses SecureStore while web remains memory-only and native failure has no fallback', async () => {
  const writes = [], saved = new Map();
  const native = loader({ 'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    getItemAsync: async key => saved.get(key) ?? null, setItemAsync: async (key, value, options) => { writes.push(options); saved.set(key, value); }, deleteItemAsync: async key => { saved.delete(key); } } })('./checkoutRecoveryStorage.native.ts').createCheckoutRecoveryStorage();
  const owner = { environment: 'staging', ownerDigest: 'd'.repeat(64) }, record = { version: 1, ...owner, idempotencyKey: key, createdAt: 1 };
  await native.write(record); assert.deepEqual(writes, [{ keychainAccessible: 'device-only' }]);
  const web = load('./checkoutRecoveryStorage.web.ts').createCheckoutRecoveryStorage();
  assert.equal(await web.read(owner), null); await web.write(record); assert.deepEqual(await web.read(owner), record);
  const failed = loader({ 'expo-secure-store': { getItemAsync: async () => { throw Error('native failure'); } } })('./checkoutRecoveryStorage.native.ts').createCheckoutRecoveryStorage();
  await assert.rejects(failed.read(owner), error => error.kind === 'storage');
});
test('choosing Tabby (AED) drops the card price lock; the next lock is for the new method and currency', async () => {
  const f = fixture({ api: { quote: async review => ({ currency: review.paymentCurrency || 'USD', amount: review.paymentCurrency === 'AED' ? '367.25' : '100.00',
    amountFormatted: 'fixture', expiresAt: f.now() + 60_000, token: 'private-quote-token' }) } });
  await f.init();
  assert.equal(f.session.presentation().quote.currency, 'USD');
  f.setSelection({ ...f.selection(), review: { ...f.selection().review, paymentMethod: 'tabby', paymentCurrency: 'AED' } });
  f.session.sync();
  assert.equal(f.session.presentation().quote, null, 'the USD lock no longer applies');
  assert.equal(f.session.presentation().canSubmit, false);
  await f.session.quote();
  assert.deepEqual([f.session.presentation().quote.currency, f.session.presentation().quote.amount], ['AED', '367.25']);
  assert.equal(f.session.presentation().canSubmit, true);
});
test('a payment that did not go through can be retried another way for the same room; a paid one cannot', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), true);
  f.api.status = async () => ({ ...f.attempt('payment_failed'), paymentMethod: 'tabby', paymentError: 'tabby_expired' });
  await f.session.refreshStatus();
  assert.equal(f.session.presentation().attempt.paymentError, 'tabby_expired');
  assert.equal(await f.session.clearCompleted({ keepSelection: true }), true);
  assert.equal(f.session.presentation().attempt, null);
  assert.equal(f.session.presentation().canQuote, true, 'same room, new price lock');
  // Without keepSelection the room stays consumed, as before.
  const g = fixture(); await g.init(); await g.session.submit(travelers(), true);
  g.api.status = async () => g.attempt('payment_failed'); await g.session.refreshStatus();
  assert.equal(await g.session.clearCompleted(), true);
  assert.equal(g.session.presentation().canQuote, false);
  // A confirmed booking never frees its room for a second payment.
  const h = fixture(); await h.init(); await h.session.submit(travelers(), true);
  h.api.status = async () => h.attempt('booking_confirmed'); await h.session.refreshStatus();
  assert.equal(await h.session.clearCompleted({ keepSelection: true }), true);
  assert.equal(h.session.presentation().canQuote, false);
});
test('a price lock that returns after the guest switched method is dropped quietly and asked again, not shown as an error', async () => {
  const gate = deferred();
  const f = fixture({ api: { quote: async review => { await gate.promise; return { currency: review.paymentCurrency || 'USD', amount: review.paymentCurrency === 'AED' ? '367.25' : '100.00',
    amountFormatted: 'fixture', expiresAt: f.now() + 60_000, token: 'private-quote-token' }; } } });
  await f.session.recover(); await f.session.loadAvailability();
  f.setSelection({ ...f.selection(), review: { ...f.selection().review, paymentMethod: 'tabby', paymentCurrency: 'AED' } });
  const pending = f.session.quote();
  await tick(); await tick();
  f.setSelection({ ...f.selection(), review: { ...f.selection().review, paymentMethod: 'card', paymentCurrency: undefined } });
  gate.resolve(); await pending;
  assert.equal(f.session.presentation().error, null);
  assert.equal(f.session.presentation().quote, null);
  assert.equal(f.session.presentation().canQuote, true);
  await f.session.quote();
  assert.equal(f.session.presentation().quote.currency, 'USD');
});

test('a booking the guest cancelled after confirmation is finished here and yields to the next stay', async () => {
  const f = fixture(); await f.init(); await f.session.submit(travelers(), true);
  // The server says so directly.
  f.api.status = async () => ({ ...f.attempt('refund_pending'), paymentVerified: true, guestCancelled: true }); await f.session.refreshStatus();
  assert.equal(f.session.presentation().attempt.guestCancelled, true);
  assert.equal(f.session.presentation().canClearCompleted, true);
  f.setSelection({ ...f.selection(), selectionId: 'next-stay' });
  assert.equal(f.session.presentation().replaceCompleted, true);
  assert.equal(await f.session.clearCompleted(), true);
  assert.equal(await f.storage.read(f.owner()), null);
});

test('an older server: the account’s cancelled booking record identifies a guest cancellation', async () => {
  const asked = [];
  const f = fixture({ api: { bookingCancelled: async reference => { asked.push(reference); return true; } } });
  await f.init(); await f.session.submit(travelers(), true);
  f.api.status = async () => ({ ...f.attempt('refund_pending'), paymentVerified: true }); await f.session.refreshStatus();
  assert.equal(f.session.presentation().attempt.guestCancelled, true);
  assert.equal(f.session.presentation().canClearCompleted, true);
  await f.session.refreshStatus();
  assert.equal(f.session.presentation().attempt.guestCancelled, true, 'later statuses keep saying so');
  assert.equal(asked.length, 1, 'the records are read once per booking');
});

test('a refund for a booking that failed is never mistaken for a guest cancellation', async () => {
  const f = fixture({ api: { bookingCancelled: async () => false } }); await f.init(); await f.session.submit(travelers(), true);
  f.api.status = async () => ({ ...f.attempt('refund_pending'), paymentVerified: true }); await f.session.refreshStatus();
  assert.equal(f.session.presentation().attempt.guestCancelled, undefined);
  assert.equal(f.session.presentation().canClearCompleted, false);
  // A flag the server could not have sent (unpaid, or still confirmed) is dropped.
  f.api.status = async () => ({ ...f.attempt('payment_failed'), guestCancelled: true }); await f.session.refreshStatus();
  assert.equal(f.session.presentation().attempt.guestCancelled, undefined);
  // A failed records check changes nothing.
  const g = fixture({ api: { bookingCancelled: async () => { throw new Error('offline'); } } }); await g.init(); await g.session.submit(travelers(), true);
  g.api.status = async () => ({ ...g.attempt('refund_pending'), paymentVerified: true }); await g.session.refreshStatus();
  assert.equal(g.session.presentation().canClearCompleted, false);
  assert.equal(g.session.presentation().phase, 'active');
});
