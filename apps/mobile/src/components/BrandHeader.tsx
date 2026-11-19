import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { APP_ENV } from '../api';
import { useAuth } from '../auth';
import { Icon, Row, Txt } from './Primitives';

export function PillowWordmark({ stacked = false }: { stacked?: boolean }) {
  return <View accessible accessibilityLabel="مخدة · pillow stays" style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? 2 : 6 }}>
    <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={{ width: stacked ? 67 : 34, height: stacked ? 51 : 34 }}/>
    <View style={{ alignItems: 'center' }}>
      <Text accessible={false} allowFontScaling={!stacked} style={{ fontFamily: fonts.bold, fontSize: stacked ? 28 : 22, lineHeight: stacked ? 36 : 27, color: colors.primary, writingDirection: 'rtl' }}>مخدة</Text>
      <Text accessible={false} allowFontScaling={!stacked} style={{ fontFamily: 'ManropeMedium', fontSize: stacked ? 12 : 10, lineHeight: stacked ? 16 : 13, letterSpacing: .4, color: colors.primary, writingDirection: 'ltr' }}>pillow stays</Text>
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
  const pathname = usePathname();
  const ar = language === 'ar';
  const { width, fontScale } = useWindowDimensions();
  const compact = width / Math.max(1, fontScale) < (back ? 370 : 330);
  const signedIn = status === 'signedIn' && user;
  const firstName = signedIn && !signedIn.name.includes('@') ? signedIn.name.trim().split(/\s+/u)[0] : '';
  const guestLabel = restorePending ? (ar ? 'استعادة الجلسة' : 'Restore session') : t('signIn');
  return <View style={styles.bar}>
    <Row style={styles.inner}>
      <Row style={{ gap: 2, flexShrink: 1 }}>
        {back && <Pressable accessibilityRole="button" accessibilityLabel={t('back')} style={action}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Icon name="back" size={23}/></Pressable>}
        <PillowWordmark/>
        {APP_ENV !== 'production' && <View style={{ marginHorizontal: 3, paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.softGold }}>
          <Txt kind="small" style={{ color: colors.goldInk, fontSize: 12, lineHeight: 18 }}>{language === 'ar' ? 'اختبار' : 'Test'}</Txt>
        </View>}
      </Row>
      <Row style={{ gap: 0 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === 'ar' ? 'EN · Switch to English' : 'عربي · التبديل إلى العربية'}
          style={action} onPress={() => setLanguage(language === 'ar' ? 'en' : 'ar')}><Txt kind="label" style={styles.locale}>{language === 'ar' ? 'EN' : 'عربي'}</Txt></Pressable>
        {status === 'loading' ? <View style={action} accessibilityLabel={t('accountChecking')}><ActivityIndicator size="small" color={colors.navy}/></View> :
          <Pressable testID={signedIn ? 'header-signed-in' : restorePending ? 'header-restore-session' : 'header-sign-in'} accessibilityRole="button"
            accessibilityLabel={signedIn ? [t('account'), ar ? 'مسجّل الدخول' : 'Signed in', firstName].filter(Boolean).join(' · ') : guestLabel}
            style={action} onPress={() => signedIn ? router.navigate('/account') : router.navigate({ pathname: '/account', params: { returnTo: pathname } })}>
            {signedIn ? <Row style={styles.accountChip}>
              <AccountAvatar name={signedIn.name}/>{!compact && <Txt kind="label" numberOfLines={1} style={{ flexShrink: 1 }}>{firstName || t('account')}</Txt>}
            </Row> : <Row style={styles.accountChip}><Icon name="account" size={18}/>
              {!compact && <Txt kind="label">{ar && !restorePending ? 'دخول' : guestLabel}</Txt>}</Row>}
          </Pressable>}
      </Row>
    </Row>
  </View>;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.canvas, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 880, minHeight: 58, paddingHorizontal: 12, paddingVertical: 3, flexWrap: 'wrap', justifyContent: 'space-between', gap: 0 },
  locale: { fontSize: 13, color: colors.violetInk, textAlign: 'center' },
  accountChip: { gap: 5, minHeight: 32, maxWidth: 110, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
