#!/usr/bin/env node
'use strict';

const { RECIPIENT, deriveSupplierScope, createInvoiceArchiveService } = require('../services/invoiceArchiveService');

function parseArgs(args) {
    const options = { send: false, maxPages: 1000, maxInvoices: 50000, maxDeliveries: 100 };
    const values = new Map([['--expect-environment', 'environment'], ['--expect-realm', 'realm'],
        ['--max-pages', 'maxPages'], ['--max-invoices', 'maxInvoices'], ['--max-deliveries', 'maxDeliveries']]);
    const seen = new Set();
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (flag === '--help') return { help: true };
        if (seen.has(flag)) throw new Error('archive_arguments_invalid');
        seen.add(flag);
        if (flag === '--send') { options.send = true; continue; }
        const field = values.get(flag), value = args[++index];
        if (!field || !value || value.startsWith('--')) throw new Error('archive_arguments_invalid');
        if (field.startsWith('max')) {
            if (!/^[1-9]\d{0,5}$/.test(value)) throw new Error('archive_arguments_invalid');
            options[field] = Number(value);
            if (options[field] > { maxPages: 10000, maxInvoices: 500000, maxDeliveries: 50000 }[field]) throw new Error('archive_arguments_invalid');
        } else options[field] = value;
    }
    return options;
}

function configuration(options, env) {
    const { environment, scope } = deriveSupplierScope(env.RATEHAWK_BASE_URL, env.RATEHAWK_KEY_ID);
    if (typeof env.RATEHAWK_API_KEY !== 'string' || !env.RATEHAWK_API_KEY.trim()
        || typeof env.RIMAL_AUTH_REALM !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(env.RIMAL_AUTH_REALM)) throw new Error('archive_configuration_invalid');
    if (options.environment !== undefined && options.environment !== environment
        || options.realm !== undefined && options.realm !== env.RIMAL_AUTH_REALM) throw new Error('archive_scope_mismatch');
    if (options.send && (options.environment !== environment || options.realm !== env.RIMAL_AUTH_REALM
        || env.INVOICE_ARCHIVE_EXPECTED_ACCOUNT_SCOPE !== scope || typeof env.MONGO_URI !== 'string' || !env.MONGO_URI
        || !env.SMTP_USER || !env.SMTP_PASSWORD)) throw new Error('archive_send_configuration_unconfirmed');
    return { environment, realm: env.RIMAL_AUTH_REALM, supplierScope: scope };
}

// Deliberately no dotenv loading, server import, worker startup or transport
// verification. Credentials come only from the selected server job environment.
async function main(args = process.argv.slice(2)) {
    const env = process.env;
    const options = parseArgs(args);
    if (options.help) {
        console.log('Inventory only (no Mongo/SMTP): node scripts/archive-ratehawk-invoices.js\nExplicit delivery: add --send --expect-environment production|sandbox --expect-realm <realm>; requires INVOICE_ARCHIVE_EXPECTED_ACCOUNT_SCOPE, MONGO_URI and SMTP settings. Optional bounds: --max-pages, --max-invoices, --max-deliveries. Fixed company recipient. No booking/group mutations or deletion.');
        return 0;
    }
    const scope = configuration(options, env);
    const mongoose = require('mongoose');
    const groups = require('../services/orderGroupService');
    const ratehawk = require('../services/ratehawkService');
    let transport, connected = false;
    try {
        if (options.send) {
            await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10000, maxPoolSize: 2,
                autoCreate: false, autoIndex: false });
            connected = true;
            transport = require('nodemailer').createTransport({ service: 'gmail', auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
                connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 });
        }
        const service = createInvoiceArchiveService({ realm: scope.realm, supplierScope: scope.supplierScope,
            retrieveOrderGroups: input => groups.retrieveOrderGroups(input),
            downloadInvoice: input => ratehawk.retrieveInvoice(input),
            sendInvoice: async ({ recipient, filename, pdfBuffer, subject, text }) => {
                if (!transport || recipient !== RECIPIENT) throw new Error('archive_send_not_enabled');
                let timer;
                try {
                    return await Promise.race([transport.sendMail({ from: env.SMTP_USER, to: RECIPIENT, subject, text,
                        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }] }),
                    new Promise((_, reject) => { timer = setTimeout(() => {
                        transport.close(); reject(new Error('archive_smtp_deadline'));
                    }, 60000); })]);
                } finally { clearTimeout(timer); }
            }, maxPages: options.maxPages, maxInvoices: options.maxInvoices, maxDeliveries: options.maxDeliveries });
        const summary = await service.run({ send: options.send });
        console.log(JSON.stringify(summary));
        return summary.inventory_complete && (!options.send || summary.all_inventoried_invoices_sent) ? 0 : 1;
    } finally {
        transport?.close();
        if (connected) await mongoose.disconnect();
    }
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
    // Do not serialize errors: suppliers, Mongo and SMTP may include identifiers,
    // credentials or document content in their error details.
    console.log(JSON.stringify({ inventory_complete: false, all_inventoried_invoices_sent: false, codes: ['archive_job_failed'] }));
    process.exitCode = 1;
});

module.exports = { parseArgs, configuration, main };
