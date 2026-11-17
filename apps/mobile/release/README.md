# Mkhadda Android release preparation

Prepared: **17 November 2026**. These are developer preparation documents, not a submitted Play declaration or evidence of an approved release.

Owner-approved app title, exactly in both locales: **مخدّة | Mkhadda**. Brand: **Mkhadda**; operator and website/support identity: **Remal Tourism**. The planned, configured production package is `com.remalbookings.app`; first-AAB/Play assignment remains unverified. The application's Play Console dashboard was independently observed after creation on 16 November 2026. The application remains an unpublished draft.

## Current evidence

- Play Console was inspected on 16 November: organization identity and both phone numbers were verified. The owner then reviewed the three creation declarations and created **مخدّة | Mkhadda**. Its application dashboard was observed. No binary has been uploaded, no public release is claimed, and no Cloud project was created. Draft creation does not establish app approval or release readiness.
- A native Expo/React Native foundation is being developed. This is not a website-wrapper release.
- A local ARM64 staging APK was built without an Expo account or cloud build: Gradle attempt 5 succeeded in 19m 41s / 824 tasks. It uses portable JDK 17, SDK/build tools 37, NDK 27.1.12297006, SDK CMake 3.31.6, official Ninja 1.13.2 and Gradle 9.4.1. The short tool-drive alias/native staging recipe retained the original SDK binaries; the alias was removed after verification.
- Independent verification confirmed `com.remalbookings.app.preview`, SDK 24/36/37, bundled JavaScript, ARM64-only native libraries and the Expo template debug signer. The APK is 34,518,122 bytes; SHA-256 `1ffa011a3ac98960e62a180df417d67258e603e39d698089ec0903ff1db5ec45`. Its observed frozen source is `18163f977848983712085364e6d1ccdd511ad7d0`. The wrapper failed on the modern signer-output format after Gradle success; the independent receipt explicitly leaves automatic source-fingerprint validation unverified. No full corrected-wrapper run is claimed.
- Local ZIP/ELF 16 KiB alignment and conservative RELRO checks passed for all 24 ARM64 libraries / 73 PT_LOAD segments. All six native incremental Ninja dry-runs passed without metadata changes. Android installation/device runtime, 16 KiB device compatibility, a production-signed AAB, company signing identity, internal-track installation and Play pre-launch review remain pending.
- Confirm the planned production package and its first-AAB/Console assignment before upload; package names are unique and permanent. No company upload key or production AAB has been generated. The current APK uses a test-only template debug key.
- Backend functionality and web tests do not establish native app correctness. All release targets below remain unmeasured until evidence is attached.

## Play requirements checked against official sources

| Gate | Required preparation | Current status |
| --- | --- | --- |
| Target API | New phone apps and updates must target Android 16/API 36 or higher from 31 August 2026; the announced extension ended 1 November 2026. Verify the final AAB, not just configuration. [Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878) | Staging APK target API 36 verified; production AAB pending |
| AAB and signing | Produce an upload-key-signed Android App Bundle and use Play App Signing for the new app. Keep private keys and credentials out of Git. [App signing](https://developer.android.com/studio/publish/app-signing), [app setup/package permanence](https://support.google.com/googleplay/android-developer/answer/9859152) | Not generated or uploaded |
| Native compatibility | Check all native libraries, including framework/SDK dependencies, on 16 KB devices. Current Android guidance requires API 35+ 64-bit compatibility and states update enforcement from 1 February 2027; verify app-specific Console requirements. [16 KB guidance](https://developer.android.com/guide/practices/page-sizes) | Local ZIP/ELF/RELRO alignment checks pass; 16 KB device runtime unverified |
| Developer verification | Confirm organization identity and package registration. Regional protections began 30 September 2026 in Brazil, Indonesia, Singapore and Thailand; Play handles most registrations automatically. [Developer verification](https://developer.android.com/developer-verification) | Organization identity and phone verification observed complete; package/app checks pending |
| Account deletion | Account creation requires a discoverable in-app deletion-request path and an external web resource. Delete associated data, subject to clearly disclosed legitimate retention. Logout, suspension and document expiry alone do not meet this requirement. [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) | No account-deletion API/UI/web request path found in audited backend/web baseline |
| Privacy and Data Safety | Supply an accurate privacy policy and Data Safety form covering the actual native app, SDKs and relevant server transfers. Review the separate data map; it is not a completed declaration. [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469) | Inventory draft only |
| Review access | Provide maintained, reusable English review instructions and access to every restricted function, irrespective of reviewer location. Use an authorized, pre-approved review account; do not require genuine reviewer identity-document submission or expiring OTPs. [Review access](https://support.google.com/googleplay/android-developer/answer/15748846) | Review account/instructions not verified |
| Billing | The physical-services exception supports ordinary hotel-stay payments outside Play Billing. This is an application of the policy to accommodation, not approval of a particular implementation. Separately reassess any future paid digital membership/app feature. [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) | Hosted payment/native return flow still requires testing |
| Listing and app content | Complete the Console's applicable content-rating, audience, ads, privacy and other app-content forms. Use truthful screenshots/contact information. Title limit: 30 characters. No ranking/promotional claims in title, icon or developer name. [Metadata policy](https://support.google.com/googleplay/android-developer/answer/9898842), [listing setup](https://support.google.com/googleplay/android-developer/answer/9859152) | Unsubmitted drafts only |
| Testing access | The mandatory 12 continuously opted-in testers/14 days requirement is stated for qualifying new **personal** accounts. Do not automatically apply it to this organization account; follow its actual Console gates. [Personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465) | Console requirements unverified |

## Play Console is not a Google Cloud project

The Play Console app is the store/release record tied to the package name and signing identity. Creating it does not require creating a Google Cloud project or enabling Cloud billing.

The Expo project/build service is another separate system. Google/Firebase configuration may become relevant if the product chooses Google authentication, Firebase services or a native Maps SDK. Billing depends on the selected service and plan; those choices do not all automatically require paid Cloud billing. Existing backend Google Places use is a separate integration and does not require a second Cloud project merely because an Android app is added.

Do not create projects, enable billing, register OAuth clients, generate credentials or submit a release from this document.

## Repository gaps and release gates

1. Implement and verify the complete native search, room selection, review, payment return, booking status and supported account journeys. Do not count web Lighthouse results as native performance evidence.
2. Verify the implemented environment-separated native SecureStore adapter on an Android device. The foundation's automated tests cover expiry, logout/revocation and asynchronous session races; app restart and native storage behavior still require device evidence. The web preview deliberately keeps credentials in memory.
3. Define the global product scope. Current backend membership eligibility is UAE/GCC oriented. Either retain and clearly disclose those restrictions or implement an explicitly authorized global journey. Global store availability does not prove global booking eligibility or inventory.
4. Implement account-deletion requests, ownership checks, session revocation, associated-data handling and a public branded web request resource. Preserve any legitimately retained booking/accounting records only under an approved, disclosed retention policy.
5. Finalize privacy/Data Safety against the actual shipped SDKs, permissions, backend behavior and providers. Government-ID uploads are sensitive; request only the access required by the delivered journey.
6. Verify server-confirmed booking outcomes after redirect, app termination, network loss and retry. A successful payment redirect must not be displayed as a confirmed reservation by itself.
7. Attach Android device/emulator evidence for RTL/LTR, TalkBack, large text, back navigation, offline/recovery, secure payment return, and 16 KB compatibility. Test both expected success and failure states with isolated sandbox services.
8. Confirm the proposed package, store identity, signing arrangements, review access, public policy/deletion links and supported countries in Console. Generate listing screenshots only from the verified native build.
9. Meet the acceptance targets in `acceptance-targets.json`, or record a clearly approved exception. None currently represents an achieved result.

## Files

- `store-listing.json`: English/Arabic drafts, character limits and feature-claim gates. Not ready for submission until every claim is verified in the release binary.
- `data-safety-map.json`: source-backed data inventory and unresolved declaration questions. Not a Data Safety submission.
- `acceptance-targets.json`: proposed quality, funnel, performance and operational targets with null results.

These files do not create a Cloud project, change billing, generate signing keys or build an AAB. The separate owner-completed Console draft creation is recorded above.

## Preparation validation

- All three JSON documents parse. Listing character counts are English **15 / 64 / 1112** and Arabic **15 / 52 / 870** for title / short description / full description, within **30 / 80 / 4000**. Both titles preserve the exact owner-approved Arabic-first string and shadda.
- Every metric result is null; no target is recorded as an achieved native measurement.
- TypeScript, ESLint and all 30 unit tests pass for the current foundation. Expo diagnostics passed 20/20 checks, and Android Hermes JavaScript/assets and web exports succeeded. These source checks and exports are not Android binary/device evidence.
- Separate native artifact evidence is recorded in `.test-output/android-preview/build-receipt.json`, the matching `apk-alignment-1ffa011a3ac9-1794901486171/alignment-report.json` directory, and `ninja-incremental-alias-short-flag-report.json`. These are private local QA outputs, not a submitted Play review or device test. The APK's source attribution remains `18163f9` after later documentation/helper changes.
- Browser QA and an actual read-only staging-client integration check cover the implemented search/detail and session journeys. Neither establishes a native booking/payment flow or release approval. No Play release was uploaded or submitted.
