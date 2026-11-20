import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider, useLanguage } from '../i18n';
import { AuthProvider } from '../auth';
import { ChargeCurrencyProvider } from '../components/ChargeCurrency';
import { AppStateProvider } from '../components/AppState';
import { ToastProvider } from '../components/Toast';
import AppUpdatePrompt from '../components/AppUpdatePrompt';
import { useReducedMotion } from '../components/motion';
import { color } from '../theme';

// Browser-only: keyboard focus rings (:focus-visible keeps them off mouse clicks)
// and a global reduce-motion fallback for CSS-driven transitions.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('mkhadda-web-base')) {
  const style = document.createElement('style');
  style.id = 'mkhadda-web-base';
  style.textContent = `
    [role="button"]:focus-visible, [role="tab"]:focus-visible, [role="checkbox"]:focus-visible, [role="radio"]:focus-visible,
    [role="link"]:focus-visible, a:focus-visible, button:focus-visible, input[type="checkbox"]:focus-visible {
      outline: 2px solid ${color.focusRing} !important; outline-offset: 2px !important; }
    input:focus-visible, textarea:focus-visible { outline: none; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; scroll-behavior: auto !important; } }
  `;
  document.head.appendChild(style);
}

function Navigator() {
  const { rtl } = useLanguage();
  const reduced = useReducedMotion();
  // The app mirrors its own layout instead of flipping the whole native view tree,
  // so the push transition must follow the reading direction explicitly.
  const animation = reduced ? 'fade' : rtl ? 'slide_from_left' : 'slide_from_right';
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bgCanvas }, animation, animationDuration: reduced ? 150 : 280 }}>
    <Stack.Screen name="(tabs)"/><Stack.Screen name="results"/><Stack.Screen name="saved-dates"/><Stack.Screen name="saved-offers"/>
    <Stack.Screen name="hotel/[hid]"/><Stack.Screen name="review"/><Stack.Screen name="compare"/><Stack.Screen name="checkout"/>
    <Stack.Screen name="account-deletion"/><Stack.Screen name="support"/><Stack.Screen name="membership"/><Stack.Screen name="notifications"/>
  </Stack>;
}

export default function RootLayout() {
  const [ready, error] = useFonts({
    PlexArabicRegular: require('../../assets/fonts/IBMPlexSansArabic-Regular.ttf'),
    ManropeRegular: require('../../assets/fonts/Manrope-Regular.ttf'),
    PlexArabicMedium: require('../../assets/fonts/IBMPlexSansArabic-Medium.ttf'),
    ManropeMedium: require('../../assets/fonts/Manrope-Medium.ttf'),
    PlexArabicBold: require('../../assets/fonts/IBMPlexSansArabic-Bold.ttf'),
    ManropeBold: require('../../assets/fonts/Manrope-Bold.ttf'),
  });
  if (!ready && !error) return <View style={{ flex: 1, backgroundColor: color.bgCanvas, justifyContent: 'center' }}><ActivityIndicator color={color.interactive}/></View>;
  return <SafeAreaProvider><LanguageProvider><AuthProvider><AppStateProvider><ChargeCurrencyProvider><ToastProvider>
    <StatusBar style="dark"/><Navigator/><AppUpdatePrompt/>
  </ToastProvider></ChargeCurrencyProvider></AppStateProvider></AuthProvider></LanguageProvider></SafeAreaProvider>;
}
