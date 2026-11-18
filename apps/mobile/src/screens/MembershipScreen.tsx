import React, { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api';
import type { MemberState, MemberStatus } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import MembershipApplication from '../components/MembershipApplication';
import { Button, StatePanel, Txt } from '../components/Primitives';

export const statusText: Record<MemberState, [string, string]> = {
  draft: ['طلب غير مكتمل', 'Draft application'], submitted: ['تم إرسال طلب العضوية', 'Application submitted'],
  under_review: ['طلبك قيد المراجعة', 'Application under review'], needs_information: ['نحتاج إلى معلومات إضافية', 'More information needed'],
  approved: ['عضويتك معتمدة', 'Membership approved'], rejected: ['لم يُعتمد الطلب', 'Application declined'],
  suspended: ['العضوية موقوفة', 'Membership suspended'],
};

function MembershipContent() {
  const { language, t } = useLanguage();
  const { user, status } = useAuth();
  const router = useRouter();
  const ar = language === 'ar';
  const [result, setResult] = useState<MemberStatus | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [generation, setGeneration] = useState(-1);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useFocusEffect(useCallback(() => {
    if (status === 'loading') return;
    const controller = new AbortController();
    setResult(null); setError(false);
    api.getMembershipStatus(controller.signal).then(data => { if (!controller.signal.aborted) { setGeneration(attempt); setResult(data); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt, status]));
  const statusLabel = result?.status && statusText[result.status][ar ? 0 : 1];
  const title = ar ? 'عضوية مخدة' : 'pillow stays membership';
  const needsSignIn = !user || result?.enabled && !result.authenticated;
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    <ScrollView contentContainerStyle={ui.page}>
      <Txt kind="title" accessibilityRole="header">{title}</Txt>
      {error ? <StatePanel title={ar ? 'تعذّر تحميل حالة العضوية' : 'Membership status unavailable'} retry={retry}/> :
        !result || generation !== attempt ? <StatePanel title={t('loading')} busy/> :
        !result.enabled ? <StatePanel title={ar ? 'خدمة العضوية غير متاحة حالياً' : 'Membership is currently unavailable'} retry={retry}/> :
        needsSignIn ? <View style={ui.card}><Txt>{ar ? 'سجّل الدخول لمتابعة طلبك والاطلاع على تحديثاته.' : 'Sign in to apply and check your membership updates.'}</Txt>
          <Button title={t('signIn')} onPress={() => router.navigate('/account')}/></View> :
        <View style={ui.card}>
          <Txt kind="heading">{statusLabel || (ar ? 'طلب العضوية' : 'Apply for membership')}</Txt>
          {!!result.note && <Txt>{result.note}</Txt>}
          {result.canAccess ? <Button title={t('search')} onPress={() => router.navigate('/')}/> :
            !result.status || ['draft', 'needs_information'].includes(result.status) ? <MembershipApplication initial={result} finished={retry}/> : <Button variant="secondary" title={t('support')} onPress={() => router.push('/support')}/>}
          <Button variant="quiet" title={ar ? 'تحديث الحالة' : 'Refresh status'} onPress={retry}/>
        </View>}
    </ScrollView>
  </SafeAreaView>;
}

export default function MembershipScreen() {
  const { sessionRevision, status } = useAuth();
  return <MembershipContent key={String(sessionRevision) + status}/>;
}
