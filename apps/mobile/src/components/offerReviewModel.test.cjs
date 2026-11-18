/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
  }).outputText;
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(full), name);
    if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!path.extname(target)) target += '.ts';
    return load(target);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}
const { createOfferReviewDraft, createOfferReviewSession, offerTerms, criteriaIdentity,
  REVIEW_CHECK_LIFETIME_MS, REVIEW_SELECTION_LIFETIME_MS } = load('./offerReviewModel.ts');
const { ApiError } = load('../api/errors.ts');
const copy = value => JSON.parse(JSON.stringify(value));
function criteria() {
  const date = new Date(); date.setDate(date.getDate() + 30); const checkin = date.toISOString().slice(0, 10);
  date.setDate(date.getDate() + 2);
  return { checkin, checkout: date.toISOString().slice(0, 10), residency: 'ae', currency: 'USD',
    guests: [{ adults: 2, children: [0, 17] }], regionId: 6053839 };
}
const offer = () => ({ id: 'fixture-h', name: 'Selected suite', bookHash: 'h-private', offerContext: 'signed.private',
  roomIdentity: 'same-full-classification', price: { amount: '107.00', currency: 'USD' }, meal: 'nomeal', images: [],
  taxes: [{ name: 'city_tax', amount: '0.00', currency_code: 'AED', included_by_supplier: false }],
  cancellation: { freeUntil: '2099-01-01T00:00:00.000Z', policies: [{ startAt: null, endAt: null, amount: '0.00', currency: 'USD' }] } });
const result = (selected, patch = {}) => ({ offer: { ...copy(selected), bookHash: 'p-private', price: { amount: '107', currency: 'USD' } },
  priceChanged: false, prebookContext: 'signed.prebook.private', ...patch });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(prebook) {
  let clock = Date.now(), draft = createOfferReviewDraft({ hid: 10004834, hotelName: 'Hotel fixture',
    criteria: criteria(), offer: offer(), language: 'ar' }, 'staging:signedIn:1', clock);
  const calls = [];
  const session = createOfferReviewSession({ getDraft: () => draft, clearDraft: () => { draft = null; }, now: () => clock,
    prebook: async (hid, selected, signal) => { calls.push({ hid, selected, signal }); return prebook ? prebook(hid, selected, signal) : result(selected); } });
  session.sync();
  return { session, calls, get draft() { return draft; }, setDraft(value) { draft = value; }, advance(ms) { clock += ms; },
    freshDraft() { return createOfferReviewDraft({ hid: 10004834, hotelName: 'Another selection', criteria: criteria(), offer: offer(), language: 'en' }, 'staging:signedIn:2', clock); } };
}

test('review draft is a private immutable snapshot without extra caller fields or caller mutation', () => {
  const input = { hid: 10004834, hotelName: 'Hotel', criteria: criteria(), offer: offer(), language: 'ar', access_token: 'must-not-copy' };
  const draft = createOfferReviewDraft(input, 'owner');
  assert.ok(draft); assert.equal(draft.access_token, undefined); assert.equal(Object.isFrozen(draft.offer), true);
  assert.equal(Object.isFrozen(input.offer), false);
  input.criteria.guests[0].children.push(10); input.offer.price.amount = '1';
  assert.deepEqual(draft.criteria.guests[0].children, [0, 17]); assert.equal(draft.offer.price.amount, '107.00');
  for (const patch of [{ hid: -1 }, { offer: { ...offer(), bookHash: 'p-stale' } }, { offer: { ...offer(), offerContext: undefined } },
    { offer: { ...offer(), price: null } }, { criteria: { ...criteria(), residency: 'zz' } }]) assert.equal(createOfferReviewDraft({ ...input, ...patch }, 'owner'), null);
});
test('a new room review must use the requested search currency without converting the supplied amount', () => {
  const foreign = { ...offer(), price: { amount: '176.00', currency: 'EUR' } };
  const input = { hid: 10004834, hotelName: 'Hotel', criteria: criteria(), offer: foreign, language: 'en' };
  assert.equal(createOfferReviewDraft(input, 'owner'), null);
  const accepted = createOfferReviewDraft({ ...input, criteria: { ...criteria(), currency: 'EUR' } }, 'owner');
  assert.deepEqual(accepted.offer.price, { amount: '176.00', currency: 'EUR' });
  assert.equal(accepted.criteria.currency, 'EUR');
});

test('recheck is explicit and only a successful current response permits a search-only handoff', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.session.getHandoff(), null);
  await f.session.recheck(); const view = f.session.presentation();
  assert.equal(view.status, 'ready'); assert.equal(view.canContinue, true);
  const handoff = f.session.getHandoff(); assert.deepEqual(Object.keys(handoff).sort(), ['criteria', 'hid']);
  assert.deepEqual(handoff.criteria, f.draft.criteria); assert.doesNotMatch(JSON.stringify(handoff), /private|bookHash|offerContext|ownerKey|prebook/);
  handoff.criteria.guests[0].children.push(5); assert.deepEqual(f.draft.criteria.guests[0].children, [0, 17]);
});
test('changed customer price requires explicit acceptance and a second check resets acceptance', async () => {
  const f = fixture((hid, selected) => result(selected, { priceChanged: true }));
  await f.session.recheck(); assert.equal(f.session.presentation().status, 'changed'); assert.equal(f.session.getHandoff(), null);
  f.session.acceptChanges(f.session.presentation().confirmationRevision); assert.ok(f.session.getHandoff());
  await f.session.recheck(); assert.equal(f.session.presentation().changesAccepted, false); assert.equal(f.session.getHandoff(), null);
  assert.equal(f.calls[1].selected.bookHash, 'h-private'); assert.equal(f.calls[1].selected.offerContext, 'signed.private');
});
test('tax inclusion, currency, cancellation and meal changes require acceptance even without price_changed', async () => {
  for (const mutate of [value => { value.taxes[0].included_by_supplier = null; }, value => { value.taxes[0].currency_code = 'USD'; },
    value => { value.cancellation.policies[0].amount = '1.00'; }, value => { value.meal = 'breakfast'; }]) {
    const f = fixture((hid, selected) => { const next = result(selected); mutate(next.offer); return next; });
    await f.session.recheck(); assert.equal(f.session.presentation().status, 'changed'); assert.equal(f.session.getHandoff(), null);
  }
});
test('only the exact review displayed to the traveler can be accepted, through refresh and expiry', async () => {
  const f = fixture((hid, selected) => result(selected, { priceChanged: true }));
  await f.session.recheck();
  const first = f.session.presentation().confirmationRevision;
  await f.session.recheck();
  const second = f.session.presentation().confirmationRevision;
  assert.notEqual(first, second);
  f.session.acceptChanges(first);
  f.session.acceptChanges(null);
  assert.equal(f.session.getHandoff(), null);
  assert.equal(f.session.getCheckoutReview(), null);
  f.session.acceptChanges(second);
  assert.ok(f.session.getHandoff());
  f.advance(REVIEW_CHECK_LIFETIME_MS);
  f.session.acceptChanges(second);
  assert.equal(f.session.getHandoff(), null);
  assert.equal(f.session.getCheckoutReview(), null);
});
test('new, changed or withdrawn bed and payment facts require explicit acceptance of the returned offer', async () => {
  for (const [before, after] of [
    [{}, { bedding: 'Twin beds' }], [{ bedding: 'Twin beds' }, { bedding: 'Double bed' }],
    [{ bedding: 'Double bed' }, {}], [{ paymentType: 'deposit' }, {}], [{}, { paymentType: 'deposit' }],
  ]) {
    const f = fixture((_hid, selected) => {
      const next = result(selected);
      delete next.offer.bedding; delete next.offer.paymentType;
      Object.assign(next.offer, after);
      return next;
    });
    f.setDraft({ ...f.draft, offer: { ...f.draft.offer, ...before } });
    await f.session.recheck();
    assert.equal(f.session.presentation().status, 'changed');
    assert.equal(f.session.getCheckoutReview(), null);
    assert.equal(f.session.getHandoff(), null);
    f.session.acceptChanges(f.session.presentation().confirmationRevision);
    assert.ok(f.session.getCheckoutReview());
    assert.ok(f.session.getHandoff());
  }
});
test('a newly supplied room classification also requires review before continuing', async () => {
  const f = fixture((hid, selected) => {
    const next = result(selected);
    next.offer.roomIdentity = 'newly-supplied';
    return next;
  });
  const original = { ...f.draft, offer: { ...f.draft.offer, roomIdentity: undefined } };
  f.setDraft(original);
  await f.session.recheck();
  assert.equal(f.session.presentation().status, 'changed');
  assert.equal(f.session.getHandoff(), null);
});

test('decimal comparisons ignore formatting but preserve distinctions beyond JavaScript numeric precision', () => {
  const first = offer(), same = offer(); same.price.amount = '000107.000'; same.taxes[0].amount = '0';
  assert.equal(offerTerms(first), offerTerms(same));
  first.price.amount = '9007199254740992.01'; same.price.amount = '9007199254740992.02';
  assert.notEqual(offerTerms(first), offerTerms(same));
});
test('pending and failed rechecks immediately remove previous checked terms and continuation', async () => {
  let pending = null;
  const f = fixture((hid, selected) => pending ? pending.promise : result(selected));
  await f.session.recheck(); pending = deferred(); const operation = f.session.recheck();
  assert.equal(f.session.presentation().status, 'pending'); assert.equal(f.session.presentation().currentOffer, null); assert.equal(f.session.getHandoff(), null);
  pending.reject(new ApiError('network', 'network_unavailable')); await operation;
  assert.equal(f.session.presentation().status, 'error'); assert.equal(f.session.presentation().currentOffer, null); assert.equal(f.session.getHandoff(), null);
});
test('late responses from an older selected offer cannot populate a newer review', async () => {
  const pending = deferred(); const f = fixture(() => pending.promise); const operation = f.session.recheck();
  const old = f.draft; f.setDraft(f.freshDraft()); f.session.sync();
  assert.equal(f.calls[0].signal.aborted, true); pending.resolve(result(old.offer)); await operation;
  assert.equal(f.session.presentation().draft.hotelName, 'Another selection'); assert.equal(f.session.presentation().currentOffer, null);
});
test('owner or search invalidation immediately blocks handoff, including before render effects run', async () => {
  const f = fixture(); await f.session.recheck(); f.setDraft(null);
  assert.equal(f.session.presentation().canContinue, false); assert.equal(f.session.getHandoff(), null); assert.equal(f.session.presentation().currentOffer, null);
  assert.notEqual(criteriaIdentity(criteria()), criteriaIdentity({ ...criteria(), currency: 'AED' }));
});
test('a late result after sign-out is discarded even if the transport ignores cancellation', async () => {
  const pending = deferred(); const f = fixture(() => pending.promise); const old = f.draft; const operation = f.session.recheck();
  f.setDraft(null); pending.resolve(result(old.offer)); await operation;
  assert.equal(f.session.presentation().draft, null); assert.equal(f.session.presentation().currentOffer, null); assert.equal(f.session.getHandoff(), null);
});
test('handoff checks the clock synchronously and local freshness never extends the original selection', async () => {
  const f = fixture(); await f.session.recheck(); f.advance(REVIEW_CHECK_LIFETIME_MS + 1);
  assert.equal(f.session.getHandoff(), null); assert.equal(f.session.presentation().status, 'expired');
  await f.session.recheck(); assert.equal(f.session.presentation().status, 'ready');
  f.advance(REVIEW_SELECTION_LIFETIME_MS); assert.equal(f.session.getHandoff(), null); assert.equal(f.session.presentation().canRecheck, false);
});
test('an invalid or expired signed offer requires fresh hotel offers and is not replayed', async () => {
  const f = fixture(() => { throw new ApiError('validation', 'offer_context_expired', 409); });
  await f.session.recheck(); assert.equal(f.session.presentation().status, 'expired'); assert.equal(f.session.presentation().canRecheck, false);
  await f.session.recheck(); assert.equal(f.calls.length, 1); assert.equal(f.session.getHandoff(), null);
});
test('clearing a review aborts pending work and removes the in-memory selection', async () => {
  const pending = deferred(); const f = fixture(() => pending.promise); const old = f.draft; const operation = f.session.recheck();
  f.session.clear(); assert.equal(f.calls[0].signal.aborted, true); pending.resolve(result(old.offer)); await operation;
  assert.equal(f.draft, null); assert.equal(f.session.presentation().currentOffer, null);
});

test('checkout proof retains the checked p-offer and context privately without changing the website handoff', async () => {
  const f = fixture();
  assert.equal(f.session.getCheckoutReview(), null);
  await f.session.recheck();
  const proof = f.session.getCheckoutReview();
  assert.ok(proof); assert.equal(proof.review.offer.bookHash, 'p-private');
  assert.equal(proof.review.prebookContext, 'signed.prebook.private');
  assert.equal(proof.termsAccepted, true); assert.equal(Object.isFrozen(proof.review), true);
  assert.doesNotMatch(JSON.stringify(f.session.getSnapshot()), /signed\.prebook\.private/);
  assert.deepEqual(Object.keys(f.session.getHandoff()).sort(), ['criteria', 'hid']);
  f.advance(REVIEW_CHECK_LIFETIME_MS + 1); assert.equal(f.session.getCheckoutReview(), null);
});

test('checkout proof needs current accepted terms and vanishes synchronously after owner/selection or recheck changes', async () => {
  let pending = null;
  const f = fixture((hid, selected) => pending ? pending.promise : result(selected, { priceChanged: true }));
  await f.session.recheck(); assert.equal(f.session.getCheckoutReview(), null);
  f.session.acceptChanges(f.session.presentation().confirmationRevision); const old = f.session.getCheckoutReview(); assert.ok(old);
  pending = deferred(); const operation = f.session.recheck(); assert.equal(f.session.getCheckoutReview(), null);
  pending.resolve(result(f.draft.offer)); await operation;
  assert.notEqual(f.session.getCheckoutReview().selectionId, old.selectionId);
  f.setDraft(null); assert.equal(f.session.getCheckoutReview(), null);
});
