const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCancellationPolicyReader } = require('./services/cancellationPolicyReader');

test('a slow policy lookup returns checking and repeated views share the same supplier request', async () => {
    let finish, reads = 0;
    const read = createCancellationPolicyReader(() => { reads++; return new Promise(resolve => { finish = resolve; }); }, { waitMs: 5 });
    const [first, second] = await Promise.all([read('order-1'), read('order-1')]);
    assert.equal(first.checking, true); assert.equal(second.checking, true); assert.equal(reads, 1);
    finish({ current_penalty: { amount: '0', currency_code: 'USD' } });
    const ready = await read('order-1');
    assert.equal(ready.current_penalty.amount, '0'); assert.equal(reads, 1);
    await read('order-1');
    assert.equal(reads, 2, 'A completed review does not become a reusable policy cache');
    finish({});
});

test('only transient read failures receive one retry, and terminal failures never become a quote', async () => {
    let calls = 0;
    const read = createCancellationPolicyReader(async () => {
        if (++calls === 1) throw Object.assign(new Error('temporary'), { code: 'order_info_unavailable' });
        return { current_penalty: { amount: '26', currency_code: 'USD' } };
    }, { retryMs: 1 });
    assert.equal((await read('order')).current_penalty.amount, '26'); assert.equal(calls, 2);
    for (const code of ['order_info_mismatch', 'invalid_order_info_response', 'invalid_params', 'rate_limit']) {
        let attempts = 0;
        const failed = createCancellationPolicyReader(async () => { attempts++; throw Object.assign(new Error(code), { code }); });
        await assert.rejects(failed('order'), { code }); assert.equal(attempts, 1);
    }
    let attempts = 0;
    const failed = createCancellationPolicyReader(async () => { attempts++; throw Object.assign(new Error('timeout'), { code: 'order_info_unavailable' }); }, { retryMs: 1 });
    await assert.rejects(failed('order'), { code: 'order_info_unavailable' }); assert.equal(attempts, 2);
});
