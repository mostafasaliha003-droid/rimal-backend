import type { ExpoConfig } from 'expo/config';

// Public configuration only. Supplier/payment credentials stay on the BFF.
const environment = process.env.EXPO_PUBLIC_API_ENV ?? 'staging';
if (!['staging', 'production'].includes(environment)) {
  throw new Error('EXPO_PUBLIC_API_ENV must be staging or production.');
}
const production = environment === 'production';

const config: ExpoConfig = {
  name: production ? 'مخدة | pillow stays' : 'pillow stays Preview',
  slug: 'mkhadda',
  version: '0.64.0',
  orientation: 'default',
  icon: './assets/pillow-icon.png',
  scheme: production ? 'mkhadda' : 'mkhadda-preview',
  // Follows the phone's light or dark appearance (read at launch; see src/theme.ts).
  userInterfaceStyle: 'automatic',
  platforms: ['android', 'ios', 'web'],
  android: {
    // Store identity app.pillowstays (owner decision 2026-11-28: no bundle was ever uploaded under the
    // old com.remalbookings.app draft). Internal previews stay a separate application.
    package: production ? 'app.pillowstays' : 'app.pillowstays.preview',
    versionCode: 64,
    adaptiveIcon: {
      foregroundImage: './assets/pillow-adaptive.png',
      backgroundColor: '#ffffff',
    },
    permissions: [],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
    ],
    predictiveBackGestureEnabled: true,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: production ? 'app.pillowstays' : 'app.pillowstays.preview',
    // Kept equal to android.versionCode so both stores count releases the same way.
    buildNumber: '64',
    infoPlist: {
      // HTTPS only, no custom cryptography: exempt from export-compliance documentation.
      ITSAppUsesNonExemptEncryption: false,
      CFBundleDevelopmentRegion: 'ar',
    },
  },
  web: {
    favicon: './assets/pillow-icon.png',
    bundler: 'metro',
    output: 'single',
  },
  plugins: [
    'expo-router',
    // Sessions are kept in the keychain without biometrics, so no Face ID usage string is declared.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-system-ui',
    // The pillow on the cream canvas: the same colour as the app's first (font-loading) frame,
    // so launch flows into the app without a white flash.
    ['expo-splash-screen', { image: './assets/pillow-symbol.png', imageWidth: 112, resizeMode: 'contain', backgroundColor: '#FAF8F4',
      dark: { image: './assets/pillow-symbol.png', backgroundColor: '#0E0A11' } }],
    './plugins/with-local-ninja.cjs',
    // The app mirrors its own layout for Arabic (and switches language in-app without a restart),
    // so the native view tree must stay left-to-right; otherwise an Arabic-language phone flips it twice.
    ['expo-localization', { supportedLocales: { android: ['ar', 'en'], ios: ['ar', 'en'] }, supportsRTL: false }],
    ['expo-font', { fonts: [
      './assets/fonts/IBMPlexSansArabic-Regular.ttf',
      './assets/fonts/Manrope-Regular.ttf',
      './assets/fonts/IBMPlexSansArabic-Medium.ttf',
      './assets/fonts/Manrope-Medium.ttf',
      './assets/fonts/IBMPlexSansArabic-Bold.ttf',
      './assets/fonts/Manrope-Bold.ttf',
    ] }],
    ['expo-build-properties', { android: {
      compileSdkVersion: 37,
      targetSdkVersion: 36,
      minSdkVersion: 24,
      usesCleartextTraffic: false,
    } }],
  ],
  experiments: { typedRoutes: true },
  // Verified HTTPS App Links require the real Play signing fingerprint. Do not
  // advertise an unverified association or treat a deep link as payment proof.
  extra: { environment, releaseStage: 'welcome-redesign',
    nativePaymentsEnabled: process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED === 'true' },
};

export default config;
