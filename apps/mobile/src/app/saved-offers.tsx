import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppState } from '../components/AppState';
import { StatePanel, Button } from '../components/Primitives';
import BrandHeader from '../components/BrandHeader';
import { useLanguage } from '../i18n';
import { ui } from '../theme';
import ResultsScreen from '../screens/ResultsScreen';

export default function SavedOffers() {
  const { savedReady, savedLoading, retrySaved } = useAppState();
  const { t } = useLanguage();
  const router = useRouter();
  // Wait for the existing device list before capturing the IDs for this price check.
  if (savedReady) return <ResultsScreen savedOnly />;
  return <SafeAreaView style={ui.screen}><BrandHeader back/><View style={ui.page}>
    <StatePanel title={t(savedLoading ? 'loading' : 'savedError')} busy={savedLoading}
      retry={savedLoading ? undefined : () => void retrySaved()}/>
    <Button title={t('saved')} variant="quiet" onPress={() => router.dismissTo('/saved')}/>
  </View></SafeAreaView>;
}
