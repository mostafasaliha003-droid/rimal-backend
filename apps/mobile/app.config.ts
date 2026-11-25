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
  version: '0.53.0',
  orientation: 'default',
  icon: './assets/pillow-icon.png',
  scheme: production ? 'mkhadda' : 'mkhadda-preview',
  userInterfaceStyle: 'light',
  platforms: ['android', 'ios', 'web'],
  android: {
    // Production identity entered in the owner-created Play draft, 16 Nov 2026.
    // Keep internal previews separate from the store application.
    package: production ? 'com.remalbookings.app' : 'com.remalbookings.app.preview',
    versionCode: 53,
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
    bundleIdentifier: production ? 'com.remalbookings.app' : 'com.remalbookings.app.preview',
    // Kept equal to android.versionCode so both stores count releases the same way.
    buildNumber: '53',
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
    'expo-secure-store',
    'expo-system-ui',
    './plugins/with-local-ninja.cjs',
    ['expo-localization', { supportedLocales: { android: ['ar', 'en'], ios: ['ar', 'en'] } }],
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
  extra: { environment, releaseStage: 'members-only-tabby-welcome',
    nativePaymentsEnabled: process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED === 'true' },
};

export default config;
