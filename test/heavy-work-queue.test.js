'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { generateHtmlPdf } = require('../services/reservationConfirmationService');
const { createLocalDocumentReader } = require('../services/membershipEligibilityReader');

const TSV = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
    + '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t96\tP<ARE\n';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function recorder() {
    const spans = [];
    return { spans, track(name) { const span = { name, start: Date.now(), end: null }; spans.push(span); return () => { span.end = Date.now(); }; } };
}
// A Chrome that takes 60 ms to print, recording when it is open.
function fakePuppeteer(log) {
    return {
        executablePath: () => 'fixture',
        async launch() {
            const done = log.track('pdf');
            return {
                async newPage() {
                    return { async setRequestInterception() {}, on() {}, async setContent() {}, async evaluate() {},
                        async pdf() { await wait(60); return Buffer.from('%PDF-fixture'); } };
                },
                async close() { done(); }
            };
        }
    };
}
// The Tesseract binary path (same container memory), answering after 60 ms.
function fakeTesseract(log) {
    return () => {
        const done = log.track('ocr');
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
        child.stdin = { on() {}, end() { setTimeout(() => { child.stdout.emit('data', TSV); done(); child.emit('close', 0); }, 60); } };
        child.kill = () => {};
        return child;
    };
}
const overlaps = spans => spans.some((a, i) => spans.some((b, j) => i !== j && a.start < b.end && b.start < a.end));

test('an OCR read and a PDF never run at the same time, in either order, and both succeed', async () => {
    const log = recorder();
    const reader = createLocalDocumentReader({ env: { MEMBERSHIP_OCR_ENABLED: 'true', MEMBERSHIP_TESSERACT_PATH: '/fixture/tesseract' },
        spawnProcess: fakeTesseract(log) });
    const puppeteer = fakePuppeteer(log);
    const results = await Promise.all([
        reader.read(Buffer.from('image-1'), { documentKind: 'passport' }),
        generateHtmlPdf('<p>receipt</p>', { puppeteer }),
        reader.read(Buffer.from('image-2')),
        generateHtmlPdf('<p>confirmation</p>', { puppeteer }),
    ]);
    assert.equal(results[0].lines[0].text, 'P<ARE');
    assert.equal(results[1].toString(), '%PDF-fixture');
    assert.equal(results[2].lines[0].text, 'P<ARE');
    assert.equal(results[3].toString(), '%PDF-fixture');
    assert.deepEqual(log.spans.map(span => span.name), ['ocr', 'pdf', 'ocr', 'pdf'], 'arrival order');
    assert.equal(log.spans.every(span => span.end !== null), true);
    assert.equal(overlaps(log.spans), false, 'one heavy job at a time');
});

test('an unconfigured OCR reader fails at once without taking a turn in the queue', async () => {
    let turns = 0;
    const reader = createLocalDocumentReader({ env: {}, withHeavyWork: task => { turns += 1; return task(); } });
    await assert.rejects(reader.read(Buffer.from('image')), /document_reader_unavailable/);
    assert.equal(turns, 0);
    const configured = createLocalDocumentReader({ env: { MEMBERSHIP_OCR_ENABLED: 'true', MEMBERSHIP_TESSERACT_PATH: '/fixture/tesseract' },
        spawnProcess: fakeTesseract(recorder()), withHeavyWork: task => { turns += 1; return task(); } });
    await configured.read(Buffer.from('image'));
    assert.equal(turns, 1, 'a configured read goes through the queue');
});
