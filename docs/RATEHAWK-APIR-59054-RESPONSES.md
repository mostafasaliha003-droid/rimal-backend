# APIR-59054: Remal Tourism x RateHawk

Prepared 12 November 2026 from the supplied 11-page certification questionnaire.

**Draft for review.** The repository fixes have been tested locally. They have not been deployed or re-certified with RateHawk in this task. The linked Google Doc could not be retrieved, so compare these answers with its current questions before pasting. No Google Doc, email thread, or feedback form was submitted.

## Before submitting

- Confirm that the current application is to certify **B2B deposit only**. Affiliate/pay-at-hotel commercial terms require a separate decision.
- Confirm acceptance of RateHawk's default RPM limits and the proposed 180-second booking cut-off.
- Deploy the reviewed source and frontend together to the isolated certification environment. Existing compiled deployment files were deliberately preserved.
- Configure `RATEHAWK_CONFIRMATION_EMAIL` with the corporate booking mailbox. Checkout fails closed if it is missing. Verify customer receipt of the Remal confirmation at the charged price.
- Set `RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT=10` on that certification environment, with `RATEHAWK_PREBOOK_TIMEOUT_MS=60000`, `RATEHAWK_SERP_TIMEOUT_MS=30000`, and `RATEHAWK_BOOK_WAIT_MS=180000`. Restore the prebook percentage to 2 after certification. No actual environment settings were changed here.
- Run the offline hotel-content synchronization and region-dump import against the intended database; retain their logs. Schedule incremental content updates with a persisted successful cursor, and region imports weekly. These schedules and actual imports remain unverified.
- Perform fresh, explicitly authorized sandbox error scenarios and provide the real partner order IDs and redacted supplier exchanges below. Do not treat fixture tests as supplier evidence.

## Answers to place below the questions

### 1. Payment Types (page 1)

**Proposed answer, subject to confirming the commercial scope:** Our current B2B checkout uses the `deposit` payment type. Please proceed with B2B deposit certification. We understand that the `hotel` payment type belongs to the separate Affiliate API and requires different commercial terms. We will confirm any Affiliate/pay-at-hotel request separately.

### 2. Workflow: lookuprate (page 1)

We have removed `search/lookuprate` from the customer prebook, payment quote, and checkout flow. Availability is checked through hotelpage and prebook. The returned book hash and search criteria are preserved in a signed, expiring context, which is verified before creating the booking form. `lookuprate` remains an optional metadata utility and is not used to decide whether a room is available. These changes are locally tested and await deployment and your retest.

### 3. RPM Limits (page 2)

**Proposed answer, subject to launch-owner confirmation:** We agree to launch with the standard limits: `/serp/hotels` 150 RPM, `/serp/region` 10 RPM, `/serp/geo` 10 RPM, `/search/hp` 10 RPM, and `/hotel/prebook` 30 RPM. We will request an increase only if actual traffic and performance data demonstrate a need. Please configure these limits on our key; we are not claiming that local fixture tests verify the account configuration.

### 4. Hotel static data upload and updates (pages 2-3)

The customer search and hotel-content enrichment paths now read synchronized data from our database. Cache misses no longer trigger Content API requests or background Content API repairs. Confirmation email generation also uses local hotel data.

The offline content job supports `updated_since` when retrieving hotel IDs and then retrieves content for those IDs and updates the database. The region-dump job requests the dump, downloads it, decompresses it and imports the regions. We will run region imports weekly. Actual scheduled execution, successful imports and the incremental cursor still need to be verified in the certification environment before this item can be marked complete.

### 5. Hotel important information (pages 3-4)

We have added a hotel policies section that displays `metapolicy_extra_info` and all populated fields from `metapolicy_struct`, including nested and previously unrecognized fields. Values are rendered as text with readable labels. Zero and false values are retained rather than silently omitted. Local source and browser tests passed; please recheck after deployment.

### 6. Room static data matching (page 4)

We now match static and dynamic room content using the complete `rg_ext` classification. We do not use `room_group_id` for matching. A dynamic classification without an exact static match is displayed in a separate group, using its own dynamic information rather than borrowing another room's photos or details.

### 7. Match_hash usage (pages 4-5)

We have removed `match_hash` from matching, booking-reference fallbacks and outgoing B2B search requests. Availability and booking use the actual `book_hash` returned by hotelpage/prebook. Room content matching uses `rg_ext`.

### 8. Prebook rate (page 5)

The certification runner now sends numeric `price_increase_percent: 10`. The website's prebook percentage is controlled on the server by `RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT`; it must be set to 10 on the certification deployment and can return to 2 after certification. Browser input cannot override this server policy. The prebook HTTP timeout defaults to 60 seconds and cannot be configured above 60 seconds.

When prebook changes a displayed price, the updated amount is shown and the customer must take a second action to continue at that price. An expired or inconsistent offer requires a fresh selection. The certification environment setting and supplier price-change retest remain pending.

### 9. Search timeouts (pages 5-6)

We agree to a 30-second supplier search timeout for `/serp/hotels` and `/search/hp`. B2B search requests now send a default `timeout: 30`; supplied values are constrained to 7-30 seconds. The HTTP transport allows an additional five seconds for network overhead. Please set the key default to 30 seconds. The supplier timeout and the HTTP transport timeout are separate settings.

### 10. Cancellation policies (page 6)

Free-cancellation deadlines and penalty intervals are now displayed with an explicit `UTC+0` label. RateHawk timestamps without a timezone offset are parsed as UTC, so the browser timezone does not shift the deadline. An invalid timestamp is not presented as a valid deadline. Local source and browser tests passed.

### 11. Final price / commission (pages 6-7)

Yes, the net model is clear. We apply the customer markup on our side; we do not expect ETG to calculate a commission. The current B2B customer flow uses a 7% markup. In your screenshot, USD 218.00 x 7% = USD 15.26, and USD 218.00 + USD 15.26 = USD 233.26, so USD 15.26 is our markup.

The supplier `amount` and `currency_code` remain the settlement amount and currency used for the booking. Customer display uses `show_amount` / `show_currency_code` when supplied, with our markup added; the supplier fields are the fallback when the show fields are absent. A separately requested payment-currency conversion is bound to a verified quote and does not change the supplier settlement amount or currency.

### 12. Receiving the final booking status (pages 7-8)

**Proposed account configuration: polling.** We use `/hotel/order/booking/finish/status/` to obtain the final booking outcome. A successful or ambiguous response from `/booking/finish/` is not itself treated as confirmation. Polling continues through transient/unknown results until a final success or final error is received. Our durable status worker normally polls every five seconds and honors supplier rate limits. Please confirm that this interval is acceptable; your questionnaire recommends three seconds.

We do not require the booking-status webhook for this certification scope. The repository contains an optional webhook handler, but its presence is not a request to enable the webhook on our account. Other independent webhooks, such as customer payment notifications, are separate.

### 13. Booking cut-off (pages 8-9)

**Proposed answer:** Please configure a 180-second supplier booking cut-off, with the countdown starting after the response to Start booking process, including OK, 5xx, unknown or timeout outcomes. The durable booking implementation defaults to this 180-second window and starts its full local countdown when the finish call returns. A provisional persisted deadline supports recovery if the application stops during that call.

Please confirm the corresponding key configuration and the final status/error returned when your cut-off is reached. A local timer expiring does not prove that no reservation exists: while the supplier outcome is ambiguous we continue reconciliation, prevent duplicate booking, and do not report a final failure or issue a refund solely from the local timer.

### 14. Confirmation emails (page 9)

The B2B finish request now takes `user.email` exclusively from the required server configuration `RATEHAWK_CONFIRMATION_EMAIL`. It does not fall back to the guest's address. We retain the guest's email for Remal's own delivery.

The customer email attaches a Remal-generated confirmation PDF showing the verified customer amount, including our markup. The original supplier PDF is not forwarded to the guest because it may contain the net price. The corporate mailbox setting, actual email delivery and acceptance of the resulting customer document still need to be verified on the certification deployment.

### 15. Errors and status processing scenarios (pages 9-10)

We have updated the sandbox runner to use the required partner-order suffix before booking/form. A scenario is accepted by the runner only when its supplier exchanges contain `unknown` at both finish and finish/status, followed by the expected final outcome. Generating the suffix or passing a fixture test is not sufficient evidence.

| Scenario | Required suffix | Partner order ID / evidence |
| --- | --- | --- |
| Unknown, then successful booking | `unknown_success` | Pending a fresh authorized sandbox run |
| Unknown, then soldout | `unknown_soldout` | Pending a fresh authorized sandbox run |
| Unknown, then book_limit | `unknown_book_limit` | Pending a fresh authorized sandbox run |

We will provide fresh IDs and redacted supplier logs after those runs. The local log dated 22 October contains transport failures for all eight recorded scenarios. It does not substantiate the earlier readiness note's successful remote-run claim, and the previously supplied IDs should not be reused as verified evidence.

### 16. Retrieve bookings (pages 10-11)

Final confirmation is obtained through finish/status, not order/info. The confirmation workflow does not call order/info immediately after a successful status. The history lookup for a known booking process is deferred for at least 30 seconds after the persisted final confirmation time and is held while that process is still in flight. The customer's account history is read from our saved booking records.

An explicit successful cancel response is treated as a successful cancellation; we do not repeat cancellation to obtain confirmation. The order-info utility remains available for explicit history/details requests and reconciliation when a cancellation outcome is ambiguous. We are not using that utility as initial booking confirmation.

## Verification record

- `node scripts/run-tests.js`: 552 passed, zero failed, one optional real MongoDB transaction integration test skipped because its dedicated environment is not configured.
- Focused tests cover signed context tampering, expiration and account/environment changes; prebook identity; corporate recipient selection; booking status and deadline races; UTC handling; room classifications; offline static sync and region import.
- The isolated frontend build and booking, support and membership browser suites passed. The new browser checks cover policy text, UTC+0, signed context handoff and an increased price requiring a second action. A mobile policy/cancellation screenshot was inspected.
- No fresh supplier booking, payment, cancellation, database import, remote configuration or deployed-runtime verification was performed in this task.

## Suggested email reply

Hello Mikhail,

Thank you for the detailed review. We have implemented and locally tested the repository changes and prepared answers for each pending questionnaire point. Deployment verification, scheduled content imports, confirmation-mailbox delivery and the fresh error-scenario booking IDs are still pending, so we are not yet requesting those points to be marked complete.

Our proposed scope is B2B deposit, the standard RPM limits, a 30-second search timeout, a 60-second prebook timeout, polling for final status, and a 180-second booking cut-off. We will share the remaining evidence after the certification deployment has been verified.

Best regards,
Remal Tourism

**Sending note:** This email is a draft only. Do not say that answers have been added to the Google Doc until they actually have been pasted and verified there. Feedback in the separate form should reflect the team's own experience.
