const CheckoutAttempt = require('../models/CheckoutAttempt');

// Start-up summary of recent checkout attempts for operators. It prints workflow
// states and error codes only: never guest names, emails or payment details.
async function reportRecentCheckouts({ limit = 10, log = console.log } = {}) {
    const rows = await CheckoutAttempt.find({})
        .select('reference state notification_status action_required error app_return currency createdAt notification_sent_at')
        .sort({ createdAt: -1 }).limit(limit).lean();
    log(`[checkout-diagnostics] smtp_configured=${Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD)} recent=${rows.length}`);
    for (const row of rows) {
        log('[checkout-diagnostics] ' + [
            `ref=${row.reference}`, `state=${row.state}`, `notification=${row.notification_status || '-'}`,
            `action=${row.action_required || '-'}`, `error=${row.error || '-'}`, `app=${row.app_return || '-'}`,
            `currency=${row.currency || '-'}`, `created=${row.createdAt ? new Date(row.createdAt).toISOString() : '-'}`,
            `sent=${row.notification_sent_at ? new Date(row.notification_sent_at).toISOString() : '-'}`
        ].join(' '));
    }
    return rows.length;
}

module.exports = { reportRecentCheckouts };
