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
endpoints after a grace period (14 days by default), and that a key can be
associated with at most two certificates. Confirm certificate rotation details
with the account owner before changing key associations.

The Hotelbeds Mutual Authentication guide lists Hotel availability, CheckRate,
Booking confirmation, and post-booking operations as requiring mTLS. The `status`
probe is shown by the Getting Started guide on the standard test API host and is not
listed among the operations requiring mTLS. Do not treat a status request sent to
the mTLS gateway as a documented mTLS handshake test; use a documented mTLS
operation only when explicitly approved. The API reference must be checked with the
account owner for any future operations or environment changes.
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

- `BOOKABLE`: send one Booking POST; do not CheckRate first.
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
- The read-only reconciliation helper uses Hotels BookingList filtered by
  creation dates and private `clientReference`, scans bounded pages, and returns
  `response_ambiguous` rather than infer absence when pagination is incomplete.
  The 25-item page window, five-page cap and 30-day lookback are local safety
  limits, not claims about a supplier maximum. The public Hotels references show
  a 1–25 page example but do not expose a complete pagination schema here. The
  helper never changes the attempt and is not wired to a worker or operator route.
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
| Availability/booking workflow | **Restricted scaffold implemented/tested.** The customer search and `/api/v1/hotels/book` route are wired behind independent approval gates. Both direct and isolated prepaid coordinators use a durable, scope-indexed attempt record; RECHECK validates a stable rate identity plus a separate terms snapshot, and opaque changed keys are rejected. Unknown outcomes are reconciled only by a bounded read-only BookingList helper. | Not production/certification ready: obtain business approval for payment/collection and reconciliation operations, prove every room required by a booking was requested in the same Availability call, implement multi-room/child guest mapping, wire monitored reconciliation and refund workflows, persist confirmed bookings/vouchers/notifications, and complete supplier certification. Online-payment rates remain rejected. |
| CheckRate policy | **Implemented/tested** for a single key. Current Best Practices say one `rateKey` per call and no mixed BOOKABLE/RECHECK keys; this conservative rule takes precedence over the older Certification page's allowance to group up to ten. | Keep provider-specific response/error handling and the no-repeat rule in any later workflow. |
| Guest and room choices | **Restricted adults-only pilot.** The booking endpoint maps one room's adult names to Hotelbeds paxes and rejects children/multiple rooms. | Add verified child-age and multi-room flows end-to-end and exercise different occupancies before expanding the pilot. |
| Rates, cancellation and comments | **Not certification-ready.** No Hotelbeds result presentation is wired to the frontend. | Demonstrate accurate price/currency, room/board/category, applicable cancellation policy using destination-local policy times, and rate comments before confirmation. Declare if policies/comments are not used. |
| Content API | **Offline mock only.** `HotelbedsHotel` is an isolated strict collection and `syncMockHotels` validates fixtures and bulk-upserts them. No live Content API fetch, scheduled sync, detail fallback or UI is implemented. | If using HBX content, persist it, refresh at least weekly as recommended, and fetch hotel detail for properties absent from the cache. Show matching images, category, facilities/fees and applicable descriptions. Content API use itself is encouraged, not mandatory. |
| Voucher | **Mock object implemented/tested only.** It validates and maps the certification fields and dynamic payment statement; it does not generate a PDF, send email, or read a real Booking Confirmation. | Integrate after a confirmed Hotelbeds booking. Confirm real response-field mapping, supplier/VAT values, payment wording and child/passenger conventions with Hotelbeds and the business. The Hotelbeds guide calls phone recommended, but this application's requested voucher generator and isolated model require it. Existing RateHawk/ETG vouchers must not be represented as an HBX voucher. |
| Certification submission | **Not prepared.** | Provide workflow for each channel, commercial exclusions, certification URL and reviewer access, payment information if applicable, language guide if needed, and instructions to isolate HBX inventory from other suppliers. |
| Live verification | **Blocked / manual only.** | A live booking is a real reservation and can create cancellation charges. Do not automate it. It requires post-certification live credentials, business approval, a non-NRF/non-penalty rate and explicit coordination of the test and cancellation. |

The document's “up to ten CheckRate keys” statement conflicts with Hotelbeds'
current Best Practices, which says not to send more than one key in a CheckRate
operation. This implementation follows the stricter current Best Practices.
The document's Live checklist is not permission to create or cancel a real
reservation without explicit business approval.

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