import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import type { OwnedNotice } from '../api/notifications';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Button, StatePanel, Txt } from '../components/Primitives';
import { statusText } from '../components/membershipCopy';

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
  return <SafeAreaView style={ui.screen}><BrandHeader back/><ScrollView contentContainerStyle={ui.page}>
    <Txt kind="title" accessibilityRole="header">{title}</Txt>
    {loading || signedIn && result?.attempt !== attempt ? <StatePanel title={t('loading')} busy/> :
      !signedIn ? <Button title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: '/notifications' } })}/> :
      !result?.rows ? <StatePanel title={rtl ? 'تعذّر تحميل الإشعارات' : 'Notifications unavailable'} retry={refresh}/> :
      <>{!result.rows.length && <StatePanel title={rtl ? 'لا توجد إشعارات حتى الآن' : 'No notifications yet'}/>}
        {result.rows.map(row => <View key={row.id} style={ui.card}>
          <Txt kind="heading">{row.event === 'confirmed' ? (rtl ? 'تم تأكيد حجزك' : 'Booking confirmed') :
            row.event === 'refunded' ? (rtl ? 'تم التحقق من الاسترداد' : 'Refund verified') : statusText[row.event][rtl ? 0 : 1]}</Txt>
          {row.at && <Txt kind="small">{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.at))}</Txt>}
          <Button variant="quiet" title={row.kind === 'booking' ? t('trips') : (rtl ? 'العضوية' : 'Membership')}
            onPress={() => router.navigate(row.kind === 'booking' ? '/bookings' : '/membership')}/>
        </View>)}
        <Button variant="quiet" title={rtl ? 'تحديث' : 'Refresh'} onPress={refresh}/>
      </>}
  </ScrollView></SafeAreaView>;
}
export default function Notifications() {
  const { status, sessionRevision } = useAuth();
  return <NoticeList key={String(sessionRevision) + status} signedIn={status === 'signedIn'} loading={status === 'loading'}/>;
}
