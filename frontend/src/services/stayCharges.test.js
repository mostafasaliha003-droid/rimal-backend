import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stayCharges } from './stayCharges.js';

test('exact amounts keep included taxes out and group each payable currency separately', () => {
    const row = (amount, currency_code, included_by_supplier) => ({ amount, currency_code, included_by_supplier });
    const room = { taxesDisclosed: true, taxes: [row('20', 'USD', true), row('15.93', 'USD', false), row('15.93', 'USD', 'false'), row('1.025', 'KWD', false)] };
    const parts = stayCharges(room, '378.78', 'USD', false);
    assert.deepEqual(parts.hotel, [{currency:'USD', amount:'31.86'}, {currency:'KWD', amount:'1.025'}]);
    assert.deepEqual(parts.stay, [{currency:'USD', amount:'410.64'}, {currency:'KWD', amount:'1.025'}]);
    assert.equal(parts.incomplete, false);
    assert.deepEqual(stayCharges(room, '378.78', 'USD', true).hotel, parts.stay);
});
test('missing amounts, unknown inclusion or absent tax data are never described as a zero fee', () => {
    for (const room of [{}, {taxes:[null]}, {taxes:[{ included_by_supplier:false, amount:null, currency_code:'USD' }]}, {taxes:[{ included_by_supplier:null, amount:'10', currency_code:'USD' }]}]) {
        assert.equal(stayCharges(room, '10', 'USD', false).incomplete, true);
    }
    assert.deepEqual(stayCharges({taxes:[], taxesDisclosed:true}, '10', 'USD', false), { hotel:[], stay:[{currency:'USD', amount:'10.00'}], incomplete:false });
});
