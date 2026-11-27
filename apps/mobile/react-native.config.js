// react-native-maps draws the native Apple map on iOS only (src/components/StaysMap.ios.tsx).
// Android keeps the MapLibre WebView, so the Google Maps SDK is not linked into the APK.
module.exports = {
  dependencies: {
    'react-native-maps': { platforms: { android: null } },
  },
};
