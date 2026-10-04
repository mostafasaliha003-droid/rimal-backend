# Hotelbeds prepaid booking connector (isolated, disabled)

This document describes an isolated Hotels Booking API connector for the
`AT_WEB` prepaid-rate shape. It does **not** enable payment or booking, mount an
HTTP route, call Hotelbeds from the Ziina webhook, or establish that this
agency's account has a usable credit line in the Hotelbeds Test environment.

## Supplier request shape

Hotelbeds' Hotels Booking workflow shows `AT_WEB` on the selected Availability
rate, then confirms the rate using `POST /hotel-api/1.0/bookings` with `holder`,
`rooms[].rateKey`, `rooms[].paxes`, and `clientReference`. The Hotels workflow
example does not include `paymentData` or a card. Keep the provider's opaque
rateKey unchanged. Do not add a guest card, VCC, Ziina intent, invented
`creditLine`/`agencyPayment` property, or Activities API `paymentData` to this
Hotels API request.

The connector's allowlisted body is:

```json
{
  "holder": { "name": "Ada", "surname": "Lovelace" },
  "rooms": [{
    "rateKey": "opaque-rate-key-from-hotelbeds",
    "paxes": [
      { "roomId": 1, "type": "AD", "name": "Ada", "surname": "Lovelace" },
      { "roomId": 1, "type": "AD", "name": "Charles", "surname": "Babbage" }
    ]
  }],
  "tolerance": "0",
  "clientReference": "RML1234567890ABCDEF"
}
```

This implementation deliberately supports only one room with adults and no
children. `clientReference` is generated once and durably stored before the
Booking POST. It is a reconciliation identifier; this code does not assume it
is a supplier idempotency key.

## Preconditions and current integration boundary

`services/hotelbedsPrepaidBookingService.js` is a standalone service. It is not
registered in `server.js`, is not injected into `services/ziinaWebhookHandler.js`,
and has no customer-facing route. The existing public booking service still
accepts only `AT_HOTEL`. The current mock checkout persists
`paymentProvider: "mock"`; this connector requires a persisted
`paymentProvider: "ziina"` session and refuses the mock flow.

Before a real caller is designed or wired, Hotelbeds/account operations must
confirm in writing that this exact Hotel API account and Test contract support
the `AT_WEB` rate with agency credit-line settlement and no payment-card object.
The gates below are software interlocks, not evidence of that commercial
approval. A passing fixture test is not a substitute for supplier confirmation.

The connector independently requires all of:

- `HOTELBEDS_PREPAID_BOOKING_ENABLED=true`
- `HOTELBEDS_PREPAID_BOOKING_APPROVED=true`
- `HOTELBEDS_CREDIT_LINE_APPROVED=true`
- `HOTELBEDS_ENABLED=true` and `HOTELBEDS_ENV=test`
- MongoDB ready and a persisted session in `payment_verified` with Ziina intent
  identity, verification timestamp, `AT_WEB`, a live offer, and private guest data

No flags are set by this change. Do not enable these flags until credit-line
eligibility, payment verification, rate/price policy, quota, reconciliation, and
refund operations are separately approved and tested.

## State and duplicate-delivery behavior

1. A future trusted Ziina verifier must check the signed raw webhook and then
   verify the intent server-to-server, including account, intent ID, completed
   status, exact minor-unit amount, currency, and Test/Live identity. Browser
   return parameters and the current mock webhook are not sufficient.
2. Only a persisted `payment_verified` session may be claimed. A scope-specific,
   unique durable `HotelbedsBookingAttempt` is inserted before the checkout
   session CAS and before any supplier request. It stores the unique attempt ID,
   client reference, original rate key and immutable rate/terms snapshots.
3. `RECHECK` performs one CheckRate request for the one selected key. It verifies
   rate identity (including the locked net/currency, occupancy and `AT_WEB`)
   separately from cancellation, promotions and resolved comments. Any change
   enters `refund_review`; a different opaque CheckRate key is rejected because
   its relationship to the selected offer cannot be proven.
4. The connector persists `booking_processing` and the final rate key before
   the one Booking POST. No card or payment data is forwarded.
5. Only a response with a booking reference and `CONFIRMED` becomes
   `confirmed`. `ON_REQUEST`/`PENDING` is stored as `booking_pending`; a timeout,
   5xx, incomplete result, or uncertain write is quarantined as
   `outcome_unknown`. Repeated calls/webhooks in these states do not issue a
   second Booking POST.

The shared read-only BookingList reconciliation helper searches a bounded
creation-date window by the private `clientReference`, follows bounded pages,
checks that the supplier response is unambiguous, and does not update the
attempt. It is not wired to a background worker or operator route. No automatic
stale-claim recovery, pending-status worker, or Ziina refund worker is
implemented. Do not reset `booking_processing` or `outcome_unknown` to retry
Booking: a process crash may have happened after Hotelbeds received the first
POST.

## Local verification

`npm run test:hotelbeds-prepaid-booking` uses injected supplier transport and an
in-memory checkout/attempt fixture; a focused Mongoose contract test exercises
the actual model validation and `create([document], options)` call against a
local collection stub. The suite does not connect to MongoDB, Ziina, or Hotelbeds.