const test = require('node:test');
const assert = require('node:assert/strict');
const { tabbyInstallment, tabbyOutcome, tabbyMessage, tabbyName } = require('./tabbyModel.ts');

test('the instalment is a quarter of the AED total, rounded up so four always cover it', () => {
  assert.equal(tabbyInstallment('450', 'AED'), '112.50');
  assert.equal(tabbyInstallment('450.75', 'AED'), '112.69');
  assert.equal(tabbyInstallment('0.01', 'AED'), '0.01');
  assert.equal(tabbyInstallment('1000.10', 'AED'), '250.03');
  for (const [amount, currency] of [['450', 'USD'], ['-1', 'AED'], ['1.234', 'AED'], ['abc', 'AED'], ['0', 'AED']]) assert.equal(tabbyInstallment(amount, currency), null);
});

test('server payment errors map to Tabby outcomes; anything unknown is "unavailable", never success', () => {
  assert.equal(tabbyOutcome('tabby_order_amount_too_high'), 'order_amount_too_high');
  assert.equal(tabbyOutcome('tabby_expired'), 'expired');
  assert.equal(tabbyOutcome('tabby_rejected'), 'rejected');
  assert.equal(tabbyOutcome('tabby_something_new'), 'unavailable');
  assert.equal(tabbyOutcome('ziina_failed'), null);
  assert.equal(tabbyOutcome(undefined), null);
});

test('every outcome has Arabic and English wording, and a cancellation says nothing was charged', () => {
  for (const outcome of ['not_available', 'order_amount_too_high', 'order_amount_too_low', 'rejected', 'expired', 'closed', 'unavailable']) {
    for (const language of ['ar', 'en']) {
      const message = tabbyMessage(outcome, language);
      assert.ok(message.title.length > 5 && message.body.length > 20, outcome + language);
    }
  }
  assert.match(tabbyMessage('expired', 'en').body, /aborted the payment/);
  assert.match(tabbyMessage('expired', 'ar').body, /لم يُخصم/);
  assert.equal(tabbyName('ar'), 'ادفع لاحقًا مع تابي');
  assert.equal(tabbyName('en'), 'Pay later with Tabby');
});
