# APIR-59054 second update: booking and history responses

Prepared 16 November 2026 against the second-update questionnaire, pages 12, 13 and 15. This describes the implementation prepared for the isolated certification deployment. It does not by itself establish deployment, supplier key configuration or new supplier test results.

## Page 12: receiving final booking status

We use polling of `/hotel/order/booking/finish/status/`, rather than the optional booking-status webhook, to obtain final confirmation.

**Trigger.** Once `/booking/finish/` completes with an OK, 5xx, unknown or transport-timeout outcome, we persist the booking as unresolved and schedule the first ordinary status request five seconds later. An OK finish response is not booking confirmation. The durable background worker also resumes due unresolved bookings after the application reconnects to its database, so closing the customer page does not stop reconciliation. If the application stops while finish is in flight, its provisional persisted schedule permits crash recovery without repeating finish.

**Attempts and interval.** There is no fixed total or maximum number of status attempts. Attempts are scheduled by time and the last result, not by a counter. During the normal tracking window, the next ordinary attempt is due at least five seconds after the previous request completes; supplier rate-limit instructions can extend that delay. The worker checks for due records every second and uses a per-booking lease to avoid concurrent requests. Request duration, worker load, rate limits, outages and the final deadline check affect the actual number of calls. We therefore do not state a guaranteed count such as 36 requests. Each status transport makes one request without an internal retry.

**Termination.** Normal polling stops when finish/status returns final OK or a recognized final booking error, or when a locally verified cancellation has made the process final. A 3DS challenge remains unresolved while it is being handled. Unknown, timeout, HTTP 5xx, rate-limit and other non-final results do not prove booking failure. We schedule a check close to the end of the local tracking window when permitted by the supplier's retry instructions. If the 180-second local window expires without a final supplier result, the booking remains unresolved, the customer is not told to rebook, and no refund is issued solely because that timer expired. Durable reconciliation then slows to at least 60 seconds between completed checks until a final result is obtained; operator review is also required. We never repeat booking/finish merely to recover an ambiguous outcome.

Implementation: `services/bookingProcessService.js` (`finishProcess`, `checkProcess`, `reconcilePendingProcesses`, `startBookingStatusWorker`), `services/ratehawkService.js` (`startBookingProcess`, `checkBookingProcess`), and `services/ratehawkClient.js` (`bookingFinish`, `bookingFinishStatus`). The separate exported `waitForBookingStatus` utility has a bounded foreground wait; it is not the durable website worker and does not convert its timeout into a final failure.

## Page 13: start of the agreed 180-second cut-off

Please start the agreed **180-second production-key countdown after the Start booking process call completes**, including OK, 5xx, unknown and timeout outcomes. This is the point when our finish call returns or its transport timeout is reported, rather than when the customer clicks Book or when booking/form is created.

Our local implementation records the full 180-second window from that completion time. It persists a provisional deadline before sending finish for crash recovery, then resets the deadline when finish completes without overwriting a concurrent final status. This local deadline does not override the supplier's final outcome or prove that no reservation exists. Supplier production-key configuration is confirmed by RateHawk; this document does not claim to have changed that key.

The three previously supplied Sandbox scenarios are marked Done in the second update and have not been repeated. For evidence accuracy, the earlier `unknown_book_limit` scenario remained unresolved inside the initial 180-second runner window; a read-only check of the same partner order later received book_limit at approximately 306 seconds. That historical qualification is retained; it is not a new booking or a reason to repeat the accepted tests.

## Page 15: booking details and order/info

Initial confirmation continues to come from finish/status. Customer account history is read from our saved booking records. Current booking details and cancellation penalties use a minimal, trusted snapshot of the selected prebook response saved before payment; browser-supplied cancellation fields are ignored. The snapshot survives removal of encrypted guest details after confirmation. Its supplier amount and currency remain separate from the customer's charged amount.

The supplier `/order/info/` request is now confined to the explicitly authenticated, server-to-server history route. Its history intent is set by the route, not by a flag from the request body. Both raw history retrieval and the single-order aliases share the same local guard: known in-flight bookings are held, and successful bookings are held for at least 30 seconds after their persisted confirmation time. A missing trustworthy confirmation time or an unavailable database fails closed. An unfiltered account-history request is conservatively held if any matching local booking is still in that protected period; an explicitly filtered request is scoped to its requested IDs. A history response does not change a final booking status.

Cancellation quotes and submissions no longer call order/info. A successful cancel response is final and does not cause a second cancel or a supplier-history check, including when optional financial totals are absent; missing or malformed totals are not invented. An ambiguous cancel remains pending for manual reconciliation, without a repeated cancellation, an invented success/failure or a refund based solely on that ambiguity. Background checks read only local saved state. The optional Midoffice receipt worker also uses locally verified outcomes and operator review instead of calling order/info as a status/reconciliation endpoint.

Older bookings without a verified prebook snapshot do not receive guessed policy or automatic cancellation terms; they require support review. This preserves their booking/payment state rather than attempting an undocumented supplier read or reconstructing financial terms from client input.

## Focused offline verification

Credential-free fixtures cover internal-only history intent and authenticated routing, raw/alias history guards, missing timestamps/database failure, trusted snapshot persistence, zero penalties and supplier currency, UTC penalty boundaries, single-shot successful cancellation, ambiguous cancellation without history calls, and optional webhook behavior. Existing finish/status, 180-second deadline/race and late-reconciliation fixtures are retained. No new supplier booking, payment, cancellation or status request was performed for this second-update implementation.

Focused result: **103 passed, zero failed, zero skipped**, using `node --test --test-reporter=tap test-ratehawk-booking-history.js test-ratehawk-offer-context.js test-booking-safety.js test-checkout-process.js test-checkout-cancellation.js` in a child process with application credentials removed, `CI=true` and `NODE_ENV=test`. Log: `logs/second-update-backend-focused.log`. This is offline fixture evidence, not a fresh supplier scenario or proof of deployment.
