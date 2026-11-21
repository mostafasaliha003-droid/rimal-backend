import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { color, fonts, layout, radius, space, touch } from '../theme';
import { APP_ENV } from '../api';
import { useAuth } from '../auth';
import { Badge, Icon, Row, Txt } from './Primitives';
import { useLayout } from './motion';

/** The approved Mkhadda symbol and bilingual wordmark. */
export function PillowWordmark({ stacked = false }: { stacked?: boolean }) {
  return <View accessible accessibilityRole="image" accessibilityLabel="مخدة pillow stays" style={{ flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? 2 : 6 }}>
    <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={{ width: stacked ? 67 : 32, height: stacked ? 51 : 32 }}/>
    <View style={{ alignItems: 'center' }}>
      <Text accessible={false} allowFontScaling={!stacked} style={{ fontFamily: fonts.bold, fontSize: stacked ? 28 : 21, lineHeight: stacked ? 36 : 26, color: color.textBrand, writingDirection: 'rtl' }}>مخدة</Text>
      <Text accessible={false} allowFontScaling={!stacked} style={{ fontFamily: 'ManropeMedium', fontSize: stacked ? 12 : 10, lineHeight: stacked ? 16 : 13, letterSpacing: .4, color: color.textBrand, writingDirection: 'ltr' }}>pillow stays</Text>
    </View>
  </View>;
}

export function AccountAvatar({ name, large = false }: { name: string; large?: boolean }) {
  const initial = name.includes('@') ? '' : Array.from(name.trim())[0]?.toLocaleUpperCase();
  const size = large ? 52 : 30;
  return <View accessible={false} aria-hidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center',
    justifyContent: 'center', backgroundColor: color.successBg, borderWidth: 1, borderColor: color.successBorder }}>
    {initial ? <Txt accessible={false} kind="label" style={{ color: color.textBrand, fontSize: large ? 22 : 14, lineHeight: large ? 30 : 20, textAlign: 'center' }}>{initial}</Txt>
      : <Icon name="account" size={large ? 26 : 18}/>}
  </View>;
}

const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);
const navItems = [
  { path: '/', key: 'explore', icon: 'search' }, { path: '/saved', key: 'saved', icon: 'saved' }, { path: '/bookings', key: 'trips', icon: 'trips' },
] as const;

export default function BrandHeader({ back = false }: { back?: boolean }) {
  const { language, setLanguage, t } = useLanguage();
  const { user, status, restorePending } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const ar = language === 'ar';
  const { width, fontScale, desktop } = useLayout();
  const compact = width / Math.max(1, fontScale) < (back ? 370 : 330);
  const signedIn = status === 'signedIn' && user;
  const firstName = signedIn && !signedIn.name.includes('@') ? signedIn.name.trim().split(/\s+/u)[0] : '';
  const guestLabel = restorePending ? (ar ? 'استعادة الجلسة' : 'Restore session') : t('signIn');
  // A quiet header: on phones the account lives in its tab and the language in Account; Explore
  // keeps the language switch so a first-time visitor can change it before searching.
  const showLanguage = desktop || (!back && pathname === '/');
  const showAccount = desktop;
  return <View style={styles.bar}>
    <Row style={[styles.inner, desktop && { maxWidth: layout.maxContent, paddingHorizontal: space.xl }]}>
      <Row style={{ gap: space.xs, flexShrink: 1 }}>
        {back && <Pressable accessibilityRole="button" accessibilityLabel={t('back')} testID="header-back"
          style={state => [styles.action, (state.pressed || hovered(state)) && styles.actionActive]}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Icon name="back" size={22}/></Pressable>}
        <Pressable accessibilityRole="link" accessibilityHint={ar ? 'الصفحة الرئيسية' : 'Home'} onPress={() => router.navigate('/')}
          style={styles.brand}><PillowWordmark/></Pressable>
        {APP_ENV !== 'production' && <View style={{ alignSelf: 'center' }}><Badge tone="warning" label={ar ? 'اختبار' : 'Test'}/></View>}
        {desktop && <Row style={{ gap: space.xxs, marginHorizontal: space.lg }} role="navigation" aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
          {navItems.map(item => {
            const active = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
            return <Pressable key={item.key} accessibilityRole="link" aria-current={active ? 'page' : undefined} onPress={() => router.navigate(item.path)}
              style={state => [styles.navItem, active && styles.navActive, !active && (state.pressed || hovered(state)) && styles.actionActive]}>
              <Row style={{ gap: space.xs }}><Icon name={item.icon} size={18} color={active ? color.interactiveStrong : color.textBrand}/>
                <Txt kind="label" style={{ color: active ? color.interactiveStrong : color.textBrand }}>{t(item.key)}</Txt></Row>
            </Pressable>;
          })}
        </Row>}
      </Row>
      <Row style={{ gap: space.xxs }}>
        {showLanguage && <Pressable testID="header-language" accessibilityRole="button" accessibilityLabel={ar ? 'EN · Switch to English' : 'عربي · التبديل إلى العربية'}
          style={state => [styles.action, (state.pressed || hovered(state)) && styles.actionActive]} onPress={() => setLanguage(ar ? 'en' : 'ar')}>
          <Row style={{ gap: space.xs }}><Icon name="globe" size={18} color={color.interactiveStrong}/>
            <Txt kind="label" style={styles.locale}>{ar ? 'EN' : 'عربي'}</Txt></Row>
        </Pressable>}
        {!showAccount ? null : status === 'loading' ? <View style={styles.action} accessibilityLabel={t('accountChecking')}><ActivityIndicator size="small" color={color.interactive}/></View> :
          <Pressable testID={signedIn ? 'header-signed-in' : restorePending ? 'header-restore-session' : 'header-sign-in'} accessibilityRole="button"
            accessibilityLabel={signedIn ? [firstName || t('account'), t('account'), ar ? 'مسجّل الدخول' : 'Signed in'].filter(Boolean).join(' · ') : ar && !restorePending ? 'دخول إلى الحساب' : guestLabel}
            style={styles.action} onPress={() => signedIn ? router.navigate('/account') : router.navigate({ pathname: '/account', params: { returnTo: pathname } })}>
            {state => <Row style={[styles.accountChip, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
              {signedIn && compact ? <AccountAvatar name={signedIn.name}/> : <Icon name="account" size={18}/>}
              {!compact && <Txt kind="label" numberOfLines={1} style={{ flexShrink: 1 }}>{signedIn ? firstName || t('account') : ar && !restorePending ? 'دخول' : guestLabel}</Txt>}
            </Row>}
          </Pressable>}
      </Row>
    </Row>
  </View>;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.bgCanvas, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  inner: { width: '100%', maxWidth: layout.maxReading + 160, minHeight: 52, paddingHorizontal: space.sm, paddingVertical: 0, justifyContent: 'space-between', gap: space.xs },
  brand: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.xxs },
  action: { minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  actionActive: { backgroundColor: color.bgMuted },
  navItem: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, justifyContent: 'center' },
  navActive: { backgroundColor: color.bgSelected },
  locale: { fontSize: 13, color: color.interactiveStrong, textAlign: 'center' },
  accountChip: { gap: space.xs, minHeight: 36, maxWidth: 140, paddingHorizontal: space.sm, paddingVertical: space.xxs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.bgSurface },
});
