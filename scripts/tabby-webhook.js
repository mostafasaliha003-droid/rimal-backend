#!/usr/bin/env node
// Registers this server's Tabby webhook once per key (Tabby allows four per merchant code and key).
// Usage: TABBY_SECRET_KEY=... TABBY_MERCHANT_CODE=... TABBY_WEBHOOK_SECRET=... node scripts/tabby-webhook.js https://<host>/api/payment/tabby/webhook
// The secret key and the webhook secret come from the environment only; nothing is written to disk.
const tabby = require('../services/tabbyClient');

async function main() {
    const url = process.argv[2];
    let parsed;
    try { parsed = new URL(url); } catch { /* reported below */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.pathname !== '/api/payment/tabby/webhook') {
        console.error('Give the full https URL ending in /api/payment/tabby/webhook.');
        process.exitCode = 2; return;
    }
    const config = tabby.settings();
    if (!config.secretKey || !config.merchantCode || config.webhookSecret.length < 32) {
        console.error('Set TABBY_SECRET_KEY, TABBY_MERCHANT_CODE and TABBY_WEBHOOK_SECRET (32+ characters).');
        process.exitCode = 2; return;
    }
    const existing = await tabby.listWebhooks();
    const rows = Array.isArray(existing) ? existing : [];
    const same = rows.find(row => row?.url === parsed.href);
    if (same) {
        console.log(`Already registered (${config.test ? 'test' : 'live'} key): ${same.id} -> ${same.url}`);
        console.log('To rotate the header secret, update that webhook in the Tabby dashboard or remove it and run this again.');
        return;
    }
    const created = await tabby.registerWebhook({ url: parsed.href });
    console.log(`Registered (${config.test ? 'test' : 'live'} key): ${created.id} -> ${created.url} (${rows.length + 1} of 4)`);
}

main().catch(error => {
    console.error('Tabby webhook registration failed:', error.code || 'error', error.httpStatus || '', error.errorType || '');
    process.exitCode = 1;
});
