const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createInvoiceArchiveService, deriveSupplierScope, RECIPIENT, MAX_PDF_BYTES, WRITE_CONCERN } = require('./services/invoiceArchiveService');
const Ledger = require('./models/InvoiceArchiveDelivery');
const cli = require('./scripts/archive-ratehawk-invoices');
const fixedTime = new Date('2026-11-17T12:00:00Z');
const scope = 'a'.repeat(64);
const pdf = (() => {
    let value = '%PDF-1.4\n% synthetic test document, not an invoice\n';
    const offsets = [];
    for (const object of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>']) {
        offsets.push(Buffer.byteLength(value)); value += `${offsets.length} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(value);
    value += 'xref\n0 3\n0000000000 65535 f \n' + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    return Buffer.from(`${value}trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
})();
const clone = value => value == null ? value : structuredClone(value);

function store() {
    const rows = [], events = [];
    const state = { rows, events, database: { readyState: 1 }, failIndexes: false, failCreate: false,
        failSentWriteAfterApply: false, failUnknownWrite: false };
    function matches(row, filter) {
        return Object.entries(filter).every(([key, value]) => {
            if (value && typeof value === 'object' && !(value instanceof Date)) {
                if (value.$in) return value.$in.includes(row[key]);
                if (value.$gt) return row[key] instanceof Date && row[key].getTime() > value.$gt.getTime();
            }
            return row[key] === value;
        });
    }
    function apply(row, update) {
        Object.assign(row, clone(update.$set || {}));
        for (const [key, amount] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + amount;
        for (const key of Object.keys(update.$unset || {})) delete row[key];
    }
    function query(run) { return { maxTimeMS() { return this; }, async lean() { return clone(run()); } }; }
    state.Model = {
        async init() { events.push('init'); },
        async createIndexes() { events.push('indexes'); if (state.failIndexes) throw Error('private-index-error'); },
        findOne(filter) { events.push('read'); return query(() => rows.find(row => matches(row, filter)) || null); },
        async create(documents, options) {
            events.push('create'); assert.deepEqual(options.writeConcern, WRITE_CONCERN);
            if (state.failCreate) throw Error('private-create-error');
            const value = documents[0];
            if (rows.some(row => ['realm', 'supplier', 'invoiceId', 'recipient'].every(key => row[key] === value[key]))) {
                throw Object.assign(Error('duplicate'), { code: 11000 });
            }
            rows.push(clone(value)); return [clone(value)];
        },
        findOneAndUpdate(filter, update, options) {
            return query(() => {
                events.push('claim'); assert.deepEqual(options.writeConcern, WRITE_CONCERN);
                const row = rows.find(item => matches(item, filter));
                if (row) apply(row, update);
                return row || null;
            });
        },
        async updateOne(filter, update, options) {
            events.push(`update:${update.$set.state || update.$set.phase}`);
            assert.deepEqual(options.writeConcern, WRITE_CONCERN);
            if (state.failUnknownWrite && update.$set.state === 'unknown') throw Error('private-unknown-write-error');
            const row = rows.find(item => matches(item, filter));
            if (row) apply(row, update);
            if (state.failSentWriteAfterApply && update.$set.state === 'sent') {
                state.failSentWriteAfterApply = false; throw Error('private-acknowledgement-lost');
            }
            return { acknowledged: true, matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
        }
    };
    return state;
}
function listing(count = 1) {
    const groups = Array.from({ length: count }, (_, index) => ({ invoice_id: `fixture-invoice-${index}` }));
    return async ({ pagination }) => ({ success: true, current_page_number: pagination.page_number,
        total_pages: Math.ceil(count / 50), total_groups: count,
        groups: groups.slice((pagination.page_number - 1) * 50, pagination.page_number * 50) });
}
function fixture(options = {}) {
    const db = options.db || store();
    const downloaded = [], messages = [];
    const service = createInvoiceArchiveService({ Model: db.Model, database: db.database, realm: 'test-realm', supplierScope: scope,
        now: () => fixedTime, retrieveOrderGroups: options.retrieveOrderGroups || listing(options.count ?? 1),
        downloadInvoice: async input => { downloaded.push(input); return options.download ? options.download(input) : pdf; },
        sendInvoice: async input => { messages.push(input); return options.sender ? options.sender(input)
            : { accepted: [RECIPIENT], rejected: [], messageId: '<fixture-message@example.test>' }; },
        ...(options.serviceOptions || {}) });
    return { db, downloaded, messages, service };
}
const row = patch => ({ realm: 'test-realm', supplier: 'ratehawk', supplierScope: scope, invoiceId: 'fixture-invoice-0',
    recipient: RECIPIENT, state: 'pending', retryable: true, attempts: 0, ...patch });

test('ledger binds invoice, account scope and fixed recipient without storing PDF/customer data or expiry', async () => {
    const doc = new Ledger(row()); await doc.validate();
    assert.throws(() => new Ledger(row({ pdfBuffer: pdf })), /strict mode/);
    await assert.rejects(new Ledger(row({ recipient: 'other@example.test' })).validate(), /not a valid enum/);
    assert.ok(Ledger.schema.indexes().some(([keys, config]) => config.unique && keys.realm && keys.supplier && keys.invoiceId && keys.recipient));
    assert.equal(Ledger.schema.indexes().some(([, config]) => config.expireAfterSeconds !== undefined), false);
});

test('default inventory consumes every consistent page and never touches Mongo, PDF download or SMTP', async () => {
    const f = fixture({ count: 51 });
    const result = await f.service.run();
    assert.equal(result.inventory_complete, true);
    assert.equal(result.pages_read, 2);
    assert.equal(result.invoices_observed, 51);
    assert.equal(result.delivery_requested, false);
    assert.equal(result.all_inventoried_invoices_sent, false);
    assert.equal(f.db.events.length + f.downloaded.length + f.messages.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /fixture-invoice|invoice_id|pdfBuffer|messageId/);
});

test('partial, failed, changing, duplicated and bounded inventories never send or write a partial archive', async () => {
    const base = listing(51);
    const scenarios = [
        async input => input.pagination.page_number === 2 ? Promise.reject(Object.assign(Error('private'), { code: 'rate_limit' })) : base(input),
        async input => { const value = await base(input); if (input.pagination.page_number === 2) value.total_groups++; return value; },
        async input => { const value = await base(input); if (input.pagination.page_number === 2) value.groups[0].invoice_id = 'fixture-invoice-0'; return value; },
        async input => { const value = await base(input); if (input.pagination.page_number === 2) value.groups = []; return value; },
        async input => ({ ...await base(input), current_page_number: 99 })
    ];
    for (const retrieveOrderGroups of scenarios) {
        const f = fixture({ retrieveOrderGroups }); const result = await f.service.run({ send: true });
        assert.equal(result.inventory_complete, false);
        assert.equal(result.all_inventoried_invoices_sent, false);
        assert.equal(f.db.events.length + f.messages.length + f.downloaded.length, 0);
    }
    for (const serviceOptions of [{ maxPages: 1 }, { maxInvoices: 50 }]) {
        const f = fixture({ count: 51, serviceOptions });
        assert.equal((await f.service.run({ send: true })).inventory_complete, false);
        assert.equal(f.messages.length + f.db.rows.length, 0);
    }
});

test('actual PDF is the sole fixed-recipient attachment and sent invoices remain idempotent across service instances', async () => {
    const f = fixture();
    const result = await f.service.run({ send: true });
    assert.equal(result.sent, 1); assert.equal(result.all_inventoried_invoices_sent, true);
    assert.deepEqual(f.downloaded, [{ invoice_id: 'fixture-invoice-0' }]);
    assert.equal(f.messages[0].recipient, RECIPIENT);
    assert.equal(f.messages[0].filename, 'RateHawk-Invoice.pdf');
    assert.equal(f.messages[0].pdfBuffer, pdf);
    assert.doesNotMatch(f.messages[0].text + f.messages[0].subject, /fixture-invoice|guest|password|token/);
    assert.equal(f.db.rows[0].state, 'sent');
    assert.equal(f.db.rows[0].pdfBytes, pdf.length);
    assert.match(f.db.rows[0].pdfSha256, /^[a-f0-9]{64}$/);
    assert.equal(f.db.rows[0].messageId, '<fixture-message@example.test>');
    const repeated = fixture({ db: f.db }); const next = await repeated.service.run({ send: true });
    assert.equal(next.already_sent, 1);
    assert.equal(repeated.messages.length + repeated.downloaded.length, 0);
});

test('two concurrent workers share the unique ledger and CAS claim, producing one SMTP submission', async () => {
    const db = store();
    const left = fixture({ db }), right = fixture({ db });
    const results = await Promise.all([left.service.run({ send: true }), right.service.run({ send: true })]);
    assert.equal(left.messages.length + right.messages.length, 1);
    assert.equal(db.rows.length, 1); assert.equal(db.rows[0].state, 'sent');
    assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
});

test('SMTP throws, incomplete/conflicting acceptance and malformed message IDs become unknown without retry', async () => {
    for (const sender of [async () => { throw Error('private accepted-then-disconnected'); },
        async () => ({ accepted: [RECIPIENT], rejected: [] }),
        async () => ({ accepted: [RECIPIENT], rejected: [RECIPIENT], messageId: 'conflict' }),
        async () => ({ accepted: [RECIPIENT], rejected: [], messageId: 'bad\nheader' })]) {
        const f = fixture({ sender });
        assert.equal((await f.service.run({ send: true })).unknown, 1);
        assert.equal(f.db.rows[0].state, 'unknown');
        assert.equal((await f.service.run({ send: true })).unknown, 1);
        assert.equal(f.messages.length, 1);
    }
});

test('lost Mongo acknowledgement after SMTP acceptance becomes unknown and is never automatically resent', async () => {
    const f = fixture(); f.db.failSentWriteAfterApply = true;
    const result = await f.service.run({ send: true });
    assert.equal(result.unknown, 1); assert.equal(result.all_inventoried_invoices_sent, false);
    assert.equal(f.db.rows[0].state, 'unknown');
    await f.service.run({ send: true }); assert.equal(f.messages.length, 1);
});

test('stale claims become unknown; current claims stay busy; neither sends or redownloads', async () => {
    for (const [leaseUntil, expected] of [[new Date(fixedTime.getTime() - 1), 'unknown'], [new Date(fixedTime.getTime() + 60000), 'busy']]) {
        const f = fixture(); f.db.rows.push(row({ state: 'sending', claimId: 'old-claim', leaseUntil }));
        const result = await f.service.run({ send: true }); assert.equal(result[expected], 1);
        assert.equal(f.downloaded.length + f.messages.length, 0);
    }
});

test('pending/unavailable/rate-limited documents remain unsent and malformed or excessive bytes never reach SMTP', async () => {
    for (const httpStatus of [202, 409, 429]) {
        const f = fixture({ download: async () => { throw Object.assign(Error('private'), { httpStatus, code: httpStatus === 202 ? 'pending' : 'invoice_not_available' }); } });
        const result = await f.service.run({ send: true }); assert.equal(result.pending, 1);
        assert.equal(f.db.rows[0].state, 'pending'); assert.equal(f.messages.length, 0);
    }
    for (const value of ['%PDF-not-a-buffer', Buffer.from('%PDF-'), Buffer.from('%PDF-1.7\n'),
        pdf.subarray(0, pdf.length - 12), Buffer.from('%PDF-1.7\nerror without objects\nstartxref\n0\n%%EOF\n'),
        Buffer.from('<html>error</html>'), Buffer.alloc(MAX_PDF_BYTES + 1, 0x20)]) {
        const f = fixture({ download: async () => value });
        assert.equal((await f.service.run({ send: true })).failed, 1);
        assert.equal(f.db.rows[0].state, 'failed'); assert.equal(f.messages.length, 0);
    }
});

test('scope mismatch and unavailable database/indexes cannot send or relabel prior records', async () => {
    const mismatch = fixture(); mismatch.db.rows.push(row({ state: 'sent', supplierScope: 'b'.repeat(64) }));
    assert.deepEqual((await mismatch.service.run({ send: true })).codes, ['archive_scope_or_record_mismatch']);
    assert.equal(mismatch.db.rows[0].supplierScope, 'b'.repeat(64));
    assert.equal(mismatch.messages.length, 0);
    for (const mode of ['offline', 'index']) {
        const f = fixture(); if (mode === 'offline') f.db.database.readyState = 0; else f.db.failIndexes = true;
        const result = await f.service.run({ send: true }); assert.equal(result.all_inventoried_invoices_sent, false);
        assert.deepEqual(result.codes, ['archive_delivery_unavailable']);
        assert.equal(f.messages.length + f.db.rows.length, 0);
    }
});

test('an incomplete sent record is neither resent nor counted as proven archived', async () => {
    for (const proof of [{}, { pdfBytes: 5, pdfSha256: 'c'.repeat(64), messageId: 'fixture', sentAt: fixedTime,
        pdfValidation: 'header-objects-eof-v1' }]) {
        const f = fixture(); f.db.rows.push(row({ state: 'sent', ...proof }));
        const result = await f.service.run({ send: true });
        assert.equal(result.failed, 1); assert.equal(result.already_sent, 0);
        assert.equal(result.all_inventoried_invoices_sent, false);
        assert.equal(f.downloaded.length + f.messages.length, 0);
    }
});

test('bounded batches defer unsent work without unknown records starving subsequent invoices', async () => {
    const f = fixture({ count: 3, serviceOptions: { maxDeliveries: 1 } });
    f.db.rows.push(row({ state: 'unknown' }));
    const first = await f.service.run({ send: true });
    assert.equal(first.unknown, 1); assert.equal(first.sent, 1); assert.equal(first.deferred, 1);
    const second = await f.service.run({ send: true });
    assert.equal(second.already_sent, 1); assert.equal(second.sent, 1); assert.equal(second.unknown, 1);
    assert.equal(f.messages.length, 2);
});

test('empty complete inventory requires no ledger or email, and invalid explicit send cannot coerce into delivery', async () => {
    const f = fixture({ count: 0 });
    const result = await f.service.run({ send: true });
    assert.equal(result.inventory_complete, true); assert.equal(result.all_inventoried_invoices_sent, true);
    assert.equal(f.db.events.length + f.messages.length, 0);
    await assert.rejects(f.service.run({ send: 'true' }), /archive_configuration_invalid/);
});

test('CLI validates fixed environment/account/realm and rejects recipient/credential overrides', () => {
    const env = { RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', RATEHAWK_KEY_ID: 'fixture-key-id',
        RATEHAWK_API_KEY: 'fixture-api-secret', RIMAL_AUTH_REALM: 'test-realm', MONGO_URI: 'mongodb://fixture.invalid/test',
        SMTP_USER: 'fixture@example.test', SMTP_PASSWORD: 'fixture-smtp-secret' };
    const derived = deriveSupplierScope(env.RATEHAWK_BASE_URL, env.RATEHAWK_KEY_ID);
    assert.equal(derived.environment, 'sandbox');
    assert.equal(cli.configuration(cli.parseArgs([]), env).supplierScope, derived.scope);
    assert.throws(() => cli.configuration(cli.parseArgs(['--send']), env), /unconfirmed/);
    const options = cli.parseArgs(['--send', '--expect-environment', 'sandbox', '--expect-realm', 'test-realm']);
    assert.equal(cli.configuration(options, { ...env, INVOICE_ARCHIVE_EXPECTED_ACCOUNT_SCOPE: derived.scope }).realm, 'test-realm');
    assert.throws(() => cli.configuration({ ...options, environment: 'production' }, env), /scope_mismatch/);
    assert.throws(() => cli.configuration(options, { ...env, INVOICE_ARCHIVE_EXPECTED_ACCOUNT_SCOPE: 'b'.repeat(64) }), /unconfirmed/);
    for (const args of [['--to', 'other@example.test'], ['--send', '--send'], ['--max-pages', '-1'], ['--max-pages', '10001'], ['--api-key', 'private']]) assert.throws(() => cli.parseArgs(args), /arguments_invalid/);
    for (const host of ['http://api.ratehawk.com', 'https://evil.invalid', 'https://user:pass@api.ratehawk.com', 'https://api.ratehawk.com/path']) assert.throws(() => deriveSupplierScope(host, 'key'), /configuration_invalid/);
});

test('actual CLI main default path uses only supplier listing, emits counts/codes, and never constructs Mongo or SMTP', async () => {
    const events = [], logs = [];
    const module = { exports: {} };
    const engine = require('./services/invoiceArchiveService');
    const requireFixture = name => {
        if (name === '../services/invoiceArchiveService') return engine;
        if (name === 'mongoose') return { connect() { events.push('mongo'); throw Error('must-not-connect'); }, disconnect() { events.push('disconnect'); } };
        if (name === 'nodemailer') return { createTransport() { events.push('smtp'); throw Error('must-not-create-transport'); } };
        if (name === '../services/orderGroupService') return { retrieveOrderGroups: listing(1) };
        if (name === '../services/ratehawkService') return { retrieveInvoice() { events.push('pdf'); throw Error('must-not-download'); } };
        throw Error('Unexpected fixture dependency');
    };
    const filename = path.join(__dirname, 'scripts/archive-ratehawk-invoices.js');
    const source = fs.readFileSync(filename, 'utf8').replace(/^#![^\n]*\n/, '');
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { process: { env: {
        RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', RATEHAWK_KEY_ID: 'fixture-key-id',
        RATEHAWK_API_KEY: 'fixture-secret', RIMAL_AUTH_REALM: 'test-realm' }, argv: [] },
        console: { log: value => logs.push(value) }, setTimeout, clearTimeout })(requireFixture, module, module.exports);
    assert.equal(await module.exports.main([]), 0);
    assert.deepEqual(events, []);
    assert.equal(JSON.parse(logs[0]).invoices_observed, 1);
    assert.doesNotMatch(logs.join(''), /fixture-invoice|fixture-secret|fixture-key-id|messageId|pdfBuffer/);
});
