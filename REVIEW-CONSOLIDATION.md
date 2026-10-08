# Security/mTLS review consolidation — 2026-10-08

## Scope and ancestry

This review branch starts from the sanitized release commit `0910636`. It combines
the uncommitted source changes from the `main` worktree (197 status entries,
including generated files) and the separate `feat/hotelbeds-readiness-phase1`
worktree (14 entries). It does **not** merge the unrelated history of `main`.
Neither original worktree nor `release/security-mtls-clean` was changed.

## Conflict resolutions

- Retained release authentication, compromised-key rejection, mTLS and TEST-only
  provider restrictions; incorporated the newer review, voucher and content-sync
  implementation and tests.
- Preserved private deployment-readiness diagnostics and realm validation while
  retaining the encrypted voucher snapshot and durable booking identity fields.
- Combined the content planner's credential, quota and isolated-database checks
  with the scoped transactional cursor and the newer Content API adapters.
  The redacted planning summary reserves the optional category lookup as well.
- Kept RateComments separate from content synchronization. Legacy combined
  adapters are rejected explicitly rather than silently ignored; validation of
  comment dates remains covered by the separate normalizer.
- Updated fake configuration used by tests to satisfy the merged safety checks.
  Fresh-content fixtures no longer expire simply because the wall clock passed
  seven days after a fixed fixture date. Production freshness rules are unchanged.
- Rebuilt browser assets from the merged source. Superseded generated bundles
  were excluded; original generated files remain available in the untouched
  worktrees and the verified pre-sync backup.

## Local validation

Tests ran from the isolated review worktree without an `.env` file, with a
sanitized process environment and an external TCP/DNS guard. HTTP route tests
used loopback; supplier/payment transports and database writes used fixtures.
The startup probe used an intentionally unavailable loopback database address.

- Booking, voucher, persistence, review, prepaid and checkout tests: **82 passed**.
- Content, planning, readiness, startup and optional Mongo tests: **67 passed,
  1 skipped**. The real Replica Set integration case was not configured.
- Search, provider clients, pricing, FX, caches and frontend service tests:
  **133 passed**.
- Authenticated routes, socket ownership, affiliate and webhook regression tests:
  **26 passed**.
- Browser fixture test: **PASS**. Browser API requests are intercepted, so this
  does not establish a real UI-to-backend or supplier end-to-end integration.
- Frontend build and local site consistency: **PASS**, 28 files verified.
  Vite still reports a bundle-size warning above 500 kB.

## Review-only, not production approval

No environment files, real credentials, certificates, dependency directories or
local backup files are included. No supplier request, real booking, payment or
deployment command was executed. Publishing this branch does not authorize
merging it into the release branch or changing the hosting service's branch.

Hotelbeds certification, real database transaction validation, account-specific
commercial approval, and completion of the remaining customer flow and supplier
products remain outstanding as recorded in the readiness documents.