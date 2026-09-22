# Booking experience changes

## Verification

- `node --test test-booking-safety.js frontend/src/services/offers.test.js` checks payment validation, offer normalization and autocomplete language fallback without supplier requests.
- `node --test test-frontend-serving.js` checks HTTP routes with and without `frontend/dist`, including private-file protection, missing assets and CORS preflights for allowed and rejected origins.
- `npm --prefix frontend run build`
- After building, run `npm run prepare:site` to update the static-site root, then `npm run check:site` to verify that its files match the build.
- Start `npm --prefix frontend run preview -- --host 127.0.0.1 --port 5178 --strictPort`, then `node test-ui.cjs`.
- Browser tests intercept all supplier/payment API requests. No real booking or payment is created. Screenshots in `frontend/dist/test-*.png` are test artifacts, not production hotel data. Run a fresh build before publishing to remove them.
- Destination tests start without a saved search and cover selection, empty results, failed requests and recovery. Mocked browser tests do not verify the deployed backend's CORS policy or live supplier inventory.

## Release blockers

- Online collection is disabled by default. Keep `PAYMENT_CHECKOUT_ENABLED` unset or false. Do NOT enable it simply to make the button work: durable payment-intent storage, authenticated Ziina webhook/status verification, idempotent supplier fulfillment, abandoned-session reconciliation and refund handling still need implementation and sandbox certification. Supplier prebook validation alone does not complete this lifecycle.
- Legacy payment and booking endpoints return HTTP 410 because they accepted client-provided payment confirmation. Integrations using them must migrate to the verified lifecycle before reactivation.
- A payment return URL is never proof of payment. The frontend shows a pending-verification message and retains its session draft. It does not claim a confirmed booking or automatically retry a charge.
- Credentials previously embedded in server source must be rotated at the providers, including email, database and any reused admin credential. Removing source values does not erase Git history. Set `SMTP_USER`, `SMTP_PASSWORD`, `MONGO_URI`, and an appropriate `ADMIN_PASSWORD_HASH` securely in the deployment environment. Never put secrets in `VITE_*`: those values are public browser configuration. The existing frontend API key is not user authentication.
- Have the business approve and publish legal terms, privacy policy, refund rules and support contacts. No invented legal policy, ratings, cashback, room amenities or cancellation promise has been added.
- Validate AED/Arabic supplier responses and multi-room/child occupancy against the supplier sandbox. Unit/browser tests use fixtures, not live inventory certification.

## Frontend deployment

`frontend/src` is the source of truth. Express prefers `frontend/dist` when its `index.html` exists. Otherwise it serves only allowlisted public files and the `assets` directory from the committed repository-root site. Both modes support frontend routes without exposing server code, package files or private configuration. Missing API endpoints and assets return 404 rather than the application HTML.

The existing Render build command installs backend packages and Chrome, but does not build the nested frontend project. It can remain unchanged: the committed root site is the tested fallback when `frontend/dist` is absent. To build the frontend on the host instead, install the frontend's dependencies including dev dependencies, then run `npm run build` before starting the server. For a static host, publish the contents of `frontend/dist`, including manifest, icons, offline page and service worker.

For the existing repository-root static site, run `npm run build`, then `npm run prepare:site`. The preparation script copies only the built HTML, application assets, service worker, manifest, offline page and application icons into the root. It leaves `CNAME`, backend files and previous hashed assets untouched. `npm run check:site` verifies byte-for-byte agreement with the current build. These commands prepare local files only: they do not commit, push, deploy or enable payment collection. Backend changes must be deployed separately through the backend host after resolving the release blockers above.

The production preview uses the production API, not Vite's development proxy. The backend's exact CORS allowlist includes HTTP `localhost` and `127.0.0.1` on ports 10000, 5173 and 5178, in addition to the existing production origins. Deploy the backend change for these preview requests to work; rebuilding the frontend alone does not update CORS.

Autocomplete requests the chosen language first, then tries English once only when both hotel and region lists are empty. Existing localized results and supplier errors are preserved. The fallback returns actual supplier names and IDs; it does not translate the query or guarantee matches for Arabic spelling. The interface distinguishes empty results from connection failures and suggests trying another spelling or an English name.

PWA cache v6 stores the offline page, app icons and same-origin hashed JS/CSS/fonts only. It does not cache API responses, checkout documents, guest information or external hotel photos. Offline mode cannot make reservations. Updates are user initiated outside checkout. Notification subscriptions and offline vouchers are not implemented.

The install control deliberately defers the browser's native banner with `beforeinstallprompt.preventDefault()` and calls `prompt()` after the user clicks install. Chrome's banner-suppression message is expected for this custom-install flow and is unrelated to destination requests.

## Measurement and experiments

The UI dispatches `remal:analytics` CustomEvents with an allowlisted name and numeric properties only. There is no analytics network transmission, tracker or experiment assignment by default. An approved consent-aware adapter can subscribe to these events; never add guest data, API credentials or booking hashes.

Events: `search_started`, `search_completed`, `search_failed`, `room_selected`, `checkout_started`, `payment_started`, `payment_failed`. Emit actual payment/booking completion only from verified server outcomes, not redirect pages or clicks. Production React is used in browser tests; development StrictMode may replay effect events.

Before A/B rollout, establish baseline confirmed-booking conversion per eligible search session, payment failure rate, price-change rate, contribution margin, cancellation and refunds. Proposed tests: compact search header versus the previous layout; total-stay price emphasis versus per-night emphasis with both always disclosed; supplier order versus price order. Predeclare sample size, minimum detectable effect, guardrails and stopping rules; assign users consistently. Do not experiment with truthful pricing or cancellation disclosure.

## Deliberate limitations

Arabic and AED are the currently supported experience. Nonfunctional language/currency/login buttons have been removed, not replaced with fake controls. Multi-currency settlement, local wallets, cross-supplier entity/room matching, maps and verified review aggregation require provider data and separate tested integrations. Duplicate hotel IDs in one response are collapsed; this is not cross-supplier identity resolution.