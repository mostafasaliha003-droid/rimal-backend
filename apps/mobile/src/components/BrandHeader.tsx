import React from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { APP_ENV } from '../api';
import { useAuth } from '../auth';
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

export function AccountAvatar({ name, large = false }: { name: string; large?: boolean }) {
  const initial = name.includes('@') ? '' : Array.from(name.trim())[0]?.toLocaleUpperCase();
  const size = large ? 52 : 30;
  return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.pistachio, borderWidth: 1, borderColor: colors.surface }}>
    {initial ? <Txt accessible={false} kind="label" style={{ color: colors.primary, fontSize: large ? 23 : 14,
      lineHeight: large ? 32 : 21, textAlign: 'center' }}>{initial}</Txt> : <Icon name="account" size={large ? 27 : 18}/>}
  </View>;
}

export default function BrandHeader({ back = false }: { back?: boolean }) {
  const { language, setLanguage, t } = useLanguage();
  const { user, status, restorePending } = useAuth();
  const router = useRouter();
  const ar = language === 'ar';
  const signedIn = status === 'signedIn' && user;
  const firstName = signedIn && !signedIn.name.includes('@') ? signedIn.name.trim().split(/\s+/u)[0] : '';
  const guestLabel = restorePending ? (ar ? 'استعادة الجلسة' : 'Restore session') : t('signIn');
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
        {status === 'loading' ? <View style={action} accessibilityLabel={t('accountChecking')}><ActivityIndicator size="small" color={colors.navy}/></View> :
          <Pressable testID={signedIn ? 'header-signed-in' : restorePending ? 'header-restore-session' : 'header-sign-in'} accessibilityRole="button"
            accessibilityLabel={signedIn ? [t('account'), ar ? 'مسجّل الدخول' : 'Signed in', firstName].filter(Boolean).join(' · ') : guestLabel}
            style={action} onPress={() => router.navigate('/account')}>
            {signedIn ? <Row style={{ gap: 5, maxWidth: 105 }}>
              <AccountAvatar name={signedIn.name}/><Txt kind="label" numberOfLines={1} style={{ flexShrink: 1 }}>{firstName || t('account')}</Txt>
            </Row> : <Row style={{ gap: 4 }}><Icon name="account" size={18}/>
              <Txt kind="label">{ar && !restorePending ? 'دخول' : guestLabel}</Txt></Row>}
          </Pressable>}
      </Row>
    </Row>
  </View>;
}
