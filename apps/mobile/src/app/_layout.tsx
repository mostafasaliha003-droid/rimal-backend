import React, { useEffect } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from 'react-native';
import { Stack, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider, useLanguage } from '../i18n';
import { AuthProvider } from '../auth';
import { ChargeCurrencyProvider } from '../components/ChargeCurrency';
import { AppStateProvider } from '../components/AppState';
import { ToastProvider } from '../components/Toast';
import AppUpdatePrompt from '../components/AppUpdatePrompt';
import { AccessGate, MemberAccessProvider } from '../components/MemberAccess';
import { useReducedMotion } from '../components/motion';
import { color } from '../theme';
import { installCrashReporter, reportCrash, setCrashRoute } from '../components/crashReporter';

installCrashReporter();

/**
 * The last line of defence: a screen that fails to draw shows this calm, bilingual card instead of a
 * blank screen, and the failure is reported (anonymously) so it can be fixed. Providers may be gone
 * here, so it uses nothing but React Native itself.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { reportCrash(error, false); }, [error]);
  return <View style={{ flex: 1, backgroundColor: color.bgCanvas, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
    <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={{ width: 72, height: 56 }}/>
    <Text accessibilityRole="header" style={{ fontSize: 21, fontWeight: '700', color: color.textPrimary, textAlign: 'center', writingDirection: 'rtl' }}>تعثّرت هذه الصفحة</Text>
    <Text style={{ fontSize: 15, lineHeight: 24, color: color.textSecondary, textAlign: 'center', writingDirection: 'rtl' }}>أبلغنا فريقنا تلقائياً. حجوزاتك وحسابك بأمان.</Text>
    <Text style={{ fontSize: 14, lineHeight: 21, color: color.textSecondary, textAlign: 'center' }}>This page stumbled. We’ve told our team; your bookings and account are safe.</Text>
    <Pressable accessibilityRole="button" onPress={() => void retry()} style={({ pressed }) => ({ marginTop: 8, minHeight: 48, paddingHorizontal: 28, borderRadius: 24, justifyContent: 'center',
      backgroundColor: color.interactive, opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>حاول مجدداً · Try again</Text>
    </Pressable>
  </View>;
}

function CrashRoute() {
  const pathname = usePathname();
  useEffect(() => { setCrashRoute(pathname); }, [pathname]);
  return null;
}

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
    <Stack.Screen name="welcome" options={{ animation: 'fade', animationDuration: reduced ? 150 : 420, gestureEnabled: false }}/>
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
  return <SafeAreaProvider><LanguageProvider><AuthProvider><MemberAccessProvider><AppStateProvider><ChargeCurrencyProvider><ToastProvider>
    <StatusBar style="dark"/><CrashRoute/><Navigator/><AccessGate/><AppUpdatePrompt/>
  </ToastProvider></ChargeCurrencyProvider></AppStateProvider></MemberAccessProvider></AuthProvider></LanguageProvider></SafeAreaProvider>;
}
