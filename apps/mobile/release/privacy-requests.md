# Account-deletion request intake — 0.3.0

The Account screen exposes an Arabic/English owner-authenticated request for review. A fixed website link to `/account-deletion` is also available from Support and account/privacy links. This feature records a request; it does not erase an account or cancel a booking.

The backend contract is GET/POST `/api/auth/account-deletion`, with `data_deleted: false`, a `requested` status, reference and received timestamp. The application accepts a receipt only from a valid response, retains the user's normal session and shows that the account and data remain unchanged. Wrong reauthentication passwords do not log the user out. Actual invalid/expired sessions use the existing session handling. Password and consent fields clear after submission and across account/session changes. Unknown outcomes require checking status before another submission.

The application sends only the current password and explicit consent. Account ownership and environment are derived from the authenticated server session. Passwords, tokens and ownership selectors never enter navigation parameters or the fixed website URL. Credentials remain governed by the existing SecureStore/in-memory preview adapters. The consent checkbox exposes both its native checked state and the checked state required by the web preview's accessibility adapter.

## Owner policy and remaining release gate

On 17 November 2026, the owner instructed that customer accounts remain retained, with account ownership preserved for at least one year. The requested five-day booking-data period starts after hotel **checkout**. Both past and new actual invoices are to be archived to `connect@remaltourismllc.com`. These are company instructions, not a claim of legal compliance.

No erasure or automatic five-day purge is enabled. Retention must first be mapped across booking, guest, checkout, payment, refund, supplier and support records. The companion backend includes request intake, a read-only administrative queue and a separately guarded invoice archive runner. A source implementation or fixture test does not prove deployment, completed archival or scheduling.

This is only part of the [Google Play account-deletion requirement](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). A pending request and retention of the full account do not establish actual deletion of associated data. Fulfillment, appropriately limited/disclosed retention, live production links and accurate privacy/Data Safety declarations remain unresolved before Play release.

## Validation boundary

Source validation passed 59 app unit tests plus TypeScript and ESLint. The account-deletion adapter tests cover exact short/spaced passwords, route restrictions, incorrect-password session retention, malformed/future responses and the fixed website URL. The companion backend passed 632 tests with one skipped integration test and no failures, including intake and invoice fixtures. Its staging deployment at source `3924d7ea4e2adb9092c4c44799f57ee106827a76` passed actual GET-only health/revision, public AR/EN/ES page, privacy-link and unauthenticated API checks. No live deletion request, booking, payment or data erasure was performed. Browser fixtures simulate responses; Android binary verification and physical-device testing are separate evidence.

Production invoice delivery remains inactive: the production service's selected supplier configuration is Sandbox and the archive runner's required SMTP settings are absent. The owner confirmed that RateHawk production is not activated yet and asked to continue app development. Do not substitute sandbox documents, report invoices sent or enable a production archive schedule from this state.
