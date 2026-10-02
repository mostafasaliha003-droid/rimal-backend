# Hotelbeds Availability pilot

This is an internal, opt-in availability probe. It is separate from the customer
SERP, RateHawk, checkout, and payment flows. It returns supplier availability
with the original rates unchanged and attaches static content from
`HotelbedsHotelContent` using one MongoDB `$in` query.

## Route and gates

`POST /api/hotelbeds/availability-pilot` is mounted only when
`HOTELBEDS_AVAILABILITY_PILOT_ENABLED=true`. A request also requires the regular
`x-api-key` and a separate `x-hotelbeds-operator-key` secret of at least 32
characters. The service independently requires all of the following:

- `HOTELBEDS_ENABLED=true` and `HOTELBEDS_ENV=test`;
- `HOTELBEDS_PILOT_APPROVED=true`;
- an explicit comma-separated `HOTELBEDS_PILOT_HOTEL_CODES` list (at most five);
- one explicit `HOTELBEDS_PILOT_LANGUAGE`;
- `HOTELBEDS_PILOT_PRICE_POLICY=supplier-raw-internal-only`;
- a valid `HOTELBEDS_DAILY_BUDGETS` JSON object containing an `availability`
  budget. The sum of all configured operation budgets must not exceed
  `HOTELBEDS_DAILY_MAX_REQUESTS`, which itself may not exceed 50.

When budgets are configured, provide an entry for every operation the account is
allowed to call (`status`, `availability`, `checkrates`, `booking`, and
`contentsync` if Content API calls are authorized). Requests without a matching
entry fail closed. These are quota ceilings, not a request to spend the allocation.

No pilot hotel codes, language, secrets, or budget allocations are supplied by
this repository. Keep the route unmounted until the account owner supplies and
approves them. Do not commit secrets or add them to `.env`.

The shared MongoDB limiter atomically reserves both the account-wide request and
the operation-specific budget. If MongoDB is unavailable, no supplier request
is sent. Each call makes one Availability request, permits no hotel outside the
configured list, and caps the list at five. This pilot accepts adults-only
occupancy: the official Availability examples available to this implementation
show the child count but do not verify the child-age request field, so children
are rejected rather than sent in a guessed format. The response is non-cacheable.

## Content and price boundaries

Content is never fetched during Availability. Cache misses are identified in
the response; they do not trigger Content API calls. The Content API client
remains separate and its existing service remains mock-only. Hotelbeds currently
documents that hotel mapping must not be performed in its Evaluation/Test
environment, so this pilot does not perform a live content import.

The route is internal-only and preserves supplier price/currency fields as
received. `supplier-raw-internal-only` is a technical gate, not approval to show
prices to customers, convert currency, apply markup, book, or collect payment.
No booking or payment flow is included.

## Separate customer-search orchestrator (disabled by default)

`POST /api/v1/hotels/search` accepts `provider: "hotelbeds"` to select the
API-key-protected Hotelbeds pipeline; requests without that provider selection
fall through unchanged to the existing RateHawk and DubaiLink route. The explicit
alias `POST /api/v1/hotels/search/hotelbeds` is also available. Both use the
existing API-key middleware and search rate limiter. The orchestrator fails
closed before calling Availability unless all of these explicit approvals are
set to `true`:

- `HOTELBEDS_PUBLIC_SEARCH_ENABLED`;
- `HOTELBEDS_PUBLIC_PRICING_APPROVED` and
  `HOTELBEDS_PUBLIC_PRICE_POLICY_APPROVED`;
- `HOTELBEDS_PUBLIC_CONTENT_APPROVED` (incomplete and synthetic mock content is
  excluded from customer results).

These flags are intentionally not enabled or added to `.env` by this change.
The orchestrator is wired to Frankfurter v2, which requires no API key and
publishes daily reference rates rather than intraday executable quotes. The FX
adapter uses a one-hour in-memory cache, validates the provider's rate date, and
fails closed for unavailable or invalid data. This is FX integration, not approval
to use daily reference rates for customer quotes: keep pricing gates closed until
the business approves the source, supported currencies, freshness policy, and
markup policy. The default production path does not use `pricingService`'s fixed
test rates; tests inject deterministic rates and never call Frankfurter.

Passing the search/pricing/content flags is not a substitute for the existing
Hotelbeds test-environment, pilot-list, operator, quota, cache, and content
requirements. Search only returns an explicit customer DTO and does not include
supplier net amounts/currencies or opaque supplier tokens; search does not create
a reservation or collect payment.

## Hotelbeds Booking scaffold (closed by default)

`POST /api/v1/hotels/book` is protected by the existing API-key middleware and
booking limiter. The route requires `publicOfferId` and `guestDetails`, retrieves
the private supplier offer from OfferCache, and atomically claims it before any
supplier call. It is disabled unless both `HOTELBEDS_BOOKING_ENABLED=true` and
`HOTELBEDS_BOOKING_APPROVED=true`; the existing supplier client additionally only
allows `HOTELBEDS_ENV=test`, with mTLS and the shared quota limiter. Keep these
booking flags unset until payment, commercial, and operations approval.

The current booking pilot is intentionally narrow: one room, adults only, and
`AT_HOTEL` payment. It rejects online-payment (`AT_WEB`) offers because this route
does not verify a payment authorization, and rejects child or multi-room requests
until the full availability/guest workflow supports them. `RECHECK` rates are
rechecked and compared against the locked supplier net amount/currency before
Booking. The public response includes only booking reference and status. If a
Booking transport outcome is unknown, the offer is quarantined with its private
client reference; never automatically retry or represent it as a failed booking.
Tests use an in-memory OfferCache and mocked HTTP transport and make no supplier
requests.

## Verification

Run `npm run test:hotelbeds`. All added pilot coverage uses injected fixtures and
does not contact Hotelbeds. Do not run a Sandbox call until the account owner has
explicitly approved the hotel list, language, daily quota allocation, operator,
and test window.