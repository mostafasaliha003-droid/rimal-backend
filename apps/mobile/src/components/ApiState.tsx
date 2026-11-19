import React from 'react';
import { View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { ApiError } from '../api';
import { useLanguage } from '../i18n';
import { space } from '../theme';
import { Button, StatePanel, type IconName } from './Primitives';
import { useAuth } from '../auth';
import { membershipPresentation } from './foundationContracts';

/** Each failure says what happened and what the traveler can do now. Search details are always kept. */
export default function ApiState({ error, retry }: { error: unknown; retry: () => void }) {
  const { t, rtl } = useLanguage();
  const { status, error: sessionError } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const failure = error instanceof ApiError ? error : null;
  const membership = failure?.kind === 'membership';
  if (!membership && failure?.kind !== 'auth') {
    const kind = failure?.kind;
    const view: { icon: IconName; tone: 'warning' | 'danger' | 'neutral'; title: string; body: string } =
      kind === 'network' ? { icon: 'offline', tone: 'warning', title: rtl ? 'لا يوجد اتصال بالإنترنت' : 'No internet connection',
        body: rtl ? 'تحقق من الشبكة ثم أعد المحاولة. نحتفظ بوجهتك وتواريخك وضيوفك.' : 'Check your connection and try again. Your destination, dates and guests are kept.' }
      : kind === 'timeout' ? { icon: 'clock', tone: 'warning', title: rtl ? 'استغرق الرد وقتاً أطول من المعتاد' : 'This is taking longer than usual',
        body: rtl ? 'لم يصل رد المورّد في الوقت المتوقع. أعد المحاولة بعد لحظة.' : 'The supplier did not respond in time. Try again in a moment.' }
      : failure?.status === 429 || kind === 'rate_limit' ? { icon: 'hourglass', tone: 'neutral', title: rtl ? 'طلبات كثيرة في وقت قصير' : 'Too many requests', body: t('rateLimited') }
      : { icon: 'alertCircle', tone: 'danger', title: t('resultsError'),
        body: rtl ? 'حدث خطأ أثناء جلب البيانات. أعد المحاولة؛ إن تكرر الأمر تواصل مع الدعم.' : 'Something went wrong while loading. Try again; if it keeps happening, contact support.' };
    return <View style={{ gap: space.md }}>
      <StatePanel testID={`api-state-${kind || 'unknown'}`} icon={view.icon} tone={view.tone} title={view.title} body={view.body} retry={retry}/>
      {kind !== 'network' && kind !== 'timeout' && <Button variant="quiet" icon="support" title={t('support')} onPress={() => router.push('/support')}/>}
    </View>;
  }
  if (status === 'loading') return <StatePanel title={t('accountChecking')} busy/>;
  const next = membershipPresentation(failure?.status, status === 'signedIn');
  const expired = next === 'signin' && sessionError?.code === 'session_expired';
  const title = expired ? t('sessionExpired') : next === 'signin' ? t('signIn') : next === 'approval' ? t('membershipTitle')
    : rtl ? 'تعذّر التحقق من العضوية' : 'Could not verify membership';
  const body = next === 'signin' ? (rtl ? 'سجّل الدخول للمتابعة، وسيُستأنف بحثك تلقائياً.' : 'Sign in to continue. Your search will resume automatically.')
    : next === 'approval' ? (rtl ? 'أسعار الفنادق متاحة للأعضاء المعتمدين. اطّلع على حالة عضويتك وشروط الانضمام.' : 'Hotel prices are available to approved members. Check your membership status and how to join.')
      : (rtl ? 'أعد المحاولة للتحقق من إمكانية استخدام حسابك الحالي.' : 'Try again to check access for your signed-in account.');
  return <View style={{ gap: space.md }}>
    <StatePanel testID={`api-state-${next}`} icon={next === 'signin' ? 'lock' : 'sparkles'} tone="neutral" title={title} body={body} retry={next === 'signin' ? undefined : retry}/>
    {next === 'signin' ? <Button icon="account" title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: pathname } })}/>
      : <Button variant="secondary" icon="sparkles" title={rtl ? 'عرض حالة العضوية' : 'View membership status'} onPress={() => router.push('/membership')}/>}
    {next === 'approval' && <Button variant="quiet" icon="support" title={t('support')} onPress={() => router.push('/support')}/>}
  </View>;
}
