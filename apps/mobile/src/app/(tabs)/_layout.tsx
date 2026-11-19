import React from 'react';
import { ColorValue, View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../../i18n';
import { colors, fonts, localizedFont } from '../../theme';
import { Icon } from '../../components/Primitives';

function tabIcon(name: 'search'|'saved'|'trips'|'account') {
  return function TabIcon({ color, focused }: { color: ColorValue | null; focused: boolean }) {
    return <View style={{ width: 48, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: focused ? colors.primary : 'transparent' }}>
      <Icon name={name} size={21} color={focused ? colors.surface : color}/>
    </View>;
  };
}

export default function TabLayout() {
  const { t, rtl, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.blueStrong,
    tabBarInactiveTintColor: colors.muted,
    tabBarLabelStyle: { fontFamily: localizedFont(language, fonts.bold), fontSize: 12 },
    tabBarStyle: {
      backgroundColor: colors.surface, borderTopColor: colors.border,
      height: 60 + insets.bottom + Math.max(0, fontScale - 1) * 16, paddingTop: 3,
      paddingBottom: insets.bottom + 3, direction: rtl ? 'rtl' : 'ltr',
    },
    tabBarItemStyle: { minHeight: 52 },
  }}>
    <Tabs.Screen name="index" options={{ title: t('explore'), tabBarIcon: tabIcon('search') }}/>
    <Tabs.Screen name="saved" options={{ title: t('saved'), tabBarIcon: tabIcon('saved') }}/>
    <Tabs.Screen name="bookings" options={{ title: t('trips'), tabBarIcon: tabIcon('trips') }}/>
    <Tabs.Screen name="account" options={{ title: t('account'), tabBarIcon: tabIcon('account') }}/>
  </Tabs>;
}
