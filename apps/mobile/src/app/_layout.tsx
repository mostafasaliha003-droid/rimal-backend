import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../i18n';
import { AuthProvider } from '../auth';
import { AppStateProvider } from '../components/AppState';
import { colors } from '../theme';

export default function RootLayout(){const [ready,error]=useFonts({
    PlexArabicRegular:require('../../assets/fonts/IBMPlexSansArabic-Regular.ttf'),
    ManropeRegular:require('../../assets/fonts/Manrope-Regular.ttf'),
    PlexArabicMedium:require('../../assets/fonts/IBMPlexSansArabic-Medium.ttf'),
    ManropeMedium:require('../../assets/fonts/Manrope-Medium.ttf'),
    PlexArabicBold:require('../../assets/fonts/IBMPlexSansArabic-Bold.ttf'),
    ManropeBold:require('../../assets/fonts/Manrope-Bold.ttf')
  });if(!ready&&!error)return <View style={{flex:1,backgroundColor:colors.background,justifyContent:'center'}}><ActivityIndicator color={colors.blueStrong}/></View>;return <SafeAreaProvider><LanguageProvider><AuthProvider><AppStateProvider><StatusBar style="dark"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:colors.background},animation:'slide_from_right'}}><Stack.Screen name="(tabs)"/><Stack.Screen name="results"/><Stack.Screen name="saved-dates"/><Stack.Screen name="saved-offers"/><Stack.Screen name="hotel/[hid]"/><Stack.Screen name="review"/><Stack.Screen name="compare"/><Stack.Screen name="checkout"/><Stack.Screen name="account-deletion"/><Stack.Screen name="support"/><Stack.Screen name="membership"/><Stack.Screen name="notifications"/></Stack></AppStateProvider></AuthProvider></LanguageProvider></SafeAreaProvider>;}
