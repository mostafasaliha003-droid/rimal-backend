# Account data and invoice operations

Owner instructions confirmed on 17 November 2026:

- Retain customer accounts and account ownership for at least one year. Do not automatically delete accounts.
- The requested five-day booking-data period starts at hotel **checkout**, not check-in.
- Archive both historical and future actual invoices to **connect@remaltourismllc.com**.

These are business instructions, not a statement of statutory retention requirements or Google Play compliance.

## Implemented request intake

The native app and the public `/account-deletion` page record an authenticated owner's request for review. Password reauthentication is required. Pending or rejected membership does not block this route. A stable reference is returned only after durable storage; repeats return the original reference.

The response explicitly contains `data_deleted: false`. No account, reservation, payment, refund, support record or supplier record is deleted or changed. The read-only administrative queue does not provide a fulfillment action. Passwords and email addresses are not stored in the request ledger.

This intake is not a completed account-deletion implementation. Holding full customer accounts indefinitely in response to deletion requests does not satisfy the [Google Play account-deletion requirement](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Release disclosures and a legitimate, narrowly scoped fulfillment policy remain necessary before asserting compliance.

## Invoice archive runner

`node scripts/archive-ratehawk-invoices.js` inventories existing supplier invoice groups without Mongo writes, SMTP or PDF downloads. It does not create, modify, disband or pay invoice groups. It must run with the selected server's environment; do not copy credentials into the app, repository or job logs.

Delivery requires an explicit `--send --expect-environment production --expect-realm <configured-realm>`, database and SMTP configuration, and `INVOICE_ARCHIVE_EXPECTED_ACCOUNT_SCOPE` matching the SHA-256 fingerprint of the selected supplier origin and key ID. The recipient is fixed in code. Sandbox documents are not a substitute for the company's production invoices.

Before sending, inventory must cover every page with consistent counts and unique invoice identifiers. Only validated PDF documents are attached. A durable per-invoice ledger binds the realm, supplier account scope and recipient, records attachment hashes and prevents automatic resending of accepted deliveries. An ambiguous SMTP outcome or unconfirmed post-send database acknowledgement is held for manual review. SMTP acceptance is not proof that a person opened the email.

The runner alone does not establish a live schedule. Record the actual deployed source, environment, scheduler and delivery results separately; do not report archival complete from tests, a partial inventory or a queued job.

On 17 November 2026, a read-only production-runtime check found that the web service's supplier configuration still selects Sandbox and the SMTP configuration required by this runner is absent. No invoice inventory was established and no invoice was sent. The owner confirmed that RateHawk production is not activated yet and requested continued app development. Production archival and scheduling remain inactive until that environment is available.

## Five-day cleanup status

No automatic booking-data erasure or TTL is enabled by this change. Checkout plus five days is the requested eligibility boundary, not permission to delete an entire booking record, account or invoice ledger. A cleanup implementation must map guest/contact data, supplier payloads, payment/reconciliation references and audit/support dependencies, confirm invoice archival and handle open disputes/refunds. Missing or ambiguous checkout and unresolved financial state must fail closed. Preserve the customer's account and ownership as instructed.

Do not report that the five-day cleanup is running until a scoped implementation, dry-run evidence and actual scheduler verification exist.
