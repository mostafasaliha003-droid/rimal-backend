# مخدّة | Mkhadda

Native Android application foundation operated by **Remal Tourism**, using the existing booking backend. This project uses Expo SDK 58, React Native 0.88 and Expo Router. It renders native application components rather than displaying the website in a WebView.

The owner-approved store name is **مخدّة | Mkhadda**. The planned, configured production package is `com.remalbookings.app`; its first-AAB/Play assignment is not yet verified. The isolated development package is `com.remalbookings.app.preview`. Play Console's application dashboard was observed after the owner completed phone verification and created the unpublished draft. A staging test APK is available; no Play upload or public release is claimed.

## Source repository

The mobile app lives in `apps/mobile` within the existing [Remal Bookings repository](https://github.com/mostafasaliha003-droid/rimal-backend), as selected by the owner. Its dependencies, build profiles and checks are scoped to this directory. The mobile workflow runs for changes here without deploying the website or submitting a Play release. Local environment files, signing credentials, Android binaries and private QA artifacts remain excluded from source control.

## Current scope

- Arabic/English layouts with the company's existing colors, Tajawal fonts and operator logo; Mkhadda is the product wordmark.
- Destination suggestions, calendar dates, occupancy/child ages, residence and supplier price currency.
- Hotel results, local sorting/filtering/paging, saved hotel IDs and static/live hotel details.
- Only server-supplied customer prices; tax amounts retain their own currencies and explicit inclusion status. Full `rg_ext` matching supplies room photographs.
- The certification policy formatter is retained, including all populated nested fields, zero/false, safe supplier text and isolated Arabic numeric ranges.
- Native authentication credentials use environment-separated SecureStore; web-preview credentials remain in memory. Expired sessions and membership-approval denials are distinct states.
- Owner-authenticated account-deletion request intake with a pending reference and fixed website alternative. It explicitly leaves the account, data and bookings unchanged; actual erasure and retention fulfillment remain a release gate. See [privacy request scope](release/privacy-requests.md).
- A memory-only room review shows the selected stay, authoritative price, taxes and UTC cancellation terms. Price checks are explicit; updated price/terms require acceptance. Selection or account changes invalidate old results before a handoff can proceed. The five-minute selection and two-minute checked-view limits are local presentation limits, not supplier guarantees.
- The signed-in booking history reads the server's owner-scoped records and preserves unknown or conflicting states. It never treats an `active` record alone as a confirmed stay or fabricates a price.
- Booking, payment and booking management continue on the explicitly identified Remal website. The handoff contains validated search context only, without access tokens, signed offers, guest identity or payment credentials. A room must be selected/rechecked there; the application does not claim to complete a native booking.

The default environment is **staging** and displays a development banner. Production endpoints require the explicit `EXPO_PUBLIC_API_ENV=production` build selection. Supplier, merchant, SMTP, signing and private API keys must never enter this application or public environment variables.

## Local checks and preview

Use Node.js 24 LTS and the committed lockfile:

```sh
cd apps/mobile
npm ci
npm run test:unit
npm run test:build
npm run typecheck
npm run lint
npx expo-doctor
npm run export:preview
npm run preview:web
```

The browser preview runs at `http://127.0.0.1:5173`. It is a development review surface, not proof of Android device performance, secure-store hardware behavior, a signed APK/AAB or Play acceptance. The preview server exposes only exported public files and binds to loopback.

`npm run export:android` compiles Android JavaScript/Hermes and assets. It does **not** create a signed Android App Bundle. The CNG config requests compile SDK 37 / target API 36 / minimum API 24; verify these in the actual release binary before submission.

Expo-compatible dependencies are installed with `npx expo install`. A narrowly scoped `@expo/fingerprint` override selects patched `minimatch` 11.0.1 instead of downgrading the Expo framework. The actual fingerprint-generation command, project diagnostics and bundler were exercised after the override. Revisit the override when upstream updates its dependency.

## Local Android builds

The **0.3.0 / version code 3** staging APK completed the full local builder on 17 November 2026 with exit 0, from clean source `1f723f96649acf25c5bd71b4f983ac729334be2d`. It adds the authenticated request-only privacy flow described above. The APK is **34,570,522 bytes**, SHA-256 `da394294b04f5786c0fd439e18756f6c4c6afa4c555d7a6a226631eb285a392a`. The automatic before/after source guard passed for **92 files**, unchanged fingerprint `866b5ed4f7815cc7bd235fc28182d7b1922f87009a74ca526ad88bd99576ae2d`. Gradle completed in **30m 35s**, with all **824 tasks executed** in a fresh isolated worktree after Windows blocked replacement of the older dependencies. This duration is build time, not application performance.

The verified binary has the preview package, version 0.3.0/code 3, SDK 24/36/37, bundled JavaScript, ARM64 libraries and the actual installed-template test signature. Independent 16 KiB ZIP/ELF alignment and conservative RELRO checks passed for all **24 libraries / 73 load segments / 24 RELRO ranges**, with zero failures or unverified results. It requires neither Metro nor an Expo cloud build account. Source checks passed **59 app tests, eight build-checkpoint tests, TypeScript, ESLint and 20/20 Expo diagnostics** on Expo 58.0.26 / Router 58.0.32 / Web Browser 58.1.0. Four AR/EN browser profiles passed **56 behavior checks**, with 12 screenshots inspected. Browser fixtures and binary checks do not establish Android-device behavior, completed data erasure or Play release readiness. The separate authenticated 0.3 staging-client probe has not run. See [privacy request scope](release/privacy-requests.md).

The owner selected **local Android builds without an Expo account or Expo cloud build service**. Keep Expo SDK 58 and Continuous Native Generation (CNG): Expo config and config plugins generate the Android project, then the standard Android SDK/JDK/Gradle toolchain compiles it. EAS is an optional alternative; the existing `eas.json` profiles do not make an EAS account, login or cloud build a prerequisite. See Expo's [local development](https://docs.expo.dev/guides/local-app-development/) and [local production builds](https://docs.expo.dev/guides/local-app-production/) guidance.

The installed Expo 58.0.26 / React Native 0.88.1 sources currently select the following toolchain. Recheck these pins after dependency changes rather than upgrading individual build tools independently.

| Component | Local build requirement |
| --- | --- |
| Java | JDK 17 |
| Gradle / Android Gradle Plugin | Gradle 9.4.1 / AGP 9.2.1 |
| Android platform | `platforms;android-37.0` for compile SDK 37; target API 36, minimum API 24 |
| Android Build Tools | `build-tools;37.0.0` |
| Android NDK | `ndk;27.1.12297006` |
| CMake / Ninja | Official SDK CMake 3.31.6 via `-Pandroid.cmakeVersion=3.31.6`; select separately verified official Ninja 1.13.2 with `--ninja` |

The pins come from `node_modules/react-native/gradle/libs.versions.toml`, the installed React Native Gradle wrapper, and the Android project in `node_modules/expo/template.tgz`. Expo's installed autolinking plugin supports the `android.cmakeVersion` override and documents the Windows limitation. [AGP 9.2's compatibility table](https://developer.android.com/build/releases/agp-9-2-0-release-notes) confirms JDK 17, Gradle 9.4.1 and maximum API 37.0. The app's explicit NDK pin takes precedence over AGP's default NDK.

This Windows host has long paths disabled. The verified build recipe uses a temporary short tool-drive alias, a short persistent native staging root and official Ninja 1.13.2 through the guarded CNG plugin. It leaves the SDK binaries and generated native sources unmodified. Version selection alone did not resolve the path failures; retain the short paths when repeating this recipe. See [Reanimated's Windows guidance](https://docs.swmansion.com/react-native-reanimated/docs/guides/building-on-windows/).

The local preparation uses portable JDK 17, SDK command-line tools 22 and Gradle 9.4.1 under the workspace cache (`.cache/a`); these are local tools, not application source. Set process-scoped `JAVA_HOME`, `ANDROID_HOME` and `GRADLE_USER_HOME` to the prepared locations. If `ANDROID_SDK_ROOT` is also set, keep it equal to `ANDROID_HOME`. Install the selected SDK packages and accept their licenses using the official [SDK manager](https://developer.android.com/tools/sdkmanager). No Android Studio, emulator or Expo login is required merely to assemble an APK. The first build still needs public SDK/Gradle/Maven dependencies unless they are already cached.

For SDK metadata, use Google's [schema 3 repository](https://dl.google.com/android/repository/repository2-3.xml): the stable API 37 package is named `platforms;android-37.0`, not `platforms;android-37`. Command-line tools 22 contains schema 3 support. Do not rename installed platform directories or fabricate package metadata to work around an older package listing.

Use the local Node builder from `apps/mobile`; it does not require PowerShell script execution or a policy change:

```powershell
subst T: "C:\path\to\workspace\.cache\a"
node scripts/build-android-preview.cjs --sdk "T:\s" --jdk "T:\j\jdk-17.0.21+9" --gradle-cache "T:\g" --ninja "T:\ninja\ninja.exe" --native-staging-root "T:\x" --windows-trust --output ".test-output/android-preview-0.2.0"
# After all native/build processes finish:
subst T: /d
```

Use an unused drive letter and the prepared workspace/JDK locations. On this host the alias is visible in the elevated build context; use the same context for mapping, building and cleanup. Removing the alias leaves physical files intact. `--windows-trust` uses the Windows root certificate store for Java downloads when the local network requires it. The command above selects the current artifact directory, `.test-output/android-preview-0.2.0`; without `--output`, the helper defaults to `.test-output/android-preview`.

The optional `--native-staging-root` option is selected in the verified Windows recipe. It sets `MKHADDA_NATIVE_STAGING_ROOT`, and the CNG plugin assigns each Android module a unique short directory through the supported top-level [`externalNativeBuild.cmake.buildStagingDirectory`](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/dsl/Cmake) property. The callbacks register before the root plugins evaluate child projects. Use a persistent location outside module `build/` directories. The option also requests `-Pexpo.android.cmakeObjectPathMax=240`; it remains inactive when omitted.

The builder sets staging, runs the installed Expo CLI's `prebuild --platform android --no-install --no-clean`, then invokes `:app:assembleRelease` directly through Java. SDK 58 prebuild otherwise cleans native folders by default. Every attempt has its own directory: the source fingerprint is saved before prebuild, and the candidate APK plus matching post-build fingerprint are checkpointed immediately after Gradle succeeds. The prior verified APK/receipt are retained if compilation or artifact verification fails. Only successful source, metadata, signature and candidate-hash checks permit publication. Gradle/Metro workers and memory are bounded; Java/Kotlin release minification is disabled for this test artifact.

An eligible checkpoint can be verified again without prebuild, Gradle or a new source attribution:

```powershell
node scripts/build-android-preview.cjs --sdk "C:\path\to\sdk" --jdk "C:\path\to\jdk17" --verify-only ".test-output\android-preview-0.2.0\attempts\ATTEMPT_ID\checkpoint.json"
```

This checks the preserved bytes and the actual installed template certificate. Missing, changed or source-mismatched checkpoints fail closed. It cannot supply missing source-fingerprint evidence for an older independent receipt.

The verification-only path was exercised successfully on the preserved 0.2.0 attempt after a documentation commit and after the temporary drive alias was removed. It completed with exit 0 without prebuild or Gradle, retained compiled source `9b85073`, and produced the identical APK hash. The original build-and-verify receipt was preserved separately.

Keep the staging environment selected during both native generation and the Gradle JavaScript bundle step. This selects `com.remalbookings.app.preview` and the staging API. An ARM64-only build targets compatible physical phones; it is not a universal emulator/device build. Expo's generated release variant runs `export:embed` to include JavaScript/Hermes and assets, so the installed app does not require Metro. See the [Expo CLI Android compilation options](https://docs.expo.dev/more/expo-cli/#compiling-android).

On **17 November 2026**, the **0.2.0 / version code 2** local build completed successfully, including the full builder verification (**exit 0**). Gradle completed in **3m 28s**, with **824 tasks: 46 executed, 778 up-to-date**. The APK at `.test-output/android-preview-0.2.0/mkhadda-preview.apk` is **34,548,694 bytes**, SHA-256 `03dd229521dfc787cc14014b2239e32e1ab926a69bedafe414eb08f3523d594b`.

The schema-2 receipt at `.test-output/android-preview-0.2.0/build-receipt.json` binds the candidate to clean source **`9b85073a5bbfd5884e497618926406352cf4486f`**. Its automatic before/after fingerprint guard passed: **88 files**, unchanged SHA-256 `b35a0ee093bbf7b393f5db7b1c48a7bab269ffe84045bfc585dfe75e12ff6a07`. Independent checks also confirmed the preview package, SDK **24/36/37**, permissions, ARM64-only native libraries, bundled JavaScript and the actual installed Expo template certificate. This is a **test-only debug signature**, even though Gradle used a release variant. Later documentation commits or verification retries do not change the recorded APK source. The archived 0.1 receipt for source `18163f9` remains an independent verification without build-time fingerprint proof.

Independent compatibility checks for this APK passed: `zipalign -c -P 16 -v 4`, all **24 ARM64 libraries / 73 PT_LOAD segments** for 16 KiB alignment, and **24 conservative RELRO checks**, with no failures or unknown results. Earlier Windows toolchain QA also passed all six native incremental Ninja dry-runs without metadata changes. Current source validation passed **54 app tests, eight build-checkpoint tests, TypeScript, ESLint and 20/20 Expo diagnostics**; browser fixtures passed **40 assertions** and the actual staging client passed **six integration requests**. These checks establish source, artifact and integration properties. Device installation, 16 KiB device testing, native journey testing, a production-signed AAB and Play review remain pending.

Production signing and Play submission are separate, later steps requiring the company's protected upload key/Play App Signing setup, a signed AAB, device testing and release review. Do not generate or commit signing keys as part of staging preparation. See [Android release signing](https://reactnative.dev/docs/signed-apk-android). Do not invent an Expo project ID, signing fingerprint or verified App Link association.

`android/` and `ios/` are CNG output and remain ignored. Never create or hand-edit them, even after generation; make persistent native changes in `app.config.ts` and config plugins, then regenerate through Expo. Review any regeneration command before it replaces local output. See [Expo SDK 58 build properties](https://docs.expo.dev/versions/v58.0.0/sdk/build-properties/).

Production checkout remains gated by actual supplier certification and merchant readiness. A consumer worldwide journey also needs an explicit backend path separate from the existing membership eligibility program, a complete account-deletion flow and accurate privacy/Data Safety disclosures. See [release preparation](release/README.md) and its source-backed inventory and unmeasured acceptance targets.

The store listing files are drafts. Browser-fixture QA screenshots are clearly labeled development evidence and must not be presented as native release screenshots or live supplier prices.
