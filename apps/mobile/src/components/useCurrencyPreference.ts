import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { api } from '../api';
import { createCurrencyPreference } from './currencyPreferenceModel';

const preference = createCurrencyPreference(AsyncStorage, signal => api.getClientRegion(signal), () => getLocales()[0]);

export function useCurrencyPreference() {
  const snapshot = useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getSnapshot);
  useEffect(() => {
    void preference.start();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void preference.start();
    });
    return () => listener.remove();
  }, []);
  return { ...snapshot, choose: preference.choose, useAutomatic: preference.useAutomatic };
}
