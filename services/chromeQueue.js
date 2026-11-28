'use strict';

/**
 * One headless Chrome at a time for the whole process.
 *
 * Every PDF (booking confirmation and cancellation receipt e-mails, voucher downloads) launches
 * its own Chrome, which needs roughly 100–200 MB on top of the Node process. On a 512 MB
 * instance two or three renders at once could run out of memory, so renders wait their turn in
 * arrival order instead.
 *
 * Two guards keep the queue from becoming its own outage:
 * - holdLimitMs: a render that is still running after this long gives up its turn, so one hung
 *   Chrome cannot stall every later PDF (Puppeteer's own 30 s timeouts normally end it first).
 * - maxWaiting: past this many waiting renders a new one fails at once with `pdf_queue_full`,
 *   like any other render failure: a voucher download answers 503 (the guest can tap again), a
 *   cancellation receipt is retried up to 3 times a minute apart before staff review, and a
 *   booking-confirmation e-mail is flagged for staff review (no automatic resend, by design).
 */
function createChromeQueue({ holdLimitMs = 90_000, maxWaiting = 20, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const waiting = [];
    let busy = false;

    function next() {
        if (busy || !waiting.length) return;
        busy = true;
        const { task, resolve, reject } = waiting.shift();
        let released = false;
        let timer = null;
        const release = () => {
            if (released) return;
            released = true;
            if (timer) clearTimer(timer);
            busy = false;
            next();
        };
        timer = setTimer(release, holdLimitMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
        Promise.resolve().then(task).then(resolve, reject).finally(release);
    }

    return {
        run(task) {
            if (typeof task !== 'function') return Promise.reject(new TypeError('chrome_queue_task_invalid'));
            if (waiting.length >= maxWaiting) {
                return Promise.reject(Object.assign(new Error('pdf_queue_full'), { code: 'pdf_queue_full' }));
            }
            return new Promise((resolve, reject) => {
                waiting.push({ task, resolve, reject });
                next();
            });
        },
        stats: () => ({ busy, waiting: waiting.length })
    };
}

const shared = createChromeQueue();

module.exports = { createChromeQueue, withChrome: task => shared.run(task), chromeQueueStats: () => shared.stats() };
