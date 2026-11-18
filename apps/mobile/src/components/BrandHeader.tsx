import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { APP_ENV } from '../api';
import { Icon, Row, Txt } from './Primitives';

export function PillowWordmark() {
  return <View accessible accessibilityLabel="مخدة · pillow stays" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={{ width: 34, height: 34 }}/>
    <View style={{ alignItems: 'center' }}>
      <Text accessible={false} style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 27, color: colors.primary, writingDirection: 'rtl' }}>مخدة</Text>
      <Text accessible={false} style={{ fontFamily: 'ManropeMedium', fontSize: 10, lineHeight: 13, letterSpacing: .4, color: colors.primary, writingDirection: 'ltr' }}>pillow stays</Text>
    </View>
  </View>;
}

const action = { minWidth: 48, minHeight: 48, paddingHorizontal: 5, alignItems: 'center' as const, justifyContent: 'center' as const };
export default function BrandHeader({ back = false }: { back?: boolean }) {
  const { language, setLanguage, t } = useLanguage();
  const router = useRouter();
  return <View style={{ backgroundColor: colors.canvas, alignItems: 'center' }}>
    <Row style={{ width: '100%', maxWidth: 880, minHeight: 56, paddingHorizontal: 10, paddingVertical: 4, gap: 0, flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <Row style={{ gap: 3, flexWrap: 'wrap' }}>
        {back && <Pressable accessibilityRole="button" accessibilityLabel={t('back')} style={action}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Icon name="back" size={23}/></Pressable>}
        <PillowWordmark/>
        {APP_ENV !== 'production' && <View style={{ marginHorizontal: 4, paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.softGold }}>
          <Txt kind="small" style={{ color: colors.goldInk, fontSize: 12, lineHeight: 18 }}>{language === 'ar' ? 'اختبار' : 'Test'}</Txt>
        </View>}
      </Row>
      <Row style={{ gap: 0 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'ar' ? 'EN · Switch to English' : 'عربي · التبديل إلى العربية'}
          style={action} onPress={() => setLanguage(language === 'ar' ? 'en' : 'ar')}><Txt kind="label">{language === 'ar' ? 'EN' : 'عربي'}</Txt></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('account')} style={action} onPress={() => router.navigate('/account')}>
          <Icon name="account" size={25}/>
        </Pressable>
      </Row>
    </Row>
  </View>;
}
