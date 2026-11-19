import React from 'react';
import { View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { ApiError } from '../api';
import { useLanguage } from '../i18n';
import { Button, StatePanel } from './Primitives';
import { useAuth } from '../auth';
import { membershipPresentation } from './foundationContracts';

export default function ApiState({ error, retry }: { error: unknown; retry: () => void }) {
  const { t, rtl } = useLanguage();
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const failure = error instanceof ApiError ? error : null;
  const membership = failure?.kind === 'membership';
  if (!membership && failure?.kind !== 'auth') {
    return <StatePanel title={t('resultsError')} body={t(failure?.status === 429 ? 'rateLimited' : 'networkError')} retry={retry}/>;
  }
  if (status === 'loading') return <StatePanel title={t('accountChecking')} busy/>;
  const next = membershipPresentation(failure?.status, status === 'signedIn');
  const title = next === 'signin' ? t('signIn') : next === 'approval' ? t('membershipTitle')
    : rtl ? 'تعذّر التحقق من العضوية' : 'Could not verify membership';
  const body = next === 'signin' ? (rtl ? 'سجّل الدخول للمتابعة، وسيُستأنف بحثك تلقائياً.' : 'Sign in to continue. Your search will resume automatically.')
    : next === 'approval' ? (rtl ? 'اطّلع على حالة عضويتك لمعرفة إمكانية الوصول إلى أسعار الفنادق.' : 'View your membership status to check your access to hotel prices.')
      : (rtl ? 'أعد المحاولة للتحقق من إمكانية استخدام حسابك الحالي.' : 'Try again to check access for your signed-in account.');
  return <View style={{ gap: 12 }}>
    <StatePanel title={title} body={body} retry={next === 'signin' ? undefined : retry}/>
    {next === 'signin' ? <Button title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: pathname } })}/>
      : <Button variant="secondary" title={rtl ? 'عرض حالة العضوية' : 'View membership status'} onPress={() => router.push('/membership')}/>}
    {next === 'approval' && <Button variant="quiet" title={t('support')} onPress={() => router.push('/support')}/>}
  </View>;
}
