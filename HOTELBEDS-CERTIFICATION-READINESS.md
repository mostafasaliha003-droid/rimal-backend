# Hotelbeds Hotels — Certification readiness

**Review date: 2026-10-07.** This document records what is present in this
repository; it is not evidence of supplier connectivity or certification. The
customer-facing Next-Gen Hotels page calls the deterministic mock aggregate route
and checkout explicitly rejects live offers. A separate live aggregate route is
internal-key protected. A user-authenticated direct Hotelbeds booking route exists
behind independent server-side approval flags, but it is a narrow adults-only,
single-room, pay-at-hotel pilot. No Hotelbeds request, booking, payment or
certification was run for this review; the new Content API integration test uses
only an injected HTTP transport and a fake database write adapter.

## Render startup and safe readiness diagnostics

Configure a stable `RIMAL_AUTH_REALM` for the deployment; do not invent a new
realm when existing sessions or owner-scoped records rely on a previously
established value. A missing or malformed realm does not prevent the HTTP health
listener from starting; the protected readiness report marks startup blocked,
and session/booking operations remain unavailable until a valid realm is set.

`GET /api/v1/internal/health/readiness` requires the server-to-server
`x-internal-api-key`, rejects requests carrying `Origin`, and returns
`Cache-Control: no-store`. It reports application readiness separately from
Hotelbeds integration state and emits no environment values, Mongo connection
strings, certificate paths, quota allocations, or hotel identifiers. The
application can be ready while Hotelbeds remains disabled or unverified; a 200
does not prove supplier connectivity or certification. Readiness checks do not
call Hotelbeds, payment providers, Content API, Cache API, or CDS.

The Hotels API mTLS certificate applies to the current Availability, CheckRate,
Booking and BookingList operations. The separate Content API client uses the
fixed TEST Content host and does not use that client certificate. Content planning
still requires explicit TEST/approval gates, valid Content credentials and rate
settings, an allowlisted hotel, and a validated isolated mock database target.
The importer has no scheduled/runtime caller; its plan-only mode does not load
`.env`, connect to either supplier or MongoDB, or write data.

For a fixture-assisted import, the service validates all requested content and
optional rate comments before its first write. It then upserts content and rate
comments into separate collections; absent a Mongo transaction, those two writes
are **not atomic**. A database error on the second write may leave the content
upsert committed, so inspect/reconcile the isolated database before retrying.

With the TEST flags, content credentials and isolated Mongo target injected into
the process environment, a local summary can be generated without a supplier or
database connection:

```powershell
npm run plan:hotelbeds-content -- --hotel-code 74001 --language ENG --page-size 100 --page-limit 1
```

Repeat `--hotel-code` for each approved property (maximum five).

The command prints only counts and coarse states; it does not print hotel IDs,
credential values or database targets. It is not an import/sync command.

Run `npm run test:readiness` and `npm run test:hotelbeds` for readiness, route
security, content plan/importer validation, and booking-record fixtures. Tests use
local subprocesses, injected fixture adapters, and in-memory model doubles; they do
not connect to the supplier or payment services. The plan-only CLI subprocess runs
with guards that reject network, MongoDB, and `.env`/certificate-file access; its
test also probes that those guards actually stop such attempts. The fixture importer
fetches and validates all requested records before connecting to its isolated test
database. Separately, the server-startup regression test deliberately attempts a
MongoDB connection to `127.0.0.1:1` with a 500 ms selection timeout to verify that
local HTTP health/readiness remains available when MongoDB is unavailable. That is
a refused local connection attempt, not evidence that no MongoDB attempt occurred.

## Current implementation boundary

| Area | Repository state | Work still needed |
| --- | --- | --- |
| Transport | Hotel API signature, fixed test host, mTLS client for Availability/CheckRate/Booking/BookingList and a 60-second Booking timeout exist. Tests inject transport; no supplier handshake is proven. | Rotate the Hotel API credentials and provision/associate the approved test mTLS certificate; coordinate the test hotel, account quota and test window with Hotelbeds. |
| Availability and booking | Availability, CheckRate, booking confirmation, and read-only BookingList client/service exist. `RECHECK` is checked once; `BOOKABLE` uses CheckRate only in the separate price-review flow when required to surface rate comments. Both review types use one selected opaque key and never repeat CheckRate before Booking. Durable attempt claims prevent duplicate Booking POSTs. | Prove the real Sandbox workflow and complete the agreed post-booking detail/cancel/amend scope. No Hotelbeds Booking detail, cancellation or amendment integration was found. |
| Customer search and checkout | Next-Gen uses mock search; the mock payment/webhook uses `createHotelbedsMockCheckoutBookingService`. Checkout rejects a live cached offer. The separate live aggregate route requires server-side `x-internal-api-key` and is not the Next-Gen customer route. | Build an authenticated, server-mediated customer search-to-checkout flow. Do not put an internal API key in the browser. Agree payment/collection and pricing before enabling the flow. |
| `AT_WEB` service | `hotelbedsPrepaidBookingService.js` has fixture tests, but `server.js` does not instantiate it for the actual customer checkout/webhook. | Wire it only after payment ownership, authorization, persistence, duplicate/unknown-outcome handling, refunds, and operations monitoring are approved and tested. |
| Reconciliation | A bounded read-only BookingList reconciliation helper exists and has fixture tests. It does not mutate attempts; an admin-only operator route (`GET /api/v1/admin/hotelbeds/reconciliations/:clientReference`, mounted only when `HOTELBEDS_RECONCILIATION_OPERATOR_ENABLED=true`) now exposes it read-only. No automatic worker or resolution mutation exists. | Implement the approved monitored resolution process. Never blindly retry an ambiguous Booking POST. |
| Rate presentation | The Next-Gen customer offer card currently receives mock data. A separate internally gated aggregate path converts eligible offers to AED and can apply `B2C_MARKUP_PERCENT`; its Hotelbeds policy accepts only explicitly approved Net offers with `hotelMandatory=false`, no `sellingRate`/commission fields, and additional rate/tax/cancellation constraints. The supplier tax-breakdown feature is disabled by default and requires account activation. | Obtain written approval of the actual pricing model, source market, currencies, FX and markup before presenting live prices. Hotelbeds documents Liberate/pay-at-hotel as Commissionable, while this pilot requires `AT_HOTEL` and the aggregate filter permits only Net offers. Confirm the account's actual commercial/payment model before any live offer; do not remove the Net/commission safety filters or apply a second markup to a Commissionable `sellingRate`. If tax breakdown is enabled, `included=true` taxes are informational and must not be added again; `included=false` taxes/fees are generally payable at the property. `clientAmount`/`clientCurrency` are client-currency counterparts when supplied. |
| Voucher | A Hotelbeds-specific mapper and owner-authenticated PDF route are implemented. On confirmed direct bookings, the service stores an encrypted voucher snapshot; the PDF route checks the owner, supplier scope, confirmation, and fresh verified Content API record, then renders a Hotelbeds PDF. Optional category, telephone and agency-reference fields may be omitted without placeholder values; hotel name, address and account/language/source/freshness binding remain required. The consumed CheckRate comments are preserved in the encrypted snapshot when Booking omits them; conflicting confirmation comments make the voucher unavailable, not the booking. Shared comment validation enforces 2,000 characters per comment, 50 comments, and a 24 KiB normalized JSON bound. Local coverage uses fixtures; no real Booking Confirmation has been verified. | Verify optional-field and RateComments behavior against representative Sandbox confirmation/content responses, including supplier/VAT/payment wording and child/passenger conventions. Confirm that the supplied CheckRate comments are applicable for the booking and that any confirmation variation is handled according to Hotelbeds semantics before certification. Voucher generation fails closed on comment conflicts/invalid bounds without repeating Booking. The separate mock route is JSON-only and is not a real voucher. |
| Content API | TEST-only `/hotels` and `/types/categories` clients, a bounded importer, and an operator CLI exist. The CLI is plan-only by default; `--apply` requires both import approval gates and approved pilot hotel codes/language/budget, then uses a durable account/language/hotel-set-scoped bootstrap/differential cursor and a database-wide writer lease. Content and checkpoint commit together in a MongoDB transaction; local tests use fake HTTP/database adapters, so configured MongoDB transaction support and Sandbox behavior remain unverified. Next-Gen still uses mock content. No full-portfolio bootstrap, full dictionary workflow, scheduler, hotel-details fallback, or RateComments import is implemented. | Confirm approved Sandbox credentials/scope and MongoDB transaction support, then verify the bounded pilot job in the approved Sandbox. Separately approve and design any full-portfolio/dictionary synchronization and remaining static UI mappings. RateComments are not imported by this job (Hotelbeds documents that operation as optional and also supplies comments through CheckRate). |
| Cache API | No Hotelbeds Cache API client or portfolio-file workflow found. Internal `OfferCache` is only a short-lived private booking-offer store. | Not a universal prerequisite for real-time Booking API. Hotelbeds recommends Cache API for comparison sites, heavy traffic, publishing inventory/prices to third parties or preparing packages/offers. Decide with the account team whether this architecture applies. |
| CDS API | No CDS client, portfolio configuration or scanner found. | CDS is for discovering inventory changes for cache/live scanning, not a general prerequisite for direct Availability. Hotelbeds says an active Hotels API Suite key and CTS account/portfolio configuration are needed. Confirm applicability with CTS. |
| Crawler/mapping | No Hotels Crawler or One Hotel Mapping integration found. | The certification checklist explicitly requests Crawler integration. It is a portfolio/SFTP mapping workflow, not a Booking API confirmation dependency; obtain account-owner scope and credentials/specification. Best Practices prohibit making hotel mappings under Evaluation/pre-production. Do not submit test mappings. |

Best Practices say to CheckRate `RECHECK` rates and allow CheckRate for `BOOKABLE`
only when extra information such as RateComments is needed. This implementation's
direct customer price-review step requests that information for both rate types,
checks only one selected key, and consumes the accepted snapshot for Booking without
a second CheckRate. Keep the supplier key opaque. Certification should verify this
single-review flow and confirm that requesting RateComments for `BOOKABLE` matches
the account/channel setup; do not repeat Availability, CheckRate, or a Booking request
after an unknown transport outcome.

## Commercial and price gates

Hotelbeds documents distinct **Net** and **Commissionable** models. In Net, respect
`sellingRate` whenever `hotelMandatory=true`; otherwise a reseller markup may be
allowed by the applicable contract. In Commissionable, `sellingRate` is final and
must not receive another markup. The Next-Gen customer offer card currently receives
mock data. A separate internally gated aggregate path converts eligible offers to
AED and can apply `B2C_MARKUP_PERCENT`; its Hotelbeds filter accepts only explicitly
approved Net offers with `hotelMandatory=false`, no `sellingRate`/commission fields,
and further rate, tax and cancellation restrictions. Obtain written approval for the
actual account model, market, currency, FX and markup before presenting live prices.
A software gate or fixture is not commercial approval.

## Voucher checklist

Hotelbeds says a voucher must be generated for each confirmed booking and sent or
made available to the final customer. The Hotels certification checklist classifies
the following as mandatory:

- Hotel name and address.
- Lead holder name and at least one passenger name per room (for one room, the
  holder name is sufficient); include children's ages when children are present.
- Hotelbeds booking reference, check-in and check-out dates, room type and board
  type.
- Applicable rate comments.
- The payment statement with supplier/name, supplier VAT number and booking
  reference, in the form: `Payable through XXX, acting as agent for the service
  operating company, details of which can be provided upon request. VAT: YYY
  Reference: ZZZ`.
Hotelbeds recommends not showing the reservation price on the voucher. The local
mapper omits category, phone and agency reference when absent instead of inventing
values; hotel name/address and the account, language, source and freshness checks
remain required. A non-empty accepted CheckRate comment set is copied to the booking
snapshot when the Booking confirmation omits RateComments. An explicit empty or
different confirmation set is treated as a conflict and suppresses voucher issuance
without retrying Booking. Shared validation limits comments to 2,000 characters each,
50 comments, and 24 KiB normalized JSON so the encrypted booking snapshot remains
bounded. Account-specific response semantics still require Sandbox evidence. The mock
route's JSON is not a voucher for an actual reservation.

## Certification request and sequencing

The official Certification page says “5 different areas” but enumerates six labels:
Technical; Workflow; Availability/CheckRate/Confirmation; Voucher; Content; Live
environment. Preserve this discrepancy and ask the reviewer to confirm the exact
scope. Certification is tested in Test; the documented Live booking/cancellation
check is separate, post-certification work and creates a real reservation.

Best Practices specifies one Availability, one CheckRate for `RECHECK`, then one
Booking. It normally omits CheckRate for `BOOKABLE`, but permits it when extra data
such as RateComments is needed. This implementation performs one pre-consent review
and consumes that snapshot without a second CheckRate; confirm this timing with the
certifier.

The Certification checklist section 2.6 specifies a maximum of **10 rateKeys per
CheckRate request**; this is a rate-key limit, not an API-credential-key limit. Best
Practices recommends separate calls: a valuation error can fail the whole request,
and some external suppliers do not support multiple valuations. The connector sends
one selected key per request and never mixes `BOOKABLE` and `RECHECK`; retain this
single-key behavior and confirm any account-specific quota with Hotelbeds.

The official Glossary defines a rate as a room/board/passenger combination, a
`rateKey` as the unique product/date identifier used for confirmation, and cancellation
deadlines in destination-local time. `PAQ` identifies a package; `NRF` a non-refundable
rate. Disney requirements are conditional on selling those products: `DIS` is Walt
Disney World and `DLP` Disneyland Paris. Display package promotions and board plans,
use wildcard room names, capture the booking's `supplierReference`, refresh promotion
and board dictionaries at least every 15 days, and confirm wildcard activation with
the KAM. No pilot Disney property was identified in the approved list reviewed.

- The workflow for each distribution channel (explain differences between channels).
- Commercial exclusions (for example excluded destinations, hotels, room or board
  types, or results).
- Certification URL and reviewer credentials, if needed.
- Payment information, if applicable; a language guide if needed.
- How to identify/isolate HBX Group inventory when other suppliers are integrated,
  plus any other relevant review notes.

Recommended order before requesting review:

1. Obtain written account decisions on contract/pricing model, payment and
   collection responsibilities, source market, currencies/FX/markup, accepted
   one-room/adults-only restrictions, and whether Crawler, Cache API or CDS apply.
2. Rotate compromised/local or deployed credentials; provision the test mTLS
   certificate, allowed hotel list, language, quota budget and a supplier-approved
   test window. Keep all supplier and internal keys server-side.
3. Connect and exercise the intended user flow in Sandbox: search, show exact rate
   and cancellation terms, obtain consent, send one CheckRate for `RECHECK` (or for
   `BOOKABLE` only when extra information such as RateComments is needed), send one
   Booking, persist its outcome and issue the real voucher.
4. Add and operate only the post-booking/reconciliation/refund features required by
   the account and sales channel. Collect logs/evidence, reviewer access and the
   channel/commercial-exclusion materials before requesting certification.
5. Do not run the documented Live booking/cancellation check until certification,
   Live credentials and explicit Hotelbeds/business coordination are in place. Use
   a no-penalty, non-NRF rate and coordinate cancellation; do not automate it.

The certification checklist says Content/Crawler should be reviewed; Hotelbeds'
Crawler page describes an account-enabled portfolio-mapping service using templates
and SFTP. Applicability, portfolio ownership, and access must be agreed with the
account team. Best Practices explicitly prohibit hotel mapping under an Evaluation/
pre-production plan; confirm separately with the account manager whether a non-mapping
SFTP connectivity test is permitted.

## Exposed browser credential — operational action required

A legacy `REMAL_SECURE_KEY` appeared in tracked browser sources and root bundles.
This revision removes its value and corresponding legacy headers from those source
files/bundles. A fingerprint scan found no matching value in the scanned workspace
web text files. This does **not** rotate the key, purge copies already deployed or
cached, or erase Git history. `.env` is untracked and was intentionally not edited;
the local file still contains the old variable and does not configure
`RIMAL_INTERNAL_API_KEY`. Manually rotate/replace the local and hosting secrets,
keep the replacement out of browser code, deploy a clean frontend, purge CDN and
service-worker caches, and consider the old value compromised. No deployment or
secret-store change was made here.

## Open questions for Hotelbeds

Before opening the direct-booking gates, confirm with Hotelbeds (via dashboard support
or the certification contact):

1. Does one CheckRate at the quote/price-review step (before customer consent),
   followed by Booking with the accepted snapshot and no second CheckRate, satisfy
   the required `RECHECK` workflow?
2. Best Practices expressly allow CheckRate for `BOOKABLE` when extra information
   such as RateComments is needed. Confirm that using it for the selected rate at
   price review is appropriate for this account/channel and state the applicable
   per-key/per-account request quota.
3. Confirm the account's shared evaluation quota and reset window, including usage
   by any other systems using the same Hotel API key.
4. Confirm which commercial model is enabled for this account/channel. The documented
   Liberate/pay-at-hotel model is Commissionable, but the current direct pilot requires
   `AT_HOTEL` while the live aggregate filter accepts only Net offers without
   `sellingRate`/commission fields. Confirm whether this pairing is supported before
   publishing or booking live rates; no commercial behavior is changed by this review.
5. Provide representative Sandbox Booking Confirmation and Content API responses for
   this account, and confirm optional voucher fields and how applicable RateComments
   are returned. Specifically confirm whether a missing comment means none apply, how
   selected CheckRate comments must be preserved when Booking omits them, and acceptable
   comment lengths. Until then, do not interpret absent comments as an empty set.

Until Hotelbeds answers, the direct-booking gates remain disabled in `.env`.

## Local fixture checks

The following commands use local fixtures/mocked transports and must not be treated
as Hotelbeds connectivity or certification:

```powershell
npm run test:hotelbeds
npm run test:booking-flow
npm run test:hotelbeds-prepaid-booking
npm run test:checkout-state-machine
npm run test:hotelbeds-live-aggregate
npm run test:search-orchestrator
npm run test:multi-supplier-search
npm run test:offer-cache
```

## Validation performed on 2026-10-07

- `npm run test:hotelbeds`: **56 passed, 0 failed** on 2026-10-07 (local fixtures/mocked transports).
- `npm run test:booking-flow`: **21 passed, 0 failed** on 2026-10-07 (local fixtures/mocked transports).
- `npm run test:hotelbeds-content-sync`: **24 passed, 0 failed** on 2026-10-07
  (local fake HTTP, database, and transaction adapters).
- `node --test test-hotelbeds-voucher-snapshot.js test-owned-booking-pdf-routes.js
  test/hotelbeds-rate-review.test.js`: **27 passed, 0 failed** on 2026-10-07
  (local fixtures/mocked transports).
- `npm run test:hotelbeds-content-sync-mongo`: **10 passed, 1 skipped** on 2026-10-06.
  Local URI, ownership, schema-isolation, timeout, cleanup-guard, and fake-adapter
  sync-flow tests passed. The real MongoDB integration case was skipped because
  `HOTELBEDS_CONTENT_SYNC_MONGO_INTEGRATION_URI` was not configured; no database
  was contacted and transaction support remains unverified.
- `npm run check:site`: previously verified 28 local frontend files match the
  repository build output. This is not a remote deployment/hosting check.
- No real Hotelbeds endpoint, credentials, production API, database, booking, or
  certification reviewer was contacted. Fake transaction adapters do not prove
  the configured MongoDB deployment supports transactions.