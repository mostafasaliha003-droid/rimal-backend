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
- Booking, payment, status/history and support continue on the explicitly identified Remal website. The handoff contains validated search context only, without access tokens, signed offers, guest identity or payment credentials. A room must be selected/rechecked there; the application does not claim to complete a native booking.

The default environment is **staging** and displays a development banner. Production endpoints require the explicit `EXPO_PUBLIC_API_ENV=production` build selection. Supplier, merchant, SMTP, signing and private API keys must never enter this application or public environment variables.

## Local checks and preview

Use Node.js 24 LTS and the committed lockfile:

```sh
cd apps/mobile
npm ci
npm run test:unit
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

The owner selected **local Android builds without an Expo account or Expo cloud build service**. Keep Expo SDK 58 and Continuous Native Generation (CNG): Expo config and config plugins generate the Android project, then the standard Android SDK/JDK/Gradle toolchain compiles it. EAS is an optional alternative; the existing `eas.json` profiles do not make an EAS account, login or cloud build a prerequisite. See Expo's [local development](https://docs.expo.dev/guides/local-app-development/) and [local production builds](https://docs.expo.dev/guides/local-app-production/) guidance.

The installed Expo 58.0.25 / React Native 0.88.1 sources currently select the following toolchain. Recheck these pins after dependency changes rather than upgrading individual build tools independently.

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
node scripts/build-android-preview.cjs --sdk "T:\s" --jdk "T:\j\jdk-17.0.21+9" --gradle-cache "T:\g" --ninja "T:\ninja\ninja.exe" --native-staging-root "T:\x" --windows-trust
# After all native/build processes finish:
subst T: /d
```

Use an unused drive letter and the prepared workspace/JDK locations. On this host the alias is visible in the elevated build context; use the same context for mapping, building and cleanup. Removing the alias leaves physical files intact. `--windows-trust` uses the Windows root certificate store for Java downloads when the local network requires it. `--output <directory>` changes the artifact directory; the default verified APK path is `.test-output/android-preview/mkhadda-preview.apk`.

The optional `--native-staging-root` option is selected in the verified Windows recipe. It sets `MKHADDA_NATIVE_STAGING_ROOT`, and the CNG plugin assigns each Android module a unique short directory through the supported top-level [`externalNativeBuild.cmake.buildStagingDirectory`](https://developer.android.com/reference/tools/gradle-api/9.2/com/android/build/api/dsl/Cmake) property. The callbacks register before the root plugins evaluate child projects. Use a persistent location outside module `build/` directories. The option also requests `-Pexpo.android.cmakeObjectPathMax=240`; it remains inactive when omitted.

The builder sets staging, runs the installed Expo CLI's `prebuild --platform android --no-install --no-clean`, then invokes `:app:assembleRelease` directly through Java. SDK 58 prebuild otherwise cleans native folders by default. The helper preserves any existing APK before prebuild and checkpoints the new Gradle candidate as `.unverified.apk` before inspecting it. Only successful artifact/source checks permit automatic promotion and a receipt. It limits Gradle/Metro workers and memory and disables Java/Kotlin release minification for this test artifact.

Keep the staging environment selected during both native generation and the Gradle JavaScript bundle step. This selects `com.remalbookings.app.preview` and the staging API. An ARM64-only build targets compatible physical phones; it is not a universal emulator/device build. Expo's generated release variant runs `export:embed` to include JavaScript/Hermes and assets, so the installed app does not require Metro. See the [Expo CLI Android compilation options](https://docs.expo.dev/more/expo-cli/#compiling-android).

On **17 November 2026**, local Gradle build attempt 5 succeeded in **19m 41s**, with **824 tasks**, from the owner's observed frozen source `18163f977848983712085364e6d1ccdd511ad7d0`. The delivered ARM64 staging APK is **34,518,122 bytes**, SHA-256 `1ffa011a3ac98960e62a180df417d67258e603e39d698089ec0903ff1db5ec45`. Independent checks verified the preview package, minimum/target/compile SDK **24/36/37**, permissions, bundled JavaScript and the certificate against the installed Expo template debug key. This is a **test-only debug signature**, even though Gradle used a release variant.

The wrapper stopped after Gradle success because its parser did not recognize the SDK 37 signer-output format. The artifact was independently verified and delivered; `.test-output/android-preview/build-receipt.json` explicitly records that the automatic wrapper did not complete and its before/after source-fingerprint guard was not reached. The source attribution comes from the observed frozen build context. Later helper or documentation commits do not change the APK's source attribution, and the corrected wrapper has not completed a new end-to-end run.

Local compatibility checks passed: `zipalign -c -P 16 -v 4`, all **24 ARM64 libraries / 73 PT_LOAD segments** for 16 KiB alignment, and conservative RELRO checks. All six native incremental Ninja dry-runs also passed with the short cache/staging paths; watched metadata stayed unchanged. These checks establish artifact/build properties, not Android runtime behavior. Device installation, 16 KiB device testing, native journey testing, a production-signed AAB and Play review remain pending. The temporary drive alias was removed after verification.

Production signing and Play submission are separate, later steps requiring the company's protected upload key/Play App Signing setup, a signed AAB, device testing and release review. Do not generate or commit signing keys as part of staging preparation. See [Android release signing](https://reactnative.dev/docs/signed-apk-android). Do not invent an Expo project ID, signing fingerprint or verified App Link association.

`android/` and `ios/` are CNG output and remain ignored. Never create or hand-edit them, even after generation; make persistent native changes in `app.config.ts` and config plugins, then regenerate through Expo. Review any regeneration command before it replaces local output. See [Expo SDK 58 build properties](https://docs.expo.dev/versions/v58.0.0/sdk/build-properties/).

Production checkout remains gated by actual supplier certification and merchant readiness. A consumer worldwide journey also needs an explicit backend path separate from the existing membership eligibility program, a complete account-deletion flow and accurate privacy/Data Safety disclosures. See [release preparation](release/README.md) and its source-backed inventory and unmeasured acceptance targets.

The store listing files are drafts. Browser-fixture QA screenshots are clearly labeled development evidence and must not be presented as native release screenshots or live supplier prices.
