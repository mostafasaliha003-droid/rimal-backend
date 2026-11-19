import React from 'react';
import { ColorValue, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../../i18n';
import { color, fonts, localizedFont, radius } from '../../theme';
import { Icon, type IconName } from '../../components/Icon';
import { useLayout } from '../../components/motion';

function tabIcon(name: IconName) {
  return function TabIcon({ color: tint, focused }: { color: ColorValue | null; focused: boolean }) {
    // The indicator sits behind the icon only, so it never overlaps the label.
    return <View style={{ width: 56, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill,
      backgroundColor: focused ? color.bgSelected : 'transparent' }}>
      <Icon name={name} size={22} filled={focused && name === 'saved'} color={focused ? color.interactiveStrong : tint}/>
    </View>;
  };
}

export default function TabLayout() {
  const { t, rtl, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const { fontScale, desktop } = useLayout();
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: color.interactiveStrong,
    tabBarInactiveTintColor: color.textSecondary,
    tabBarLabelPosition: 'below-icon',
    tabBarLabelStyle: { fontFamily: localizedFont(language, fonts.bold), fontSize: 12, lineHeight: language === 'ar' ? 20 : 16, marginTop: 2 },
    // Desktop navigation lives in the header; the bottom bar is a phone/tablet pattern.
    tabBarStyle: desktop ? { display: 'none' } : {
      backgroundColor: color.bgSurface, borderTopColor: color.border,
      height: (language === 'ar' ? 70 : 64) + insets.bottom + Math.max(0, fontScale - 1) * 16, paddingTop: 6,
      paddingBottom: insets.bottom + 6, direction: rtl ? 'rtl' : 'ltr',
    },
    tabBarItemStyle: { minHeight: 52 },
  }}>
    <Tabs.Screen name="index" options={{ title: t('explore'), tabBarIcon: tabIcon('search') }}/>
    <Tabs.Screen name="saved" options={{ title: t('saved'), tabBarIcon: tabIcon('saved') }}/>
    <Tabs.Screen name="bookings" options={{ title: t('trips'), tabBarIcon: tabIcon('trips') }}/>
    <Tabs.Screen name="account" options={{ title: t('account'), tabBarIcon: tabIcon('account') }}/>
  </Tabs>;
}
