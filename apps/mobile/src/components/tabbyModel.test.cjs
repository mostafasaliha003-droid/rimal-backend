/* global __dirname */
const fs = require('node:fs'), path = require('node:path');
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

test('Tabby promo is Tabby’s standard text word for word, with total × 1.015 / 4', () => {
  const { tabbyMonthly, tabbyPromoText, tabbyLearnMoreUrl, paymentChoiceCopy } = require('./tabbyModel.ts');
  assert.equal(tabbyMonthly('1000', 'AED'), '253.75');
  assert.equal(tabbyMonthly('188.62', 'AED'), '47.86');
  assert.equal(tabbyMonthly('4000.00', 'AED'), '1,015.00');
  assert.equal(tabbyMonthly('1000', 'USD'), null);
  const strip = text => text.replace(/[⁦⁩]/g, '');
  assert.equal(strip(tabbyPromoText('253.75', 'en').text) + ' ' + tabbyPromoText('253.75', 'en').learnMore, '4 payments of AED 253.75/mo or up to 12 months. Learn more');
  assert.equal(strip(tabbyPromoText('253.75', 'ar').text) + ' ' + tabbyPromoText('253.75', 'ar').learnMore, '4 دفعات بقيمة AED 253.75 شهريًا أو حتى 12 شهرًا. اعرف المزيد');
  const key = ['pk', 'test', 'fixture00000000'].join('_');
  assert.equal(tabbyLearnMoreUrl('1000', 'ar', { merchantCode: 'PillowStaysApp', publicKey: key }),
    `https://checkout.tabby.ai/promos/product-page/installments/ar/?price=1000.00&currency=AED&lang=ar&merchant_code=PillowStaysApp&public_key=${key}`);
  assert.equal(tabbyLearnMoreUrl('1000', 'en', { merchantCode: 'bad code', publicKey: key }), null);
  assert.equal(tabbyLearnMoreUrl('1000', 'en', { merchantCode: 'PillowStaysApp', publicKey: 'sk_test_secret000000' }), null, 'never a secret key');
  // No custom Tabby promo copy remains anywhere in the model.
  const source = fs.readFileSync(path.join(__dirname, 'tabbyModel.ts'), 'utf8');
  assert.doesNotMatch(source, /The hotel won|الفاتورة تستنّى|على راحتك|4, 6 or 12/);
  // Tabby asked for nothing under its option but the name, the logo and the standard text.
  assert.equal(paymentChoiceCopy('ar').approval, undefined);
  assert.doesNotMatch(source, /Tabby account|حساب معها|Tabby’s page and come/);
});
