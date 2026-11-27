import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, ApiError, authSession, websiteUrl } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, colors, fonts, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Button, Field, Row, StatePanel, Txt } from '../components/Primitives';
import { utcTimestamp } from '../components/Cancellation';

type Owner = Pick<ReturnType<typeof useAuth>, 'status' | 'sessionRevision'> & { email?: string };
type DeletionRequest = Awaited<ReturnType<typeof api.getAccountDeletionRequest>>['request'];
type RequestView = { phase: 'loading' | 'ready' | 'error' | 'uncertain'; request: DeletionRequest; error: unknown };

export default function AccountDeletionScreen() {
  const { status, sessionRevision, user } = useAuth();
  return <AccountDeletionContents key={`${status}:${sessionRevision}`} status={status} sessionRevision={sessionRevision} email={user?.email}/>;
}

function AccountDeletionContents({ status, sessionRevision, email }: Owner) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const signedIn = status === 'signedIn' && Boolean(email);
  const [view, setView] = useState<RequestView>({ phase: signedIn ? 'loading' : 'ready', request: null, error: null });
  const [refresh, setRefresh] = useState(0);
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<'deletionPasswordRequired' | 'deletionPasswordError' | null>(null);
  const [websiteError, setWebsiteError] = useState(false);
  const read = useRef<AbortController | null>(null);
  const post = useRef<AbortController | null>(null);
  const currentOwner = useCallback(() => status === 'signedIn' && authSession.getSnapshot().status === 'signedIn'
    && authSession.getRevision() === sessionRevision, [status, sessionRevision]);

  useEffect(() => {
    if (!signedIn || !currentOwner()) return;
    const controller = new AbortController(); read.current = controller;
    api.getAccountDeletionRequest(controller.signal).then(reply => {
      if (!controller.signal.aborted && read.current === controller && currentOwner()) setView({ phase: 'ready', request: reply.request, error: null });
    }).catch(error => {
      if (!controller.signal.aborted && read.current === controller && currentOwner()) setView({ phase: 'error', request: null, error });
    });
    return () => { controller.abort(); if (read.current === controller) read.current = null; };
  }, [signedIn, currentOwner, refresh]);
  useEffect(() => () => { post.current?.abort(); post.current = null; }, []);

  const checkStatus = () => {
    if (!currentOwner() || post.current) return;
    read.current?.abort(); setPassword(''); setConsent(false); setFormError(null);
    setView({ phase: 'loading', request: null, error: null }); setRefresh(value => value + 1);
  };
  const submit = async () => {
    if (!currentOwner() || post.current || view.phase !== 'ready' || view.request) return;
    if (!password || !consent) { setFormError('deletionPasswordRequired'); return; }
    const controller = new AbortController(); post.current = controller;
    read.current?.abort(); setSubmitting(true); setFormError(null);
    const secret = password;
    setPassword(''); setConsent(false);
    try {
      const reply = await api.requestAccountDeletion(secret, controller.signal);
      if (controller.signal.aborted || post.current !== controller || !currentOwner()) return;
      if (!reply.request || reply.dataDeleted !== false) throw new ApiError('invalid_response', 'invalid_deletion_response');
      setView({ phase: 'ready', request: reply.request, error: null });
    } catch (error) {
      if (controller.signal.aborted || post.current !== controller || !currentOwner()) return;
      if (error instanceof ApiError && error.code === 'reauthentication_failed') {
        setView({ phase: 'ready', request: null, error: null }); setFormError('deletionPasswordError');
      } else setView({ phase: 'uncertain', request: null, error });
    } finally {
      if (post.current === controller) {
        post.current = null;
        if (!controller.signal.aborted && currentOwner()) setSubmitting(false);
      }
    }
  };
  const openWebsite = async (page: '/account-deletion' | '/privacy') => {
    setWebsiteError(false);
    try { await WebBrowser.openBrowserAsync(websiteUrl(page), { toolbarColor: colors.navy }); }
    catch { setWebsiteError(true); }
  };
  const unavailable = view.error instanceof ApiError && (view.error.status === 404 || view.error.status === 503
    || view.error.code === 'account_deletion_unavailable');
  const errorCopy = unavailable ? 'deletionUnavailable' : view.phase === 'uncertain' ? 'deletionUnknownOutcome' : 'deletionCheckError';
  const receipt = view.request;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
        <View style={{ gap: 10 }}><Txt accessibilityRole="header" kind="title">{t('accountDeletion')}</Txt><Txt>{t('deletionIntro')}</Txt></View>
        <View style={[ui.card, { backgroundColor: colors.softGold }]}><Txt>{t('deletionScope')}</Txt></View>
        {status === 'loading' ? <StatePanel title={t('accountChecking')} busy/> : !signedIn ? <><StatePanel title={t('deletionSignIn')}/><Button title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: '/account-deletion' } })}/></> : <>
          <View style={ui.card}><Txt kind="label">{t('deletionAccount')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{email}</Txt></View>
          {view.phase === 'loading' ? <StatePanel title={t('loading')} busy/> : receipt ? <View style={[ui.card, { backgroundColor: colors.softBlue }]} accessibilityLiveRegion="polite">
            <Txt accessibilityRole="header" kind="heading">{t('deletionReceivedTitle')}</Txt><Txt>{t('deletionReceivedBody')}</Txt>
            <View style={ui.rule}/><Txt kind="label">{t('deletionStatus')}</Txt><Txt style={{ color: colors.blueStrong, fontFamily: fonts.bold }}>{t('deletionRequested')}</Txt>
            <Txt kind="label">{t('deletionReference')}</Txt><Txt selectable style={{ writingDirection: 'ltr' }}>{receipt.reference}</Txt>
            <Txt kind="label">{t('deletionRequestedAt')}</Txt><Txt>{utcTimestamp(receipt.requestedAt, language) || receipt.requestedAt}</Txt>
            <Button variant="secondary" title={t('deletionRefresh')} onPress={checkStatus}/>
          </View> : view.phase === 'error' || view.phase === 'uncertain' ? <View style={{ gap: 12 }}><Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(errorCopy)}</Txt><Button variant="secondary" title={t('deletionRefresh')} onPress={checkStatus}/></View> : <View style={ui.card}>
            <Txt kind="heading" accessibilityRole="header">{t('deletionNoRequest')}</Txt><Txt kind="small">{t('deletionNoRequestBody')}</Txt>
            <Field label={t('deletionPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" maxLength={256} editable={!submitting}/>
            <Pressable accessible accessibilityRole="checkbox" aria-checked={consent} accessibilityLabel={t('deletionConsent')} accessibilityState={{ checked: consent, disabled: submitting }} disabled={submitting} onPress={() => setConsent(value => !value)} style={{ minHeight: 56, padding: 14, borderWidth: 1, borderRadius: 14, borderColor: consent ? colors.blueStrong : colors.border, backgroundColor: consent ? colors.softBlue : colors.background }}>
              <Row style={{ alignItems: 'flex-start' }}><View accessible={false} style={{ width: 24, height: 24, borderWidth: 2, borderRadius: 5, borderColor: colors.blueStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: consent ? colors.blueStrong : color.bgSurface }}><Txt accessible={false} style={{ color: color.onInteractive, fontSize: 16, lineHeight: 20 }}>{consent ? '✓' : ''}</Txt></View><Txt style={{ flex: 1 }}>{t('deletionConsent')}</Txt></Row>
            </Pressable>
            {formError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(formError)}</Txt>}
            <Button variant="danger" title={t(submitting ? 'deletionSubmitting' : 'deletionSubmit')} disabled={!password || !consent} busy={submitting} onPress={() => void submit()}/>
          </View>}
        </>}
        <View style={ui.card}><Txt>{t('deletionWebBody')}</Txt><Button variant="secondary" title={t('deletionWeb')} onPress={() => void openWebsite('/account-deletion')}/><Button variant="quiet" title={t('privacy')} onPress={() => void openWebsite('/privacy')}/></View>
        {websiteError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('websiteError')}</Txt>}
        <Button variant="quiet" title={t('support')} onPress={() => router.push('/support')}/>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
