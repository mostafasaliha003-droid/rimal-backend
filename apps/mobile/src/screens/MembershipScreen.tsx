import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { api, websiteUrl } from '../api';
import type { MemberState, MemberStatus } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, layout, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import MembershipApplication from '../components/MembershipApplication';
import { Badge, Button, Card, Icon, Notice, Row, StatePanel, Txt, type BadgeTone, type IconName } from '../components/Primitives';
import { statusText } from '../components/membershipCopy';
import { reportMembership } from '../components/MemberAccess';
import { useLayout } from '../components/motion';

const stateTone: Record<MemberState, { tone: BadgeTone; icon: IconName }> = {
  draft: { tone: 'neutral', icon: 'edit' }, submitted: { tone: 'warning', icon: 'hourglass' }, under_review: { tone: 'warning', icon: 'hourglass' },
  needs_information: { tone: 'warning', icon: 'alert' }, approved: { tone: 'success', icon: 'badgeCheck' }, rejected: { tone: 'danger', icon: 'alertCircle' },
  suspended: { tone: 'danger', icon: 'lock' },
};

function Step({ number, title, body, done = false }: { number: number; title: string; body: string; done?: boolean }) {
  return <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
    <View style={[styles.step, done && { backgroundColor: color.success, borderColor: color.success }]}>
      {done ? <Icon name="check" size={14} strokeWidth={3} color={color.onInteractive}/> : <Txt kind="label" style={{ color: color.interactiveStrong }}>{number}</Txt>}
    </View>
    <View style={{ flex: 1, gap: space.xxs }}><Txt kind="label">{title}</Txt><Txt kind="small">{body}</Txt></View>
  </Row>;
}

function MembershipContent() {
  const { language, t } = useLanguage();
  const { user, status } = useAuth();
  const router = useRouter();
  const { gutter } = useLayout();
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
    api.getMembershipStatus(controller.signal).then(data => { if (!controller.signal.aborted) { setGeneration(attempt); setResult(data); reportMembership(data); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt, status]));
  const needsSignIn = !user || result?.enabled && !result.authenticated;
  const state = result?.status ?? null;
  const submittedOrLater = state !== null && state !== 'draft';

  const intro = <Card style={{ gap: space.md }}>
    <Txt kind="subheading" accessibilityRole="header">{ar ? 'من يمكنه الانضمام' : 'Who can join'}</Txt>
    <Row style={{ gap: space.md, alignItems: 'flex-start' }}><Icon name="globe" size={20} color={color.interactiveStrong}/>
      <View style={{ flex: 1, gap: space.xxs }}><Txt kind="label">{ar ? 'مواطنو دول مجلس التعاون الخليجي' : 'GCC citizens'}</Txt>
        <Txt kind="small">{ar ? 'الوثيقة المطلوبة: جواز السفر.' : 'Document needed: passport.'}</Txt></View></Row>
    <Row style={{ gap: space.md, alignItems: 'flex-start' }}><Icon name="badgeCheck" size={20} color={color.interactiveStrong}/>
      <View style={{ flex: 1, gap: space.xxs }}><Txt kind="label">{ar ? 'المهنيون المقيمون في الإمارات' : 'Professionals resident in the UAE'}</Txt>
        <Txt kind="small">{ar ? 'الوثائق المطلوبة: الهوية الإماراتية (الوجهان) والمسمى المهني كما يظهر عليها.' : 'Documents needed: Emirates ID (both sides) and your job title as printed on it.'}</Txt></View></Row>
    <Notice tone="info" icon="shield" title={ar ? 'لماذا نطلب وثيقة؟' : 'Why we ask for a document'}
      body={ar ? 'أسعار الأعضاء مخصصة لفئات محددة. نستخدم الوثيقة للتحقق من أهليتك فقط، وفق سياسة الخصوصية. صور JPG أو PNG حتى 5 ميغابايت.'
        : 'Member rates are limited to eligible travelers. Your document is used only to check eligibility, under our privacy policy. JPG or PNG up to 5 MB.'}>
      <Button compact variant="quiet" icon="external" title={t('privacy')} onPress={() => { void WebBrowser.openBrowserAsync(websiteUrl('/privacy')).catch(() => {}); }}/>
    </Notice>
  </Card>;

  const steps = <Card style={{ gap: space.md }}>
    <Txt kind="subheading" accessibilityRole="header">{ar ? 'كيف تعمل العضوية' : 'How it works'}</Txt>
    <Step number={1} done={Boolean(result?.details)} title={ar ? 'بيانات الأهلية' : 'Eligibility details'} body={ar ? 'اختر فئتك وجنسيتك.' : 'Choose your category and nationality.'}/>
    <Step number={2} done={submittedOrLater} title={ar ? 'رفع الوثائق' : 'Upload documents'} body={ar ? 'صورة واضحة لكل وثيقة مطلوبة.' : 'A clear photo of each required document.'}/>
    <Step number={3} done={submittedOrLater} title={ar ? 'المراجعة والإرسال' : 'Review and submit'} body={ar ? 'تأكد من البيانات ووافق على استخدام الوثائق للتحقق.' : 'Check your details and consent to the eligibility check.'}/>
    <Step number={4} done={state === 'approved'} title={ar ? 'نراجع طلبك ونخطرك' : 'We review and notify you'} body={ar ? 'تظهر النتيجة هنا وفي الإشعارات. لا حاجة لإعادة الإرسال.' : 'The outcome appears here and in notifications. No need to resubmit.'}/>
  </Card>;

  const stateCard = !result || !state ? null : <Card testID={`membership-state-${state}`} elevated style={{ gap: space.md }}>
    <Badge tone={stateTone[state].tone} icon={stateTone[state].icon} label={statusText[state][ar ? 0 : 1]}/>
    {state === 'approved' ? <>
      <Txt kind="heading">{ar ? 'أسعار الأعضاء متاحة لك' : 'Member rates are available to you'}</Txt>
      <Txt kind="small" tone="primary">{ar ? 'ابحث كالمعتاد؛ تظهر لك أسعار الأعضاء وشروطها قبل الحجز.' : 'Search as usual; member prices and their terms show before you book.'}</Txt>
      <Button icon="search" title={t('search')} onPress={() => router.navigate('/')}/>
    </> : state === 'submitted' || state === 'under_review' ? <>
      <Txt kind="heading">{ar ? 'استلمنا طلبك وهو قيد المراجعة' : 'We received your application'}</Txt>
      <Txt kind="small" tone="primary">{ar ? 'نراجع بياناتك ووثائقك الآن. ستظهر النتيجة هنا وفي الإشعارات؛ لا تُرسل الطلب مرة أخرى.' : 'We are reviewing your details and documents. The outcome will appear here and in notifications; there is no need to resubmit.'}</Txt>
      <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}><Button variant="secondary" icon="bell" title={ar ? 'الإشعارات' : 'Notifications'} onPress={() => router.push('/notifications')}/></View>
        <View style={{ flexGrow: 1, flexBasis: 140 }}><Button variant="quiet" icon="support" title={t('support')} onPress={() => router.push('/support')}/></View>
      </Row>
    </> : state === 'needs_information' ? <>
      <Txt kind="heading">{ar ? 'أكمل طلبك' : 'Complete your application'}</Txt>
      <Notice tone="warning" title={ar ? 'ملاحظة فريق المراجعة' : 'Note from the review team'} body={result.note || (ar ? 'نحتاج معلومات أو وثيقة إضافية. راجع الخطوات أدناه.' : 'We need more information or another document. Review the steps below.')}/>
    </> : state === 'rejected' || state === 'suspended' ? <>
      {!!result.note && <Txt kind="small" tone="primary">{result.note}</Txt>}
      <Txt kind="small" tone="primary">{ar ? 'تواصل مع الدعم إن كانت لديك أسئلة حول هذا القرار.' : 'Contact support if you have questions about this decision.'}</Txt>
      <Button variant="secondary" icon="support" title={t('support')} onPress={() => router.push('/support')}/>
    </> : null}
  </Card>;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.page, { paddingHorizontal: gutter }]}>
      <View style={{ gap: space.xs }}>
        <Txt kind="title" accessibilityRole="header">{ar ? 'عضوية مخدة' : 'Mkhadda membership'}</Txt>
        <Txt kind="body" tone="secondary">{ar ? 'أسعار خاصة للأعضاء المعتمدين، بشروط واضحة قبل الحجز.' : 'Private rates for approved members, with clear terms before you book.'}</Txt>
      </View>
      {error ? <StatePanel icon="offline" title={ar ? 'تعذّر تحميل حالة العضوية' : 'Membership status unavailable'} body={t('networkError')} retry={retry}/> :
        !result || generation !== attempt ? <StatePanel title={t('loading')} busy/> :
        !result.enabled ? <StatePanel icon="info" title={ar ? 'خدمة العضوية غير متاحة حالياً' : 'Membership is currently unavailable'} retry={retry}/> :
        needsSignIn ? <>{intro}{steps}<Card style={{ gap: space.md }}>
          <Txt kind="subheading">{ar ? 'ابدأ بتسجيل الدخول' : 'Start by signing in'}</Txt>
          <Txt kind="small" tone="primary">{ar ? 'نربط طلب العضوية بحسابك لتتابع حالته من أي جهاز.' : 'Your application is linked to your account so you can follow it from any device.'}</Txt>
          <Button icon="account" title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: '/membership' } })}/></Card></> :
        <>
          {stateCard}
          {(!state || state === 'draft' || state === 'needs_information') && <>
            {!state && intro}
            <Card style={{ gap: space.md }}>
              <Txt kind="subheading" accessibilityRole="header">{state === 'needs_information' ? (ar ? 'حدّث طلبك' : 'Update your application') : (ar ? 'طلب العضوية' : 'Membership application')}</Txt>
              <MembershipApplication initial={result} finished={retry}/>
            </Card>
          </>}
          {state !== 'approved' && steps}
          <Button variant="quiet" icon="refresh" title={ar ? 'تحديث الحالة' : 'Refresh status'} onPress={retry}/>
        </>}
    </ScrollView>
  </SafeAreaView>;
}

export default function MembershipScreen() {
  const { sessionRevision, status } = useAuth();
  return <MembershipContent key={String(sessionRevision) + status}/>;
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: layout.maxReading, alignSelf: 'center', paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.lg },
  step: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.interactive, alignItems: 'center', justifyContent: 'center' },
});
