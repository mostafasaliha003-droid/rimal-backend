import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import type { OwnedNotice } from '../api/notifications';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Button, Icon, IconButton, Row, Skeleton, Txt, type IconName } from '../components/Primitives';
import { statusText } from '../components/membershipCopy';

const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/** A calm full-width state: an icon in a soft circle, what this place is for, and the next step. */
function EmptyState({ icon, title, body, action, tone = 'neutral' }: {
  icon: IconName; title: string; body: string; action?: React.ReactNode; tone?: 'neutral' | 'danger';
}) {
  return <View style={styles.empty}>
    <View style={[styles.emptyIcon, tone === 'danger' && { backgroundColor: color.dangerBg }]}>
      <Icon name={icon} size={28} color={tone === 'danger' ? color.danger : color.interactiveStrong}/>
    </View>
    <Txt kind="subheading" align="center" accessibilityRole="header">{title}</Txt>
    <Txt kind="small" align="center">{body}</Txt>
    {action}
  </View>;
}

function NoticeList({ signedIn, loading }: { signedIn: boolean; loading: boolean }) {
  const { language, rtl, t } = useLanguage(), router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; rows: OwnedNotice[] | null } | null>(null);
  useFocusEffect(useCallback(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    api.getNotices(controller.signal).then(rows => { if (!controller.signal.aborted) setResult({ attempt, rows }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ attempt, rows: null }); });
    return () => controller.abort();
  }, [signedIn, attempt]));
  const title = rtl ? 'الإشعارات' : 'Notifications';
  const refresh = () => setAttempt(value => value + 1);
  const pending = loading || signedIn && result?.attempt !== attempt;
  const rows = !pending && signedIn ? result?.rows : undefined;
  // Each notice is one row: what happened, when, and where it leads.
  const notice = (row: OwnedNotice) => {
    const booking = row.kind === 'booking';
    const headline = row.event === 'confirmed' ? (rtl ? 'تم تأكيد حجزك' : 'Booking confirmed')
      : row.event === 'refunded' ? (rtl ? 'تم التحقق من الاسترداد' : 'Refund verified') : statusText[row.event][rtl ? 0 : 1];
    const icon: IconName = row.event === 'confirmed' ? 'checkCircle' : row.event === 'refunded' ? 'wallet' : 'users';
    const tint = row.event === 'confirmed' ? color.success : color.interactiveStrong;
    const when = row.at ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.at)) : '';
    const where = booking ? t('trips') : (rtl ? 'العضوية' : 'Membership');
    return <Pressable key={row.id} testID={'notice-' + row.id} accessibilityRole="button" accessibilityLabel={[headline, when, where].filter(Boolean).join(' · ')}
      onPress={() => router.navigate(booking ? '/bookings' : '/membership')}
      style={state => [styles.row, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
      <Row style={{ gap: space.md }}>
        <View style={[styles.rowIcon, row.event === 'confirmed' && { backgroundColor: color.successBg }]}><Icon name={icon} size={18} color={tint}/></View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Txt kind="label" tone="primary" numberOfLines={2}>{headline}</Txt>
          <Txt kind="caption" numberOfLines={1}>{[when, where].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Icon name="chevron" size={16} color={color.textSecondary}/>
      </Row>
    </Pressable>;
  };

  return <SafeAreaView style={ui.screen}><BrandHeader back/><ScrollView contentContainerStyle={[ui.page, { gap: space.md }]}>
    <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
      <Txt kind="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Txt>
      {signedIn && !pending && <IconButton icon="refresh" testID="notices-refresh" label={rtl ? 'تحديث الإشعارات' : 'Refresh notifications'} onPress={refresh}/>}
    </Row>
    {pending ? <View style={styles.menu} accessibilityLabel={t('loading')}>
      {[0, 1, 2].map(index => <View key={index} style={styles.row}><Row style={{ gap: space.md }}>
        <Skeleton width={36} height={36} rounded={18}/><View style={{ flex: 1, gap: space.xs }}><Skeleton width="60%" height={14}/><Skeleton width="38%" height={11}/></View>
      </Row></View>)}
    </View> : !signedIn ? <EmptyState icon="bell" title={rtl ? 'سجّل الدخول لترى إشعاراتك' : 'Sign in to see your notifications'}
      body={rtl ? 'تأكيدات حجوزاتك وتحديثات الاسترداد وحالة طلب العضوية تظهر هنا.' : 'Booking confirmations, refund updates and your membership status appear here.'}
      action={<Button title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: '/notifications' } })}/>}/>
      : !rows ? <EmptyState icon="alertCircle" tone="danger" title={rtl ? 'تعذّر تحميل الإشعارات' : 'Notifications unavailable'}
        body={rtl ? 'تحقق من الاتصال ثم حاول مجدداً.' : 'Check your connection and try again.'}
        action={<Button variant="secondary" icon="refresh" title={t('retry')} onPress={refresh}/>}/>
        : !rows.length ? <EmptyState icon="bell" title={rtl ? 'لا توجد إشعارات بعد' : 'No notifications yet'}
          body={rtl ? 'عندما يتأكد حجز أو يتم استرداد مبلغ أو تتغير حالة عضويتك، ستجد التحديث هنا.' : 'When a booking is confirmed, a refund is verified or your membership changes, the update appears here.'}
          action={<Button variant="secondary" icon="search" title={rtl ? 'استكشف الفنادق' : 'Explore hotels'} onPress={() => router.navigate('/')}/>}/>
          : <View style={styles.menu}>{rows.map((row, index) => <View key={row.id}>{index > 0 && <View style={[styles.rule, rtl ? { marginRight: 64 } : { marginLeft: 64 }]}/>}{notice(row)}</View>)}</View>}
  </ScrollView></SafeAreaView>;
}
export default function Notifications() {
  const { status, sessionRevision } = useAuth();
  return <NoticeList key={String(sessionRevision) + status} signedIn={status === 'signedIn'} loading={status === 'loading'}/>;
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.bgSelected, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  menu: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard },
  row: { minHeight: 64, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.bgSelected, alignItems: 'center', justifyContent: 'center' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.border },
});
