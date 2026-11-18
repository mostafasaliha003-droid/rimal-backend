/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const moduleCopy = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'taxCopy.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('exports', 'module', code)(moduleCopy.exports, moduleCopy);
const { taxName, taxCopy } = moduleCopy.exports;

test('known supplier fee identifiers have precise Arabic and English names', () => {
  for (const [source, en, ar] of [
    ['city_tax', 'City tax', 'ضريبة المدينة'],
    ['resort_fee', 'Resort fee', 'رسوم المنتجع'],
    ['VAT', 'VAT', 'ضريبة القيمة المضافة'],
    ['tourism fee', 'Tourism fee', 'رسوم السياحة'],
    ['occupancy-tax', 'Occupancy tax', 'ضريبة الإشغال'],
  ]) {
    assert.equal(taxName(source, 'en'), en);
    assert.equal(taxName(source, 'ar'), ar);
  }
});

test('unknown identifiers retain supplier wording without inheriting a known fee meaning', () => {
  for (const language of ['ar', 'en']) {
    assert.equal(taxName('city_tax_credit', language), 'city tax credit');
    assert.equal(taxName('SupplierFee (optional) 0%', language), 'Supplier Fee (optional) 0%');
    assert.equal(taxName('رسم خاص بالمورّد', language), 'رسم خاص بالمورّد');
    assert.equal(taxName('constructor', language), 'constructor');
    assert.equal(taxName('<unknown fee>', language), '<unknown fee>');
  }
});

test('missing names are explicitly unavailable rather than an invented fee type', () => {
  for (const language of ['ar', 'en']) {
    for (const name of [null, undefined, '', '  ']) assert.equal(taxName(name, language), taxCopy(language).nameUnknown);
  }
});

test('empty and unclear disclosures are distinct from confirmed supplier inclusion', () => {
  for (const language of ['ar', 'en']) {
    const copy = taxCopy(language);
    assert.notEqual(copy.informationMissing, copy.includedOnly);
    assert.notEqual(copy.unknown, copy.excluded);
    assert.notEqual(copy.unknown, copy.included);
    assert.notEqual(copy.historical, copy.updated);
    assert.match(copy.breakdown(3), /3/);
  }
});
