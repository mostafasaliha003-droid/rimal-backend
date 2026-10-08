# Hotelbeds Content API sync — next-stage design

**Status: pilot cursor and writer coordination implemented locally; not approved
for operation.** The importer remains manually operated and TEST-only. This does
not authorize live traffic, a full-portfolio bootstrap, a scheduled job, or a
real database run.

## Current boundary

- The importer is limited to at most five explicitly approved hotel codes, one
  language, and one hotel page per run. The existing operation budget also
  reserves room for a category-dictionary request.
- A durable pilot cursor and a database-backed TEST writer lease are implemented.
  The cursor is scoped to one account fingerprint, language, sorted hotel-code
  set, and resource version. A global per-database writer lease prevents
  overlapping sets from writing the same hotel/language records concurrently.
- Bootstrap and cursor/content commits require MongoDB transactions. The service
  fails closed on a standalone MongoDB deployment rather than attempting an
  uncoordinated write. Local tests simulate transactions; they do not prove the
  configured database supports them.
- `npm run test:hotelbeds-content-sync-mongo` is a separate optional integration
  test. It runs only when `HOTELBEDS_CONTENT_SYNC_MONGO_INTEGRATION_URI` is set to
  a credential-free IPv4/IPv6 loopback MongoDB URI with `directConnection=true`,
  uses a fresh generated database name, and injects fake supplier HTTP. Mongoose
  auto-creation is disabled for the isolated test connection; the test verifies
  the database is absent, writes a run-specific ownership marker before creating
  models/indexes, and drops the database only after confirming that marker and
  waiting for active writes to settle. If a run cannot be settled, the DB is
  intentionally preserved and the test reports cleanup failure. No integration
  run is implied by the standard mocked test suite.
- On 2026-10-06, the optional test reported ten local safety/schema/cleanup and
  fake-adapter sync cases passed, with its one real MongoDB case skipped because
  `HOTELBEDS_CONTENT_SYNC_MONGO_INTEGRATION_URI` was not configured. No MongoDB
  endpoint was contacted, so real transaction support remains unverified.
- Hotel documents are upserted into the isolated Hotelbeds mock database. The
  current importer does not synchronize the full Content API dictionary set or
  import RateComments.
- Next-Gen customer search remains on mock content. Static Content API calls
  must remain outside live search.

## Implemented pilot cursor flow

For the fixed isolated TEST content database, `sync:hotelbeds-content --apply`
now uses the cursor coordinator. The first successful run bootstraps the explicitly
approved hotels. Later runs load the exact matching scope cursor and request from
one day before the date on which the preceding run started. Replays are expected
and handled through idempotent hotel upserts. A caller-supplied earlier date can
request a wider replay; it cannot skip ahead of the stored checkpoint.

A single database-wide lease serializes all content writers in this synchronizer,
including different or overlapping hotel sets. The lease owner and monotonically
increasing fencing token are rechecked in the transaction that writes content and
advances that scope's cursor. The upstream HTTP calls happen before that short
transaction; a stale run must not commit after losing its lease. An empty delta
still commits a successful cursor without changing any hotel document.

Direct production use of the importer without the sync coordinator is rejected.
The fake-database tests stage content and cursor writes and can verify rollback
behavior, but this is only a simulation—not proof of MongoDB transaction behavior.

## Scope identity and state

Store sync state only in the existing isolated Hotelbeds mock database. A cursor
must be scoped to a deterministic identity containing at least:

- environment (`test`),
- a non-reversible fingerprint of the API key/account identity (never the key or
  secret itself),
- the normalized, sorted approved hotel-code set,
- language, and
- a versioned list of synchronized resources/mapping rules.

The exact cursor key includes the sorted pilot hotel-code set, account fingerprint,
language, and resource version. Changing that scope creates a new cursor and
requires its own successful initial import. A separate database-wide lease records
the active scope and monotonically increasing fencing token. Do not reuse an
incomplete cursor for a different account, language, hotel list, or resource set.

## Bootstrap and differential algorithm

1. **Bootstrap:** when no initialized cursor exists, request the complete
   approved pilot set without `lastUpdateTime`. Confirm every requested hotel is
   returned, resolve required dictionaries, validate every record, and write the
   content. Mark the cursor initialized only after all required writes succeed.
2. **Differential run:** acquire an atomic, expiring database-wide writer lease before
   any supplier request or content write. Read the prior successful checkpoint
   and send a deliberately overlapping date window, rather than advancing a
   date-only filter to an unverified timestamp boundary.
3. Validate and upsert all returned records and required dictionary data. The
   upserts are replay-safe; a failed or partial write must leave the cursor
   unchanged so the same interval can be retried.
4. Advance the checkpoint only after all page fetches, normalization, validation,
   and writes complete. Commit content and cursor in the same MongoDB transaction;
   condition the transactional lease update on its lease ID and fencing token.
   Release the lease in `finally`. An expired/stale run must not overwrite a newer
   cursor or newer content.
5. Keep bootstrap completion and differential progress distinct. A cursor must
   never indicate that a full initial load completed merely because a partial
   page or one dictionary request succeeded.

The Hotelbeds documentation describes `lastUpdateTime` as returning hotels
modified or added after the specified date, with `YYYY-MM-DD` format, and
recommends a daily differential after the initial load. Because this is
date-granular, the implementation should use a conservative overlap and tolerate
repeated records. Before enabling unattended runs, confirm boundary/time-zone
behavior and any deletion/tombstone behavior with the approved Sandbox account
or Hotelbeds support. Do not infer deletion from a record's absence in a delta.

## Full portfolio is a separate project

Do not remove the pilot hotel-code gate to turn the current one-page importer
into a portfolio sync. Hotelbeds' published initial-load example describes about
173 hotel pages for its then-current portfolio, plus multiple static dictionary
operations; those figures are guidance, not a current account-specific plan or
quota guarantee. A full bootstrap needs its own bounded page checkpointing,
resource-by-resource completion state, retry/restart plan, operation budgets,
storage review, and approved portfolio/language scope. Dictionaries need their
own completeness/update policy; syncing Categories alone is not a full dictionary
sync. RateComments remain optional/separate and require their own approved
contract and design.

## Gates before unattended scheduling or broader scope

Do not add a cron, timer, hosted worker, or automatic retry loop until all of the
following are explicitly settled:

1. The business/account owner approves the exact portfolio (pilot or full),
   languages, resources, storage target, and Sandbox credentials/quota.
2. Hotelbeds confirms the date-filter boundary semantics and the handling of
   removed/retired content for the applicable operations.
3. The cursor/lease design has tests for bootstrap, no-change deltas, overlapping
   replay, partial database failure, concurrent invocations, expired leases,
   scope changes, and cleanup. Run the optional local MongoDB integration test on
   an approved disposable replica-set instance to verify real transaction behavior.
4. The operator can inspect a plan and run one explicit TEST apply; production
   hosts and customer request paths cannot invoke this synchronizer.
5. Monitoring reports last successful run, scope, request counts, imported
   counts, and sanitized error codes without logging credentials or full supplier
   payloads.

Until those gates are met, retain the current manual CLI and fail-closed approval
checks. Local implementation and fake-adapter tests are not evidence of Sandbox
connectivity, MongoDB transaction support, or permission to schedule synchronization.