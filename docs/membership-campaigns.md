# Membership offer previews

The anonymous membership page polls `GET /api/membership/offers` every 60 seconds
while visible, refreshes on return to the page, and removes expired campaigns.
It does not expose hotel inventory, supplier rates, customer data or booking links.
Destination cards are inspiration, not live hotel availability.

Publish reviewed campaigns through `config/membershipOffers.json` and the normal
Staging release process. The default list is empty. No campaign or saving is
invented when there is no approved offer; the page shows membership benefits instead.

Each campaign needs:

- `id`: lowercase letters, digits and hyphens (maximum 64 characters).
- `approved: true` and `evidenceReference`: an internal review reference, not a
  secret or a customer document. This repository is public; keep supporting
  documents elsewhere.
- `startsAt` and `endsAt`: ISO timestamps with an explicit time zone.
- `title: { ar, en }` and `terms: { ar, en }`: approved copy, including eligible
  hotels/dates, restrictions and any comparison qualification. Exact availability
  and booking prices remain behind approved membership.
- Optional `maxSavingPercent`: integer 1–100, only with `comparisonBasis` describing
  a verified comparison for equivalent hotel, room, occupancy, dates, meals,
  cancellation conditions, currency and included taxes/fees.

Do not publish an “up to 30%” claim until a genuine qualifying offer has been
verified. Do not imply that an advertised maximum applies to every stay. The API
returns only public copy, validity dates and a validated optional saving percentage.
Campaign dates on the page display Dubai time with its time zone.

Test with `node --test test/membership-offers.test.js`. Browser fixtures may use
sample campaigns without publishing them to Staging.
