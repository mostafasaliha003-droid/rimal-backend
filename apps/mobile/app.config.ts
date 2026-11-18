import type { ExpoConfig } from 'expo/config';

// Public configuration only. Supplier/payment credentials stay on the BFF.
const environment = process.env.EXPO_PUBLIC_API_ENV ?? 'staging';
if (!['staging', 'production'].includes(environment)) {
  throw new Error('EXPO_PUBLIC_API_ENV must be staging or production.');
}
const production = environment === 'production';

const config: ExpoConfig = {
  name: production ? 'مخدّة | Mkhadda' : 'Mkhadda Preview',
  slug: 'mkhadda',
  version: '0.13.0',
  orientation: 'default',
  icon: './assets/icon.png',
  scheme: production ? 'mkhadda' : 'mkhadda-preview',
  userInterfaceStyle: 'light',
  platforms: ['android', 'ios', 'web'],
  android: {
    // Production identity entered in the owner-created Play draft, 16 Nov 2026.
    // Keep internal previews separate from the store application.
    package: production ? 'com.remalbookings.app' : 'com.remalbookings.app.preview',
    versionCode: 13,
    adaptiveIcon: {
      foregroundImage: './assets/remal-icon.png',
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
    ],
    predictiveBackGestureEnabled: true,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: production ? 'com.remalbookings.app' : 'com.remalbookings.app.preview',
  },
  web: {
    favicon: './assets/favicon.png',
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
      './assets/fonts/Tajawal-Regular.ttf',
      './assets/fonts/Tajawal-Medium.ttf',
      './assets/fonts/Tajawal-Bold.ttf',
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
  extra: { environment, releaseStage: 'family-rooms',
    nativePaymentsEnabled: process.env.EXPO_PUBLIC_NATIVE_CHECKOUT_ENABLED === 'true' },
};

export default config;
