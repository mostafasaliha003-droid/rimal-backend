import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { websiteUrl } from '../api';
import { NATIVE_CHECKOUT_ENABLED } from '../api/config';
import { useLanguage } from '../i18n';
import { color, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Icon, Row, Txt, type IconName } from '../components/Primitives';

const SUPPORT_EMAIL = 'management@remaltourismllc.com';
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/** One support action as a list row: what it is, where it leads, and whether it leaves the app. */
function SupportRow({ icon, title, detail, onPress, external = false, testID }: {
  icon: IconName; title: string; detail?: string; onPress: () => void; external?: boolean; testID?: string;
}) {
  const { language } = useLanguage();
  return <Pressable testID={testID} accessibilityRole={external ? 'link' : 'button'} onPress={onPress}
    accessibilityLabel={[title, detail].filter(Boolean).join(' · ')}
    accessibilityHint={external ? (language === 'ar' ? 'يفتح خارج التطبيق' : 'Opens outside the app') : undefined}
    style={state => [styles.row, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
    <Row style={{ gap: space.md }}>
      <View style={styles.iconBox}><Icon name={icon} size={19} color={color.interactiveStrong}/></View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Txt kind="label" tone="primary">{title}</Txt>
        {!!detail && <Txt kind="caption" numberOfLines={1}>{detail}</Txt>}
      </View>
      <Icon name={external ? 'external' : 'chevron'} size={16} color={color.textSecondary}/>
    </Row>
  </Pressable>;
}

export default function SupportScreen() {
  const { t, language, rtl } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const [error, setError] = useState(false);
  const open = async (path: '/support' | '/privacy' | '/terms' | '/account-deletion') => {
    setError(false);
    try { await WebBrowser.openBrowserAsync(websiteUrl(path), { toolbarColor: color.bgBrand }); } catch { setError(true); }
  };
  const email = () => { setError(false); void Linking.openURL('mailto:' + SUPPORT_EMAIL).catch(() => setError(true)); };
  // What this build actually does: booking in the app and payment on the secure payment page,
  // or (when in-app checkout is off) booking on the website.
  const note = NATIVE_CHECKOUT_ENABLED
    ? (ar ? 'تحجز داخل التطبيق، وتدفع عبر صفحة الدفع الآمنة، وتتابع التأكيد في «رحلاتي» و«الإشعارات». إشعارات الهاتف واستعادة كلمة المرور غير متاحة بعد.'
      : 'You book in the app, pay on the secure payment page and follow the confirmation in My trips and Notifications. Phone notifications and password recovery are not available yet.')
    : t('foundationNote');
  const section = (title: string, children: React.ReactNode) => <View style={{ gap: space.xs }}>
    <Txt kind="caption" accessibilityRole="header" style={{ paddingHorizontal: space.xs }}>{title}</Txt>
    <View style={styles.menu}>{children}</View>
  </View>;
  // The divider starts after the icon, on the side the icon sits.
  const rule = <View style={[styles.rule, rtl ? { marginRight: 64 } : { marginLeft: 64 }]}/>;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView contentContainerStyle={[ui.page, { gap: space.lg }]}>
      <View style={{ gap: space.xxs }}>
        <Txt kind="heading" accessibilityRole="header">{ar ? 'الدعم' : 'Support'}</Txt>
        <Txt kind="small">{t('supportBody')}</Txt>
      </View>
      {section(ar ? 'تواصل معنا' : 'Contact us', <>
        <SupportRow testID="support-email" icon="mail" title={t('contactEmail')} detail={SUPPORT_EMAIL} onPress={email} external/>
        {rule}
        <SupportRow testID="support-website" icon="support" title={t('websiteSupport')} detail={ar ? 'مركز المساعدة على موقعنا' : 'Help centre on our website'} onPress={() => void open('/support')} external/>
        {rule}
        <SupportRow testID="support-trips" icon="trips" title={ar ? 'رحلاتي' : 'My trips'} detail={ar ? 'مرجع كل حجز مذكور في بطاقته' : 'Each booking shows its reference'} onPress={() => router.navigate('/bookings')}/>
      </>)}
      {section(ar ? 'السياسات والحساب' : 'Policies and account', <>
        <SupportRow testID="support-privacy" icon="shield" title={t('privacy')} onPress={() => void open('/privacy')} external/>
        {rule}
        <SupportRow testID="support-terms" icon="receipt" title={t('terms')} onPress={() => void open('/terms')} external/>
        {rule}
        <SupportRow testID="support-deletion" icon="trash" title={t('deletionWeb')} onPress={() => void open('/account-deletion')} external/>
      </>)}
      {error && <Txt accessibilityRole="alert" kind="small" tone="danger">{t('websiteError')}</Txt>}
      <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
        <View style={{ paddingTop: 2 }}><Icon name="info" size={15} color={color.textSecondary}/></View>
        <Txt kind="caption" style={{ flex: 1 }}>{note}</Txt>
      </Row>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  menu: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard },
  row: { minHeight: 60, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
  iconBox: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.bgSelected, alignItems: 'center', justifyContent: 'center' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.border },
});
