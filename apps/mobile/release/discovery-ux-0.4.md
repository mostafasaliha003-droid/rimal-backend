# Discovery and room-choice improvements — 0.4.0

This phase improves native search, hotel selection and room review while retaining Remal's logo, palette, Tajawal fonts and Arabic/English layouts. It does not establish a worldwide ranking, conversion uplift, native-device performance or completed Play readiness.

## Measured baseline

The immutable source baseline is `f70cc0ff39a8745aad559885f5c222cd5bf85a83` (0.3.0). Browser fixtures covered Arabic/English at 390×950 and 1440×950 pixels: 40 captures, 20 visually inspected PNGs, zero horizontal overflow and no page errors. A fixed-date search through selected-room review used 12 pointer actions plus one explicit mocked price recheck, three required input groups and four journey stages. Three calendar-month advances are included. This is not a payment-completion journey or a measurement of a competitor's native app.

Observed problems: the mobile search action was below the initial viewport; hotel content extended roughly 16–17 thousand pixels with eight initially expanded offers and full policy cards; the review price appeared below the first viewport. The filter sheet changed applied choices before its Apply action, had no name/budget/multi-star controls, and its web checked states/dialog name were incomplete. Some sampled header, favourite and calendar controls were under the 48-dp native target. Native TalkBack, text scaling on a real phone and Core Web Vitals were not measured.

## Implemented behavior

- The compact search form gives priority to destination, dates, occupancy, residence and currency. Explicit local-calendar shortcuts select tonight, tomorrow or a two-night stay next week. Up to four validated recent searches stay in RAM for the current authentication session; restoring one fills the form without submitting it. Guest arrays are copied and no signed offers or credentials enter this history.
- Results support a hotel-name query, several star classifications and an exact customer-total budget in the search currency, including Arabic/Persian digits. Draft, Apply, Cancel and Reset have separate behavior. Counts describe the loaded result set. Unknown prices remain unknown; no exchange rate, nightly division or tax-inclusive total is invented.
- Refresh keeps prior cards only for the same search, language and authentication revision, with explicit refreshing/previous-price status. A denied account or changed context cannot inherit them. Saving or selecting a comparison does not initiate another regular hotel search.
- Up to three same-search hotels can be compared using their supplied names, addresses, star classifications, photos and customer prices. Comparison snapshots contain no rate capabilities or account/guest/payment identity, remain in RAM and reset on search/session/language changes. Captured prices hide after a five-minute local display period; this is not a supplier availability guarantee.
- The hotel page puts room choice ahead of lengthy property information, with jump navigation and a bottom action area. Its gallery mounts one supplied image at a time. Exact room classifications group rate options without losing any original occurrence; unknown classifications remain separate. Room-name and exact supplied meal filters intersect, and price sorting compares one requested currency. Every rate retains its original price, taxes, policy and signed capability when selected. All property descriptions, amenities and populated policy fields remain accessible.
- Review shows the selected customer price early and keeps the current action visible. A changed offer explains price, meal, tax and cancellation differences, including changes with an unchanged price. Existing explicit acceptance, owner/search invalidation, expiry and website handoff gates remain in force. A price check does not reserve a room.

All source checks and fixture results must be associated with their actual source and artifact. Screenshots are development fixtures, not live price advertisements or Play screenshots. APK verification and device testing are separate evidence.

## Priorities and measured comparison

The ordering used estimated conversion impact × implementation ease, each 1–5. These are engineering prioritization judgments, not measured conversion gains: prominent search/review actions 5×5=25; price/term clarity and initial-currency guard 5×4=20; reversible decision filters 4×4=16; lossless room grouping/navigation 4×3=12; session-only hotel comparison/recent queries 3×3=9. Access names, states and control targets were checked throughout each change.

The same synthetic stay, dates, occupancy and four browser viewports were used before and after. RC measurements below precede final semantic-only changes: natural formatted price/room-group/search/trip-header names, language-switch names including visible text, and comparison/filter/recent-reset names that include their displayed labels. The final exported bundle receives a separate bounded semantic/layout check. Browser CSS pixels are not native Android dp or field-performance measurements.

| Observable | Baseline 0.3.0 | 0.4.0 RC | Interpretation |
| --- | --- | --- | --- |
| Search action fully visible at 390×950, AR/EN | No | Yes; bottom 738 px | Form action is available without initial scrolling |
| Review price and primary recheck action in first viewport | No | Yes; price top 301–326 px, action bottom 906 px | Price and next step are visible earlier |
| Hotel initial content height, EN 390 | 16,895 px | 10,098 px collapsed; 13,652 px with first group expanded | Progressive disclosure; all original rate variants remain reachable |
| Hotel initial content height, AR 390 | 16,865 px | 10,068 px collapsed; 13,622 px with first group expanded | Same disclosure tradeoff in RTL |
| Hotel initial content height, 1440 | 16,176 px | 9,617 px collapsed; 12,931 px with first group expanded | About 40% less initial rendered height, not loading-speed evidence |
| Pointer actions through selected-room review | 12 | 13 | One extra room-group disclosure; no tap-reduction claim |
| Explicit price-recheck actions | 1 | 1 | Retains deliberate supplier check |
| Input groups / journey stages | 3 / 4 | 3 / 4 | Destination, dates, occupancy; payment completion excluded |
| Results columns at 390 / 1440 | 1 / 1 | 1 / 2 | Wide screens use available space; native large-text branch needs a device |
| Local name / multi-star / customer-total budget filters | Absent | Present; Apply/Cancel/Reset | Counts apply to returned hotels, not the entire supplier catalogue |
| Same-search comparison / session recent searches | Absent / absent | Up to 3 / up to 4 | RAM only; no new account identity, storage or analytics |
| Total review content height, EN / AR 390 | 2,471 / 2,366 px | 2,501 / 2,396 px | Total review content is slightly longer; first-view clarity is the benefit |
| Horizontal overflow in sampled states | 0 | 0 | Does not prove every device or text size |
| Lighthouse, LCP, INP, CLS, native screen-reader conformance | Not measured | Not measured | No fabricated score, complete WCAG AA claim or native performance claim |

The frozen baseline has 40 captures (20 inspected). The functional RC checks comprise 76 search/review/header/picker assertions and 116 results/comparison assertions across AR/EN 390/1440 profiles. Hotel fixtures separately verify all rate occurrences, original selection identity, currency mismatch recovery, gallery reachability and fresh section positions after expansion. These are mocked browser checks; no real booking, payment or deletion action was executed. Private raw evidence and export manifests stay outside the public repository.

## Final verification and artifact

The final frozen RC3 entry is `8fbf9cd9a88f764836e654bf61af70e9`. Bounded checks cover the semantic-only changes: **36 search/review/picker states** and **24 results/filter/comparison states** were scanned using all six axe tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`), with **zero reported violations**. Results/comparison also passed 32 bounded assertions, including actual unchecked/checked accessibility names/states and active filter values. Search/review checked all four natural form-control names, recent-query/reset labels, named pickers, header targets, natural formatted prices and visible primary actions. Its final semantic fixture setup used programmatic query input after two keyboard/modal harness traces failed to enter the full query; those traces were retained and no new RC3 typing/journey pass is claimed. The earlier 76 functional checks are reported separately.

Hotel RC2 had **72 all-six-tag scans**, zero reported violations, eight room headers checked collapsed/expanded, all 18 original rate occurrences retained, and 12 actual section-jump geometries checked after expansion. RC3's Hotel route bytes are identical (SHA-256 `ff5cf9ac168e63767665166ed266c5c746326e63c6f3968627c2c847ff0861ae`); the Primitives and BrandHeader module definitions also match exactly. The complete common bundle changed because unrelated Results-card semantics changed, so no whole-common equality is claimed. Earlier larger fixtures also retained all 27 rate occurrences, including duplicate hashes and separate unknown room classifications.

Axe incomplete results remain documented, including symbol-only contrast/name checks and the React Native Web image wrapper's generic-element `aria-label`. Meaningful symbolic-control names and child-image alternatives were inspected, but incomplete results are not counted as passing rules. This is not complete WCAG 2.2 AA, native TalkBack or actual Android text-scaling certification. Fixture screenshots are not native store captures. All owned browsers and the temporary preview server were closed after QA.

The local Android builder completed with exit 0 from **clean `b08f0815d091c672824403e6b17b9fce2485296d`**. The automatic before/after source guard passed for **109 unchanged files**, fingerprint `75870d17b87bab47c07cee5224c1aab2836d7da1a76fd7aefb2c653ab31fc807`. Gradle reported **5m 52s / 824 tasks: 46 executed, 778 up-to-date**. The APK is **34,639,686 bytes**, SHA-256 `6dfe2786343de3eba8dda7699a8d103565eeb12be7289e3d123f2c9b8f048167`. Compiled version 0.4.0/code 4, staging identity `com.remalbookings.app.preview`, SDK 24/36/37, bundled JavaScript, ARM64 and the actual installed-template test signature were verified. Independent ZIP/ELF 16 KiB alignment and conservative RELRO checks passed for **24 libraries / 73 load segments / 24 RELRO ranges**, with zero failures/unverified ranges and unchanged APK bytes. No device installation or performance result follows from this binary inspection.

Draft [PR #23](https://github.com/mostafasaliha003-droid/rimal-backend/pull/23) is stacked on the existing app foundation branch. The GitHub `mobile` check for `b08f081` did not start because the account is locked for billing; no billing setting was changed and no CI pass is claimed. The API client/auth modules, booking/deletion screens and review-session controller are unchanged from the previously approved 0.3.0 staging probe; that historical real-client result is not presented as a fresh 0.4.0 integration run. Later evidence-only documentation commits do not change the compiled commit or original receipt.

## Competitor and design references

The official developer listings advertise relevant capabilities: [Agoda](https://play.google.com/store/apps/details?hl=en_US&id=com.agoda.mobile.consumer) describes hotel filters, photos, maps and booking management; [Booking.com](https://play.google.com/store/apps/details?hl=en&id=com.booking) describes filters, favourites/comparison and booking management; [Trip.com](https://play.google.com/store/apps/details?hl=en&id=ctrip.english) describes hotel search and servicing. These are capability references captured on 17 November 2026, not observed native tap counts or proof that Mkhadda outperforms them. Geographic, account and platform differences apply.

The work applies search prominence, decision filters and price clarity discussed in [Baymard's accommodation research](https://baymard.com/research-articles/travel-accommodations-ux-benchmark-2026), recovery and user control from [Nielsen's heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), and meaningful targets/names/states from [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps). [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [WCAG2ICT](https://www.w3.org/TR/wcag2ict/) inform evaluation; fixture checks do not establish complete conformance.

## Three proposed conversion experiments

These are proposals, not running experiments or demonstrated gains. Assignment, consent/privacy review, event definitions, sample size and stopping rules must precede real-user analytics.

1. Compare the compact first-search layout with the existing expanded introduction. Primary outcome: valid result searches per search-screen visit. Guardrails: invalid dates/occupancy, residence changes, accidental submissions and completion time. Evaluate the same stay criteria in usability tests.
2. Compare inline shortlist controls with a less prominent comparison entry. Primary outcome: result visits reaching a selected-room review. Guardrails: time to choose, empty-filter recovery, price-change errors and actual booking completion. Do not count opening the comparison as a booking conversion.
3. Compare the persistent review action/price summary with the former bottom-only action. Primary outcome: successful explicit price rechecks per room review. Guardrails: changed-term acceptance comprehension, stale-offer failures, backtracking and payment/booking outcomes. Native checkout remains a website handoff in this phase.

## Remaining product gates

Global consumer eligibility, production supplier activation, complete native checkout/payment return, actual booking support operations, approved retention/deletion fulfillment and accurate privacy/Data Safety disclosures remain separate work. Physical-device evidence is needed for TalkBack, large text, back navigation, secure storage and payment return. Production signing, an AAB and Play review are still required before a store release. The owner has deferred phone testing and confirmed supplier production is not activated; do not infer global availability or completed account deletion from this UI phase.
