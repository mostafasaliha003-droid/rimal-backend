import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, websiteUrl } from '../api';
import type { BookingHistoryItem } from '../api/bookings';
import type { SupportConversation } from '../api/support';
import { useAuth } from '../auth';
import { NATIVE_CHECKOUT_ENABLED } from '../api/config';
import { useLanguage } from '../i18n';
import { color, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Icon, Row, Skeleton, Txt, type IconName } from '../components/Primitives';
import CareMark from '../components/CareMark';
import { careCopy, sortConversations } from '../components/careModel';

const SUPPORT_EMAIL = 'support@pillowstays.app';
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/** One support action as a list row: what it is, where it leads, and whether it leaves the app. */
function SupportRow({ icon, title, detail, onPress, external = false, testID, unread = false }: {
  icon: IconName; title: string; detail?: string; onPress: () => void; external?: boolean; testID?: string; unread?: boolean;
}) {
  const { language } = useLanguage();
  return <Pressable testID={testID} accessibilityRole={external ? 'link' : 'button'} onPress={onPress}
    accessibilityLabel={[title, detail].filter(Boolean).join(' · ')}
    accessibilityHint={external ? (language === 'ar' ? 'يفتح خارج التطبيق' : 'Opens outside the app') : undefined}
    style={state => [styles.row, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
    <Row style={{ gap: space.md }}>
      <View style={styles.iconBox}><Icon name={icon} size={19} color={color.interactiveStrong}/></View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Txt kind="label" tone="primary" numberOfLines={1}>{title}</Txt>
        {!!detail && <Txt kind="caption" numberOfLines={1} tone={unread ? 'primary' : undefined}>{detail}</Txt>}
      </View>
      {unread && <View accessibilityLabel={language === 'ar' ? 'رد جديد' : 'New reply'} style={styles.unread}/>}
      <Icon name={external ? 'external' : 'chevron'} size={16} color={color.textSecondary}/>
    </Row>
  </Pressable>;
}

export default function SupportScreen() {
  const { t, language, rtl } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const [error, setError] = useState(false);
  const { status } = useAuth();
  const care = careCopy(language);
  // The signed-in guest's conversations, and their bookings that have none yet.
  const [inbox, setInbox] = useState<{ conversations: SupportConversation[]; bookings: BookingHistoryItem[] } | null>(null);
  useFocusEffect(useCallback(() => {
    if (status !== 'signedIn') return;
    const controller = new AbortController();
    Promise.all([api.support.conversations(controller.signal).catch(() => [] as SupportConversation[]),
      api.getBookings(controller.signal).catch(() => [] as BookingHistoryItem[])])
      .then(([conversations, bookings]) => { if (!controller.signal.aborted) setInbox({ conversations: sortConversations(conversations), bookings }); });
    return () => controller.abort();
  }, [status]));
  const openCare = (reference: string) => router.push({ pathname: '/care/[reference]', params: { reference } });
  const talked = new Set(inbox?.conversations.map(row => row.reference));
  const fresh = (inbox?.bookings ?? []).filter(row => row.statusKind === 'confirmed' && !talked.has(row.reference) && /^[A-Za-z0-9_-]{1,120}$/.test(row.reference)).slice(0, 4);
  const open = async (path: '/privacy' | '/terms' | '/account-deletion') => {
    setError(false);
    try { await WebBrowser.openBrowserAsync(websiteUrl(path), { toolbarColor: color.bgBrand }); } catch { setError(true); }
  };
  const email = () => { setError(false); void Linking.openURL('mailto:' + SUPPORT_EMAIL).catch(() => setError(true)); };
  // What this build actually does: booking in the app and payment on the secure payment page,
  // or (when in-app checkout is off) booking on the website.
  const note = NATIVE_CHECKOUT_ENABLED
    ? (ar ? 'تحجز داخل التطبيق، وتدفع عبر صفحة الدفع الآمنة، وتتابع التأكيد في «رحلاتي» و«الإشعارات». إشعارات الهاتف الفورية غير متاحة بعد.'
      : 'You book in the app, pay on the secure payment page and follow the confirmation in My trips and Notifications. Push notifications on the phone are not available yet.')
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
      {status === 'signedIn' && <View testID="support-care" style={styles.care}>
        <Row style={{ gap: space.md, alignItems: 'center' }}>
          <CareMark size={48}/>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt kind="subheading" tone="onDark" accessibilityRole="header">{care.brand}</Txt>
            <Txt kind="caption" tone="onDarkMuted">{ar ? 'محادثة خاصة لكل حجز، والرد يصلك هنا.' : 'A private conversation per booking; replies arrive here.'}</Txt>
          </View>
        </Row>
      </View>}
      {status === 'signedIn' && (inbox === null ? <Skeleton height={120} rounded={radius.lg}/> : <>
        {inbox.conversations.length > 0 && section(ar ? 'محادثاتك' : 'Your conversations', inbox.conversations.map((row, index) => <React.Fragment key={row.id}>
          {index > 0 && rule}
          <SupportRow testID="support-conversation" icon="chat" title={row.hotelName || row.reference} unread={row.unread}
            detail={row.unread ? care.status.waiting + (row.lastMessage ? ' · ' + row.lastMessage : '') : row.lastMessage || care.status[row.status]}
            onPress={() => openCare(row.reference)}/>
        </React.Fragment>))}
        {fresh.length > 0 && section(ar ? 'اسأل عن حجز' : 'Ask about a booking', fresh.map((row, index) => <React.Fragment key={row.reference}>
          {index > 0 && rule}
          <SupportRow testID="support-start" icon="trips" title={row.hotelName || row.reference}
            detail={ar ? 'ابدأ محادثة عن هذا الحجز' : 'Start a conversation about this booking'} onPress={() => openCare(row.reference)}/>
        </React.Fragment>))}
      </>)}
      {section(ar ? 'تواصل معنا' : 'Contact us', <>
        <SupportRow testID="support-email" icon="mail" title={t('contactEmail')} detail={SUPPORT_EMAIL} onPress={email} external/>
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
  care: { padding: space.md, borderRadius: radius.xl, backgroundColor: color.bgBrand },
  unread: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.accent },
});
