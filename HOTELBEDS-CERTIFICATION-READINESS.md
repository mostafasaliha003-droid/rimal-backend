# Hotelbeds Hotels — Certification readiness

**Review date: 2026-10-04.** This document records what is present in this
repository; it is not evidence of supplier connectivity or certification. The
customer-facing Next-Gen Hotels page calls the deterministic mock aggregate route
and checkout explicitly rejects live offers. A separate live aggregate route is
internal-key protected. A user-authenticated direct Hotelbeds booking route exists
behind independent server-side approval flags, but it is a narrow adults-only,
single-room, pay-at-hotel pilot. No Hotelbeds request, booking, payment or
certification was run for this review.

## Current implementation boundary

| Area | Repository state | Work still needed |
| --- | --- | --- |
| Transport | Hotel API signature, fixed test host, mTLS client for Availability/CheckRate/Booking/BookingList and a 60-second Booking timeout exist. Tests inject transport; no supplier handshake is proven. | Rotate the Hotel API credentials and provision/associate the approved test mTLS certificate; coordinate the test hotel, account quota and test window with Hotelbeds. |
| Availability and booking | Availability, CheckRate, booking confirmation, and read-only BookingList client/service exist. `BOOKABLE` avoids CheckRate; `RECHECK` checks only the selected opaque key. Durable attempt claims prevent duplicate Booking POSTs. | Prove the real Sandbox workflow and complete the agreed post-booking detail/cancel/amend scope. No Hotelbeds Booking detail, cancellation or amendment integration was found. |
| Customer search and checkout | Next-Gen uses mock search; the mock payment/webhook uses `createHotelbedsMockCheckoutBookingService`. Checkout rejects a live cached offer. The separate live aggregate route requires server-side `x-internal-api-key` and is not the Next-Gen customer route. | Build an authenticated, server-mediated customer search-to-checkout flow. Do not put an internal API key in the browser. Agree payment/collection and pricing before enabling the flow. |
| `AT_WEB` service | `hotelbedsPrepaidBookingService.js` has fixture tests, but `server.js` does not instantiate it for the actual customer checkout/webhook. | Wire it only after payment ownership, authorization, persistence, duplicate/unknown-outcome handling, refunds, and operations monitoring are approved and tested. |
| Reconciliation | A bounded read-only BookingList reconciliation helper exists and has fixture tests. It does not mutate attempts and is not connected to a worker or operator route. | Implement the approved monitored resolution process. Never blindly retry an ambiguous Booking POST. |
| Rate presentation | The Next-Gen offer card can display price, room/board, cancellation, comments, taxes and fees, but it currently receives mock data. | Test real supplier results and disclose all account/channel exclusions before certification. Confirm FX and retail-price treatment against the actual contract. |
| Voucher | A Hotelbeds-specific mapper is exercised only by the mock certification JSON route. It is not called with a real Booking Confirmation. The generic owner PDF route is not connected to this mapper or the full supplier/content payload. | Map real confirmation/content, render and deliver the Hotelbeds voucher after each confirmed booking, and verify it with the certification reviewer. |
| Content API | A page client, isolated model and bounded importer exist. The importer needs an injected page-fetch adapter and has no production caller, schedule or detail fallback. Next-Gen uses mock content. | If using HBX content, store it and synchronize out-of-band. Hotelbeds' Content API guide gives `lastUpdateTime` differential updates and recommends daily refresh; static content must not be requested in real time. Confirm the account-approved content scope. |
| Cache API | No Hotelbeds Cache API client or portfolio-file workflow found. Internal `OfferCache` is only a short-lived private booking-offer store. | Not a universal prerequisite for real-time Booking API. Hotelbeds recommends Cache API for comparison sites, heavy traffic, publishing inventory/prices to third parties or preparing packages/offers. Decide with the account team whether this architecture applies. |
| CDS API | No CDS client, portfolio configuration or scanner found. | CDS is for discovering inventory changes for cache/live scanning, not a general prerequisite for direct Availability. Hotelbeds says an active Hotels API Suite key and CTS account/portfolio configuration are needed. Confirm applicability with CTS. |
| Crawler/mapping | No Hotels Crawler integration found. | The Hotels certification checklist explicitly requests crawler integration. Confirm the applicable specification and channel/account scope with Hotelbeds. Hotelbeds' Evaluation/Test prohibition is about **hotel mapping**; do not use a test mapping/crawler workflow. |

The current Hotelbeds booking client follows the stricter Best Practices instruction
to send one selected `rateKey` per CheckRate operation. The Certification page also
mentions a multi-key limit, so ask Hotelbeds before changing this rule. Keep the
supplier key opaque. Certification should verify that Availability is sent once,
CheckRate is used when required for `RECHECK`, then Booking is sent once; do not
repeat the same Booking request after an unknown transport outcome.

## Commercial and price gates

Hotelbeds documents distinct **Net** and **Commissionable** models. In Net, respect
`sellingRate` whenever `hotelMandatory=true`; otherwise a reseller markup may be
allowed by the applicable contract. In Commissionable, use `sellingRate` as the
final customer price and do not add another markup. This code's public-search path
converts to AED and can apply `B2C_MARKUP_PERCENT`, so get written confirmation of
the account's model, allowed source markets/currencies, FX and markup before
displaying rates. A software flag or test fixture is not commercial approval.

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

Hotel category, destination, phone number and agency reference are recommended.
Hotelbeds recommends not showing the reservation price on the voucher. Verify the
real supplier values and final wording; the JSON returned by the mock route is not a
voucher for an actual reservation.

## Certification request and sequencing

The official Certification page says “5 different areas” but enumerates six labels:
Technical; Workflow; Availability/CheckRate/Confirmation; Voucher; Content; Live
environment. Preserve this discrepancy and ask the reviewer to confirm the exact
scope. Certification is tested in the Test environment; the documented Live
booking/cancellation check is a separate post-certification operation and is a real
reservation with possible charges.

Once the Sandbox workflow is reviewable, request certification from
`apitude@hotelbeds.com` and provide:

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
   and cancellation terms, obtain consent, perform CheckRate only for `RECHECK`,
   send one Booking, persist its outcome and issue the real voucher.
4. Add and operate only the post-booking/reconciliation/refund features required by
   the account and sales channel. Collect logs/evidence, reviewer access and the
   channel/commercial-exclusion materials before requesting certification.
5. Do not run the documented Live booking/cancellation check until certification,
   Live credentials and explicit Hotelbeds/business coordination are in place. Use
   a no-penalty, non-NRF rate and coordinate cancellation; do not automate it.

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