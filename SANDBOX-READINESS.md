# Sandbox verification — 2026-10-16

Scope: ETG / RateHawk Sandbox and Ziina test payments on
https://rimal-api-staging.onrender.com. Production checkout stays disabled.

## Verified

- 449 fixture-based tests passed; no failures. One localhost-only MongoDB
  integration test was skipped because a dedicated local MongoDB is not available.
- Isolated frontend build and browser tests passed: destination search, room
  selection, simulated payments, booking/refund states, Affiliate routing and PWA
  offline fallback. Deployment files were unchanged by these tests.
- Additional search UI tests passed (keyboard, responsive layout, dialogs,
  focus return and offline handling), as did the Next-Gen UI fixture suite.
- A real ETG Sandbox standard booking reached `confirmed`.
- The ETG `unknown_then_soldout` scenario reached its expected final failure;
  the certification runner reported zero unmet expectations.
- A Ziina intent was created with `test: true` and retrieved successfully.
  No real card or real payment was submitted. The returned intent does not expose
  a `test` field, so it is not reported as independent confirmation of test mode.
- The Sandbox release was deployed to the Staging service. Its health endpoint
  reported a connected database, and the frontend/backend release revisions
  matched. The isolated fixture job succeeded. Real admin/customer login and a
  BFF hotelpage search succeeded, returning 18 bookable rates; a BFF checkout
  reached `awaiting_payment` with a hosted test-payment URL.

Supplier evidence containing test guest information is kept in ignored `logs/`:
`sandbox-standard-confirmed-20261016.json` and
`sandbox-soldout-verified-20261016.json`. Do not commit these files.

## Changes

- Sandbox checkout now requires an explicitly named sandbox/staging MongoDB
  database matching `PAYMENT_SANDBOX_DATABASE`, in addition to sandbox supplier,
  test-payment and isolated-frontend checks. Staging was previously configured to
  use the same database as Production; a separate `rimal_sandbox` database is now
  configured for the Staging service. No production database was migrated.
- Paid checkout binds idempotency and saved bookings to the authenticated owner
  and realm. Confirmed bookings are saved before customer notification; a storage
  failure retains the encrypted details and schedules reconciliation without
  submitting a second booking.
- Admin-only `/api/v1/admin/readiness` reports missing configuration names, never
  secret values. Health and the built frontend expose their release revision so
  deployment checks can verify that the frontend/backend match.
- Certification price selection reads the actual nested ETG payment option.
- Voucher tests use a fixed clock and retain coverage for rejection of stale
  content. Frontend API configuration can be imported outside Vite, with tests
  preserving the approved BFF host restrictions.

## Commands

```sh
npm test
npm run test:frontend-isolated
npm run check:readiness -- --env-file=.env.sandbox --remote=https://rimal-api-staging.onrender.com
node scripts/seed-sandbox.js --env-file=.env.sandbox
npm run verify:sandbox
npm run verify:sandbox -- --create-test-checkout
```

The last command creates a test checkout on the fixed Staging host only. It saves
the operation key and exact payload before submission in the ignored
`logs/sandbox-app-checkout.json`, allowing recovery without a new operation key.
It never automatically submits a card or changes Production.

GitHub Actions runs the fixture suite and frontend build for this Sandbox branch.
Render tracks `codex/sandbox-readiness-20261016` with automatic deploy disabled,
so later Staging configuration deploys do not restore the old source branch.

`sandbox-access.local.json` contains the private Sandbox QA/admin credentials.
`.env.sandbox` contains the private Staging configuration. Both are ignored by Git.
The seed script only accepts the approved ETG test contact, true sandbox supplier,
test payments, and the explicitly named isolated database.

## Remaining external verification

The user chose real SMTP delivery. Configure `SMTP_USER` and `SMTP_PASSWORD` on
**rimal-api-staging**, then verify receipt of registration, voucher and refund
emails. A hosted test payment must be completed before the complete Ziina → ETG
→ voucher/email lifecycle can be marked verified. ETG Production certification
has not been granted and is outside this Sandbox release.

The hosted Ziina page accepted the officially documented test-card fields, but
its Cloudflare human-verification challenge kept the Pay button disabled. No
payment was submitted. Complete that challenge manually in the hosted page;
never simulate payment success or bypass provider verification.

Configuration readiness and passing fixture tests are not supplier certification.
