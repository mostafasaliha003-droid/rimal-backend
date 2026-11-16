# مخدّة | Mkhadda

Native Android application foundation operated by **Remal Tourism**, using the existing booking backend. This project uses Expo SDK 58, React Native 0.88 and Expo Router. It renders native application components rather than displaying the website in a WebView.

The owner-approved store name is **مخدّة | Mkhadda**. The production package entered during Play Console setup is `com.remalbookings.app`; the isolated development package is `com.remalbookings.app.preview`. Play Console's application dashboard was observed after the owner completed phone verification and created the draft. No release binary or public publication is claimed.

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

## Native build preparation

`eas.json` defines development, preview APK and production AAB build profiles. Company-owned Expo build credentials, real Android signing identity, device testing and a release review are still required. Do not invent an Expo project ID, signing fingerprint or verified App Link association. Generated native folders are managed by Expo/config plugins and remain ignored.

Production checkout remains gated by actual supplier certification and merchant readiness. A consumer worldwide journey also needs an explicit backend path separate from the existing membership eligibility program, a complete account-deletion flow and accurate privacy/Data Safety disclosures. See [release preparation](release/README.md) and its source-backed inventory and unmeasured acceptance targets.

The store listing files are drafts. Browser-fixture QA screenshots are clearly labeled development evidence and must not be presented as native release screenshots or live supplier prices.
