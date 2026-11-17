This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Local Android builds: owner-selected workflow

The owner explicitly chose local Android builds without an Expo account or Expo cloud service. Retain Expo SDK 58, Expo Router and Continuous Native Generation (CNG); do not eject, replace the framework, add an EAS project/account requirement or switch to a website wrapper. EAS/cloud builds are optional and require a separate owner choice, not a prerequisite for this workflow.

Use Expo prebuild to generate Android output, then the generated Gradle wrapper and local SDK/JDK. Current pins are JDK 17, Gradle 9.4.1, AGP 9.2.1, compile SDK 37 (`platforms;android-37.0`), target API 36, minimum API 24, Build Tools 37.0.0, NDK 27.1.12297006, SDK CMake 3.31.6 and external official Ninja 1.13.2. The verified Windows recipe maps the workspace `.cache/a` tools to an unused `T:` drive in the build execution context, uses `--gradle-cache T:\g` and `--native-staging-root T:\x`, and keeps workers bounded. Recreate the alias for a later build and remove it only after all native processes finish. Keep SDK binaries unchanged; do not hand-edit generated files, touch timestamps or suppress regeneration. Recheck installed sources and official compatibility documentation after dependency changes.

Use the maintained Node helper, which preserves an existing APK before prebuild, passes `--no-clean` (SDK 58 otherwise cleans by default), and checkpoints the new candidate before verification. A candidate is not automatically verified merely because Gradle succeeds. The delivered APK's source is the observed frozen `18163f9`; its independent receipt records the automatic signer-parser failure and the source-fingerprint guard not being reached. Later parser/docs commits are not the compiled source, and a full corrected-wrapper run has not been verified. The six native incremental dry-runs and local ZIP/ELF/RELRO checks passed; device/runtime, production AAB and Play approval remain unverified.

Keep `EXPO_PUBLIC_API_ENV=staging` during prebuild and Gradle bundling for local tests. The staging application ID is `com.remalbookings.app.preview`. A release-variant APK embeds JavaScript/assets, but the current generated template uses its debug signing key: it is test-only, not a production-signed release or a Play-ready AAB. Never claim a native build or device test from a JavaScript export. Production signing, key custody and store submission are later, separately reviewed work; do not generate keys or add credentials without explicit authorization.

The README describes the standard local command flow. Build scripts and SDK installation are maintained separately; do not hand-edit generated native files to solve a build failure. Consult [local Expo development](https://docs.expo.dev/guides/local-app-development/), [local production builds](https://docs.expo.dev/guides/local-app-production/), [Expo CLI Android compilation](https://docs.expo.dev/more/expo-cli/#compiling-android) and [AGP 9.2 compatibility](https://developer.android.com/build/releases/agp-9-2-0-release-notes).

## Rules

- `ios/` and `android/` are generated CNG output whether present or absent. Never create or edit them by hand; configure native behavior in `app.config.ts` and config plugins, then regenerate through Expo. Keep generated folders ignored and review regeneration before replacing local output.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a local development build: `npx expo run:ios|android`. EAS is optional if the owner later selects it.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
