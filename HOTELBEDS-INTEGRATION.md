# Hotelbeds scaffold

The Hotelbeds client and availability pilot are isolated from RateHawk. Direct
booking remains behind its own explicit approval gates, and the prepaid
credit-line connector remains standalone and is not wired to checkout or a public
payment route. This change does not enable booking or payment gates.

## Configuration

Supply all secrets and certificate paths through the deployment secret manager.
Do not place credentials or private keys in source control, and do not reuse the
credentials previously embedded in `server.js`; rotate those credentials with
Hotelbeds before any supplier request.

```dotenv
HOTELBEDS_ENABLED=false
HOTELBEDS_ENV=test
HOTELBEDS_API_KEY=
HOTELBEDS_SECRET=
HOTELBEDS_ACCOUNT_CONFIG=
HOTELBEDS_MTLS_BASE_URL=https://api-mtls.test.hotelbeds.com
HOTELBEDS_MTLS_CERT_PATH=
HOTELBEDS_MTLS_KEY_PATH=
HOTELBEDS_RATE_MAX_REQUESTS=8
HOTELBEDS_RATE_WINDOW_MS=4000
HOTELBEDS_DAILY_MAX_REQUESTS=50
HOTELBEDS_DAILY_WINDOW_MS=86400000
HOTELBEDS_MOCK_CERTIFICATION_ENABLED=false
HOTELBEDS_RECONCILIATION_OPERATOR_ENABLED=false
HOTELBEDS_CONTENT_IMPORT_ENABLED=false
HOTELBEDS_CONTENT_IMPORT_APPROVED=false
```

`HOTELBEDS_API_KEY` and `HOTELBEDS_SECRET` must be newly rotated Hotel API
credentials. Generate a CSR and the private key locally; create the certificate
in the Developer Portal using its certificate workflow, download the issued
certificate, and associate it with the Hotel API key before use. Never upload or
share the private key. The absolute certificate/key paths must refer to this
matching pair, and the private key must remain outside source control with
restricted file permissions. Renew the portal certificate before expiry. The
current environment only accepts
`https://api-mtls.test.hotelbeds.com`; production hosts are rejected.
The portal documentation warns that associating a key can disable its non-mTLS
endpoints after a grace period (14 days by default). A key can be associated with at
most two certificates, and a key associated with only one certificate cannot be
detached from that certificate. Plan rotation with certificate overlap and confirm
the account-specific procedure before changing key associations.
The Hotelbeds Mutual Authentication guide requires mTLS for Hotel availability,
CheckRate, Booking confirmation, Booking list, Booking detail, Booking change,
Booking cancellation, and Booking reconfirmation. This repository currently has a
client for Availability/CheckRate/Booking/BookingList only; any future detail,
change, cancellation or reconfirmation client must use the approved mTLS setup too.
The `status` probe is shown by the Getting Started guide on the standard test API
host and is not listed among the operations requiring mTLS. Do not treat a status
request sent to the mTLS gateway as a documented mTLS handshake test; use a
documented mTLS operation only when explicitly approved. Check the API reference
with the account owner for future operations or environment changes.
The agent enforces TLS 1.2 or newer and normal server certificate verification.

Authentication follows the official Getting Started example: lowercase hexadecimal
SHA-256 of the exact concatenation `API key + secret + current Unix timestamp in
seconds`, without separators. The documented GET example sends `Api-key`,
`X-Signature`, and `Accept: application/json`. The Hotel Booking POST example also
sends `Accept-Encoding: gzip` and `Content-Type: application/json`; the client does
the same for POST requests. The reviewed examples do not require an `Api-version`
header. These content-negotiation headers are not part of the signature input.

Do not confuse the API Secret used in `X-Signature` with the separate mTLS portal
“Create Secret” value: the Mutual Authentication guide describes that portal value
as being used for certificate creation. Load the Hotel API Secret from the API Keys
credentials area for request signing.

## Shared request limits

The limiter stores request timestamps in MongoDB and uses a single atomic update,
so it is shared across backend instances. If MongoDB is unavailable, the limiter
fails closed and no Hotelbeds request is sent. It keys the bucket by a hash of the
test environment and Hotel API key so internal account labels cannot split the
quota. `HOTELBEDS_ACCOUNT_CONFIG` remains a required internal setting and is never
sent to Hotelbeds.

Hotelbeds documents a 50-request daily quota for evaluation credentials and a
403 response when that quota is exceeded. The limiter conservatively caps the
local rolling 24-hour window at 50, but this is not a claim about Hotelbeds'
reset time. It also cannot count requests made by other systems using the same
Hotelbeds key. Confirm the account's real quota window and aggregate usage before
using the integration. The 8-requests/4-seconds burst defaults are the supplied
account policy and are not represented as a general Hotelbeds API limit; confirm
them with the account manager before enabling.

## Booking workflow

The direct pay-at-hotel and isolated prepaid services share
`services/hotelbedsBookingCoordinator.js` and the durable
`HotelbedsBookingAttempt` store. Scope-specific unique indexes claim a direct
offer or prepaid checkout session before any supplier operation; the short-lived
OfferCache is not the idempotency record. A majority-acknowledged attempt claim
and a private `clientReference` are kept even when the cache expires.

- `BOOKABLE`: normally send one Booking POST without CheckRate. Best Practices
  permits a single selected-key CheckRate only when extra information (for example
  complete RateComments) is needed. The current direct price-review step uses this
  exception to present the applicable terms before consent; it consumes that
  review snapshot and does not CheckRate again before Booking.
- `RECHECK`: send one CheckRate with just the selected opaque `rateKey` and
  `upselling: false`. Match hotel, room, stay, occupancy, payment type, board,
  packaging, net and currency against the immutable rate identity. Validate
  cancellation, promotions and resolved rate comments separately against the
  accepted terms snapshot.
- Never parse or transform `rateKey`. If CheckRate returns a different opaque
  key, this implementation rejects it because it cannot prove that the new key
  is the selected offer.
- Persist `booking_processing` and the exact key before the sole Booking POST.
  An unknown outcome remains quarantined; retries never send another Booking.
- The read-only reconciliation helper uses Hotels BookingList filtered by creation
  dates and private `clientReference`, scans bounded pages, and returns
  `response_ambiguous` rather than infer absence when pagination is incomplete. An
  admin-only operator route exposes this read-only result only when
  `HOTELBEDS_RECONCILIATION_OPERATOR_ENABLED=true`; it never mutates an attempt and
  there is no automatic worker. Its 25-item page window, five-page cap and 30-day
  lookback are local safety limits, not supplier maxima. The public Hotels reference
  shows a 1–25 page example but does not expose a complete pagination schema here.
- Availability requests containing `hotels.hotel` are rejected above 2,000
  hotel IDs, before consuming the shared request quota.

Hotelbeds specifies a minimum 60-second timeout for Booking Confirmation. Static
hotel descriptions/images use the separate Content API client and
`HotelbedsHotelContent` model; synchronize them out of band, not during live search.
The current content page builder allows up to 1,000 records per request.

## Certification readiness matrix

Status describes this repository's Hotelbeds scaffold, not certification of the
supplier account. `Implemented/tested` means local mock coverage exists; it does
not mean the corresponding behavior has been verified against a live account.

| Certification area | Current state | Remaining evidence or work |
| --- | --- | --- |
| Technical transport | **Partial.** Dynamic SHA-256 signature, JSON, gzip acceptance, fixed test hosts, mTLS for Availability/CheckRate/Booking/BookingList, and 60-second Booking timeout are implemented. | Run certification only after rotated Hotel API credentials and a registered/associated test mTLS certificate exist. |
| Availability/booking workflow | **Restricted scaffold implemented/tested.** The customer search and `/api/v1/hotels/book` route are wired behind independent approval gates. Both direct and isolated prepaid coordinators use a durable, scope-indexed attempt record; RECHECK validates a stable rate identity plus a separate terms snapshot, and opaque changed keys are rejected. Unknown outcomes are reconciled through a bounded, read-only BookingList helper exposed to an admin-only operator route behind its own gate. | Not production/certification ready: obtain business approval for payment/collection and monitored reconciliation, prove every required room was requested in the same Availability call, implement multi-room/child guest mapping and refund/notification operations, verify durable confirmed-booking/voucher persistence against real Sandbox responses, and complete supplier certification. Online-payment rates remain rejected. |
| CheckRate policy | **Implemented/tested.** One `rateKey` per call and no mixed BOOKABLE/RECHECK keys. Best Practices require CheckRate for `RECHECK` and allow it for `BOOKABLE` when extra data such as RateComments is needed. Direct price review issues at most one CheckRate for the selected key and consumes the accepted snapshot for Booking without a second CheckRate. | Confirm with Hotelbeds that one pre-consent CheckRate satisfies `RECHECK` and that requesting `BOOKABLE` RateComments at price review fits the account/channel workflow. Keep provider-specific response/error handling and the no-repeat rule. |
| Guest and room choices | **Restricted adults-only pilot.** The booking endpoint maps one room's adult names to Hotelbeds paxes and rejects children/multiple rooms. | Add verified child-age and multi-room flows end-to-end and exercise different occupancies before expanding the pilot. |
| Rates, cancellation and comments | **Not certification-ready.** No Hotelbeds result presentation is wired to the frontend. | Demonstrate accurate price/currency, room/board/category, applicable cancellation policy using destination-local policy times, and rate comments before confirmation. Declare if policies/comments are not used. |
| Content API | **Bounded TEST integration with local mocked coverage; no supplier handshake.** A TEST-only Content API client and operator CLI fetch approved pilot hotel codes from `/hotels`, resolve missing category text through `/types/categories`, and write validated content into the isolated content collection. Plan mode is default; `--apply` requires both import approval gates and uses a durable, account/language/hotel-set-scoped bootstrap/differential cursor plus a database-wide writer lease. Content and cursor commits require MongoDB transactions. Standard tests use fake HTTP/database adapters; a separate optional local Replica Set integration test exercises MongoDB with fake HTTP and a fresh, guarded localhost-only database. Neither configured-database support nor live Sandbox behavior is verified unless that optional test is explicitly run and passes against the designated disposable Replica Set. No scheduler, full-portfolio bootstrap, full dictionary workflow, hotel-details fallback, RateComments import, or customer UI integration is implemented; Next-Gen remains on mock data. | Run the guarded local transaction test against a disposable local Replica Set; then confirm approved Sandbox credentials/scope and verify the pilot job once in Sandbox before considering unattended operation. Separately approve and design any full-portfolio/dictionary bootstrap and remaining static operations. Never call static Content API during live search. Content API use itself is encouraged, not a substitute for Booking API flow/certification. |
| Voucher | **Fixture-tested PDF path implemented; no supplier handshake.** Confirmed direct-booking responses are mapped into an encrypted snapshot; the authenticated owner PDF route validates it against the scoped booking and fresh verified Hotelbeds Content API record before rendering. Category, phone and agency reference are optional in the mapper/PDF and omitted when missing without placeholders; name, address, owner/supplier scope, language, source and content freshness remain enforced. A non-empty accepted CheckRate comment set is stored when Booking omits RateComments; an explicit empty or different response is treated as a conflict and suppresses voucher issuance without repeating Booking or undoing supplier confirmation. Shared comment validation allows up to 2,000 characters/comment, 50 comments, and 24 KiB normalized JSON. Fixture tests cover these paths; there is no supplier handshake. | Verify response semantics, supplier/VAT/payment wording and child/passenger conventions against representative Sandbox responses. Confirm the accepted CheckRate comment set is suitable for the final voucher and how any supplier comment changes should be handled before certification. Existing RateHawk/ETG vouchers must not be represented as an HBX voucher. |
| Certification submission | **Not prepared.** | Provide workflow for each channel, commercial exclusions, certification URL and reviewer access, payment information if applicable, language guide if needed, and instructions to isolate HBX inventory from other suppliers. |
| Live verification | **Blocked / manual only.** | A live booking is a real reservation and can create cancellation charges. Do not automate it. It requires post-certification live credentials, business approval, a non-NRF/non-penalty rate and explicit coordination of the test and cancellation. |
The Certification checklist section 2.6 specifies a maximum of **10 rateKeys per
CheckRate request**; this is a rate-key limit, not an API-credential-key limit. Best
Practices recommends separate calls because a valuation error can fail the full
request and some external suppliers do not support multiple valuations. This
implementation uses one selected key per call and never mixes `BOOKABLE` with
`RECHECK`; retain that single-key behavior and confirm any account-specific quota
with Hotelbeds.

**Commercial decision still required:** Hotelbeds documents Liberate/pay-at-hotel as
Commissionable, while the current direct pilot requires `AT_HOTEL` and the aggregate
search filter permits only approved Net offers without `sellingRate` or commission
fields. This is a potential account-model mismatch, not proof of the account's actual
configuration. Confirm the account/channel pricing and collection model with
Hotelbeds before exposing live rates; do not weaken the existing commercial filters
or apply an extra markup to a Commissionable `sellingRate` without written approval.
The document's Live checklist is not permission to create or cancel a real
reservation without explicit business approval.

Hotelbeds' tax-breakdown feature is disabled by default and requires account
activation. When present, included taxes are already in the rate price and must not
be added again; excluded taxes/fees are generally payable at the property. The
`clientAmount`/`clientCurrency` pair represents the client-currency amount when
returned. The integration preserves these fields for display, but its customer-facing
Hotelbeds flow currently uses mock offers, so live tax presentation is unverified.

## Local verification and activation gates

Run `npm run test:hotelbeds`, `npm run test:booking-flow`,
`npm run test:hotelbeds-prepaid-booking`, `npm run test:offer-cache`,
`npm run test:live-fx-service`, and
`npm run test:search-orchestrator` for fixture-only tests; they do not connect to
Hotelbeds or Frankfurter. Before any external Sandbox request: rotate exposed credentials, create
and associate the mTLS certificate, confirm the quota reset/aggregate account use,
confirm the 8/4 policy, pricing/collection responsibility and unknown-booking
reconciliation procedure. Keep `HOTELBEDS_ENABLED=false` until these gates and the
Checkout/payment design are approved.

## Offline mock certification UI

The opt-in `GET /api/hotelbeds/mock-certification-flow` route returns only fixed
mock Availability, CheckRate, Content API and Voucher data. Set
`HOTELBEDS_MOCK_CERTIFICATION_ENABLED=true` when starting the app; otherwise the
route is not mounted. When mounted, it is intentionally public for same-origin
certification UI use and returns fixture data only; never place real guest data in
this mock flow. This independent UI gate
does not turn on `HOTELBEDS_ENABLED`, access the supplier, or consume evaluation
quota. Its hotel, booking reference, tax number and passenger data are conspicuously
mock-only and must never be used as a real voucher. The returned Voucher is JSON,
not a certified supplier PDF or email.