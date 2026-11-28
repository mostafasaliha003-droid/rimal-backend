'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChromeQueue } = require('../services/chromeQueue');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('only one Chrome render runs at a time, in arrival order, and each caller gets its own result', async () => {
    const queue = createChromeQueue();
    let running = 0, peak = 0; const order = [];
    const render = (name, gate) => queue.run(async () => {
        running += 1; peak = Math.max(peak, running); order.push(`start ${name}`);
        await gate.promise; running -= 1; order.push(`end ${name}`); return `pdf ${name}`;
    });
    const gates = [deferred(), deferred(), deferred()];
    const results = ['a', 'b', 'c'].map((name, index) => render(name, gates[index]));
    await tick();
    assert.deepEqual(queue.stats(), { busy: true, waiting: 2 });
    gates[2].resolve(); gates[1].resolve(); await tick();
    assert.deepEqual(order, ['start a'], 'later renders wait even when they are ready first');
    gates[0].resolve();
    assert.deepEqual(await Promise.all(results), ['pdf a', 'pdf b', 'pdf c']);
    assert.equal(peak, 1);
    assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    assert.deepEqual(queue.stats(), { busy: false, waiting: 0 });
});

test('a failed render passes its error to its caller and frees the turn for the next one', async () => {
    const queue = createChromeQueue();
    const failed = queue.run(async () => { throw new Error('chrome_crashed'); });
    const next = queue.run(async () => 'pdf');
    await assert.rejects(failed, /chrome_crashed/);
    assert.equal(await next, 'pdf');
});

test('a hung render gives up its turn after the hold limit, so later PDFs are not stalled', async () => {
    const timers = [];
    const queue = createChromeQueue({ holdLimitMs: 90000, setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, clearTimer() {} });
    const hung = deferred();
    queue.run(() => hung.promise);
    const next = queue.run(async () => 'pdf');
    await tick();
    assert.equal(timers[0].ms, 90000);
    timers[0].fn();
    assert.equal(await next, 'pdf');
    hung.resolve();
});

test('past the waiting limit a new render fails at once instead of queueing without end', async () => {
    const queue = createChromeQueue({ maxWaiting: 1 });
    const gate = deferred();
    const first = queue.run(() => gate.promise);
    const second = queue.run(async () => 'second');
    await assert.rejects(queue.run(async () => 'third'), error => error.code === 'pdf_queue_full');
    gate.resolve('first');
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
});
