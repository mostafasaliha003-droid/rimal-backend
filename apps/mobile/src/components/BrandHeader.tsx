import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { APP_ENV } from '../api';
import { Icon, Row, Txt } from './Primitives';

export function PillowWordmark() {
  return <View accessible accessibilityLabel="مخدة · pillow stays" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={{ width: 46, height: 46 }}/>
    <View style={{ alignItems: 'center' }}>
      <Text accessible={false} style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 33, color: colors.primary, writingDirection: 'rtl' }}>مخدة</Text>
      <Text accessible={false} style={{ fontFamily: 'ManropeMedium', fontSize: 10, lineHeight: 14, letterSpacing: .5, color: colors.primary, writingDirection: 'ltr' }}>pillow stays</Text>
    </View>
  </View>;
}

export function EnvironmentBanner() {
  const { language } = useLanguage();
  if (APP_ENV === 'production') return null;
  return <View style={{ backgroundColor: colors.softGold, paddingHorizontal: 20, paddingVertical: 2 }}>
    <Txt kind="small" style={{ color: colors.goldInk, fontSize: 12 }}>{language === 'ar' ? 'بيئة اختبار' : 'Test environment'}</Txt>
  </View>;
}

const round = { minWidth: 44, height: 44, paddingHorizontal: 9, borderRadius: 22, backgroundColor: colors.surface,
  borderWidth: 1, borderColor: colors.border, alignItems: 'center' as const, justifyContent: 'center' as const };
export default function BrandHeader({ back = false }: { back?: boolean }) {
  const { language, setLanguage, t, rtl } = useLanguage();
  const router = useRouter();
  return <View style={{ backgroundColor: colors.canvas, alignItems: 'center' }}>
    <Row style={{ width: '100%', maxWidth: 880, paddingHorizontal: 20, paddingVertical: 10, justifyContent: 'space-between' }}>
      <Row style={{ gap: 8 }}>
        {back && <Pressable accessibilityRole="button" accessibilityLabel={t('back')} style={round}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Txt kind="heading">{rtl ? '→' : '←'}</Txt></Pressable>}
        <PillowWordmark/>
      </Row>
      <Row style={{ gap: 7 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'ar' ? 'EN · Switch to English' : 'عربي · التبديل إلى العربية'}
          style={round} onPress={() => setLanguage(language === 'ar' ? 'en' : 'ar')}><Txt kind="label">{language === 'ar' ? 'EN' : 'عربي'}</Txt></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('account')} style={round} onPress={() => router.navigate('/account')}>
          <Icon name="account" size={20}/>
        </Pressable>
      </Row>
    </Row>
  </View>;
}
