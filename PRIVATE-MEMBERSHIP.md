# Private membership

Release candidate: rollout is Staging only. Verify deployed revision and the checks below before reporting live readiness.

## Behaviour

- `/` and deep links show the private sign-in/application portal until approved. Inventory, rates and new payment APIs enforce membership on the server. Public legal pages, signed webhooks and existing owner/capability-protected booking servicing remain accessible under their existing checks.
- Existing customers created before the fixed `MEMBERSHIP_EXISTING_USERS_BEFORE` instant are approved on first access. Never move this cutoff forward on a later deploy. A stored suspension overrides grandfathering.
- Email verification creates an authenticated applicant, not an approved member. New applicants select GCC citizenship with passport identity page, or an eligible expatriate profession with both Emirates ID sides from UAEICP.
- Images: actual PNG/JPEG headers and dimensions, 5 MB maximum, AES-256-GCM with an independent 32-byte secret. No static files or email attachments. Owner/admin access is realm-scoped, audited and `no-store`.
- Draft images expire after 24 hours. Submitted images remain available for review, then expire 30 days after a decision. Access stops at expiry even if MongoDB's TTL deletion has not run yet. Changing category removes images no longer needed. Status, decisions and audit history remain.
- `/membership-admin`: existing admin login, applicant name/email/phone, category, profession, protected document viewer, review actions and notification delivery state. `/customer-service` links to it.
- Receipt, review and decision emails use a durable Mongo outbox. Claims are atomic and realm-scoped. Ambiguous SMTP delivery is marked `unknown` and is not resent automatically. Missing SMTP leaves notices queued. Staff should check provider delivery before resending outside this workflow.

## Automated reading and live status

The runtime performs the review; this chat is not a continuously running reviewer. Tesseract.js 7 runs locally in a WebAssembly worker thread, with SHA-256-pinned English/Arabic models downloaded during the build. Decrypted image buffers are processed in memory. No identity image is sent to an external OCR service or written to a temporary file by this integration. A native Tesseract stdin/stdout adapter is also available when explicitly configured.

Explicit feature gates:

```
MEMBERSHIP_AUTOMATED_REVIEW_ENABLED=true
MEMBERSHIP_OCR_ENABLED=true
MEMBERSHIP_OCR_ENGINE=wasm
```

Live phases are persisted only when actual work starts: queued → reading passport / reading ID front and back → matching → approved or additional staff review. No fabricated percentage, review time, or countdown is shown. The applicant polls actual status every eight seconds while the tab is visible.

Automatic approval is conservative:

- Passport: high-confidence TD3 MRZ, document/birth/expiry/optional/composite check digits, name matching, GCC nationality matching the application, and valid expiry.
- Emirates ID: high-confidence matching ID number on both sides, matching name, printed non-GCC nationality, valid expiry and matching eligible occupation/title.
- Missing, uncertain, unsupported or conflicting fields go to staff review. There is no automatic rejection based on OCR failure. Arabic names with Latin-only MRZ, differing transliterations and some card layouts can require staff review.
- Reading written fields and MRZ check digits does **not** authenticate the identity document, validate government records or prove the person owns it. This is membership eligibility matching, not a government identity-verification service.
- Reviews use a lease and optimistic revision checks. Staff decisions win concurrent updates. Interrupted readings go to staff review.

## Staging rollout

Use only `srv-db8bhrqj9qps73cbqbtg`, never Production.

1. Finish isolated browser tests, including applicant submission, admin document viewing, revocation and status failure. Run `npm test` and the production build.
2. Review the source diff against `codex/sandbox-readiness-20261016`, push that branch and require passing CI.
3. Deploy with membership disabled. Run `node scripts/verify-membership-sandbox.js` in a Render one-off job. It requires the existing Sandbox guards, uses random isolated collections, synthetic 1×1 images, stub SMTP, and drops only its own collections. It never modifies real users/bookings or sends real emails. This verifies Mongo transactions and retention, not OCR accuracy.
4. Set each Staging environment key individually, preserving all other keys: independent random 64-hex `MEMBERSHIP_DOCUMENT_ENCRYPTION_KEY`, fixed UTC `MEMBERSHIP_EXISTING_USERS_BEFORE`, `MEMBERSHIP_SITE_URL=https://rimal-api-staging.onrender.com`, and `PRIVATE_MEMBERSHIP_ENABLED=true`.
5. Enable the WASM model build with `MEMBERSHIP_OCR_ENABLED=true` and `MEMBERSHIP_OCR_ENGINE=wasm`. `npm run build` prepares pinned local models. Run `node scripts/verify-membership-ocr.js` in a one-off job to test actual OCR using a synthetic image before setting `MEMBERSHIP_AUTOMATED_REVIEW_ENABLED=true`. Never use real customer identity files in tests.
6. Deploy and verify `/api/v1/ready` and the frontend revision, anonymous inventory 401, new applicant inventory 403, existing accepted account access, private documents and working outbox.

Rollback: set `PRIVATE_MEMBERSHIP_ENABLED=false` and redeploy the reviewed release. Preserve the encryption key and existing applications; never rotate the key without a document migration or expiry plan.

Local verification: fixture suite passed; isolated production build and browser suite passed, including private applicant upload/submission and staff document review. Actual local OCR recognised a synthetic image and correctly refused approval of incomplete evidence. Passport MRZ samples with low OCR confidence remain for staff review; thresholds were not relaxed. Runtime Mongo integration and OCR are rechecked on Staging during rollout.
