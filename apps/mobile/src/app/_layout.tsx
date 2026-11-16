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

export default function RootLayout(){const [ready,error]=useFonts({Tajawal_400Regular:require('../../assets/fonts/Tajawal-Regular.ttf'),Tajawal_500Medium:require('../../assets/fonts/Tajawal-Medium.ttf'),Tajawal_700Bold:require('../../assets/fonts/Tajawal-Bold.ttf')});if(!ready&&!error)return <View style={{flex:1,backgroundColor:colors.background,justifyContent:'center'}}><ActivityIndicator color={colors.blueStrong}/></View>;return <SafeAreaProvider><LanguageProvider><AuthProvider><AppStateProvider><StatusBar style="dark"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:colors.background},animation:'slide_from_right'}}><Stack.Screen name="(tabs)"/><Stack.Screen name="results"/><Stack.Screen name="hotel/[hid]"/><Stack.Screen name="support"/></Stack></AppStateProvider></AuthProvider></LanguageProvider></SafeAreaProvider>;}
