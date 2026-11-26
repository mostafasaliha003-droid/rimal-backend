import React, { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, websiteUrl } from '../api';
import { ApiError } from '../api/errors';
import type { MemberStatus } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, colors, ui } from '../theme';
import BrandHeader, { AccountAvatar } from '../components/BrandHeader';
import { Button, Chip, Field, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import { afterSignInRoute, normalizeVerificationCode, registrationFormReady } from '../components/foundationContracts';
import { statusText } from '../components/membershipCopy';
import { reportMembership } from '../components/MemberAccess';

function AccountLink({ title, icon, onPress, hint, disabled }: {
  title: string; icon: React.ComponentProps<typeof Icon>['name']; onPress: () => void; hint?: string; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} disabled={disabled}
    accessibilityState={{ disabled: Boolean(disabled) }} onPress={onPress}
    style={({ pressed }) => [accountStyles.link, pressed && { backgroundColor: colors.lavenderMist }]}>
    <Row><View style={accountStyles.linkIcon}><Icon name={icon} size={18} color={colors.violetInk}/></View>
      <View style={{ flex: 1 }}><Txt kind="label">{title}</Txt>{hint && <Txt kind="small">{hint}</Txt>}</View>
      <Icon name="chevron" size={14} color={colors.muted}/>
    </Row>
  </Pressable>;
}

/** Language choice as two clear options; the header no longer carries it on every screen. */
function LanguageChoice() {
  const { language, setLanguage } = useLanguage();
  const ar = language === 'ar';
  return <View testID="account-language" style={accountStyles.menu}>
    <Row style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={ar ? 'اللغة · Language' : 'Language · اللغة'}>
      <Icon name="globe" size={18} color={color.textSecondary}/>
      {(['ar', 'en'] as const).map(code => <View key={code} style={{ flex: 1 }}>
        <Chip role="radio" testID={'account-language-' + code} selected={language === code} label={code === 'ar' ? 'العربية' : 'English'}
          onPress={() => setLanguage(code)}/>
      </View>)}
    </Row>
  </View>;
}

function AccountMembership() {
  const { language } = useLanguage();
  const router = useRouter();
  const ar = language === 'ar';
  const [membership, setMembership] = useState<MemberStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const check = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setMembership(null);
    setFailed(false);
    api.getMembershipStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) { setMembership(value); reportMembership(value); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
  }, []);
  useFocusEffect(useCallback(() => {
    check();
    return () => inFlight.current?.abort();
  }, [check]));
  let detail = ar ? 'جارٍ التحقق من حالة العضوية' : 'Checking membership';
  if (failed || membership && (!membership.enabled || !membership.authenticated)) {
    detail = ar ? 'تعذّر التحقق من حالة العضوية' : 'Membership status unavailable';
  } else if (membership) {
    detail = membership.status ? statusText[membership.status][ar ? 0 : 1] : ar ? 'تقديم طلب العضوية' : 'Apply for membership';
  }
  return <View style={accountStyles.member}><Pressable testID="account-membership" accessibilityRole="button" onPress={() => router.push('/membership')} style={{ minHeight: 56, justifyContent: 'center' }}>
    <Row><View style={accountStyles.memberIcon}><Icon name={membership?.canAccess ? 'check' : 'users'} size={19} color={colors.leafInk}/></View><View style={{ flex: 1, gap: 2 }}>
      <Txt kind="label">{ar ? 'عضوية مخدة' : 'Pillow stays membership'}</Txt>
      <Txt kind="small" accessibilityLiveRegion="polite" style={membership?.canAccess ? { color: colors.success } : undefined}>{detail}</Txt>
    </View><Icon name="chevron" size={18}/></Row>
  </Pressable>
    {(failed || membership && (!membership.enabled || !membership.authenticated)) &&
      <Button compact variant="secondary" title={ar ? 'إعادة التحقق من العضوية' : 'Check membership again'} onPress={check}/>}
  </View>;
}

export default function AccountScreen() {
  const {user,status,sessionRevision,error:sessionError,restorePending,signIn,requestRegistration,verifyRegistration,requestPasswordReset,resetPassword,signOut,refresh}=useAuth(); const {t,language}=useLanguage(); const router=useRouter();
  const navigation = useNavigation();
  const { returnTo, mode: requestedMode } = useLocalSearchParams<{ returnTo?: string; mode?: string }>();
  const [mode,setMode]=useState<'login'|'register'|'verify'|'forgot'|'reset'>(requestedMode === 'register' ? 'register' : 'login');
  // The welcome front opens this screen straight on "create an account" or "sign in".
  const [modeRequest, setModeRequest] = useState(requestedMode);
  if (requestedMode !== modeRequest) { setModeRequest(requestedMode); if (requestedMode === 'register' || requestedMode === 'login') setMode(requestedMode); } const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [code,setCode]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const ar = language === 'ar';
  const resetCopy = {
    forgot: ar ? 'نسيت كلمة المرور؟' : 'Forgot your password?',
    forgotTitle: ar ? 'لنرجعك إلى حسابك' : 'Let’s get you back in',
    forgotBody: ar ? 'اكتب بريدك الإلكتروني ونرسل لك رمزاً من 6 أرقام لتعيين كلمة مرور جديدة.' : 'Enter your email and we’ll send a 6-digit code to set a new password.',
    send: ar ? 'أرسل الرمز' : 'Send the code',
    sent: ar ? 'إذا كان هذا البريد مسجّلاً لدينا، فقد أرسلنا إليه رمزاً صالحاً لمدة 10 دقائق.' : 'If this address has an account, we’ve sent it a code that works for 10 minutes.',
    newPassword: ar ? 'كلمة المرور الجديدة' : 'New password',
    save: ar ? 'احفظ وادخل' : 'Save and sign in',
    resend: ar ? 'أرسل رمزاً جديداً' : 'Send a new code',
    resent: ar ? 'طلبنا رمزاً جديداً. قد يستغرق وصوله دقيقة.' : 'We’ve asked for a new code. It may take a minute to arrive.',
    back: ar ? 'العودة لتسجيل الدخول' : 'Back to sign in',
    badCode: ar ? 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.' : 'That code is wrong or has expired. Ask for a new one.',
    tooMany: ar ? 'محاولات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.' : 'Too many tries. Wait a few minutes and try again.',
    mailDown: ar ? 'تعذّر إرسال البريد الآن. حاول بعد قليل.' : 'We couldn’t send the email right now. Try again shortly.',
    enterEmail: ar ? 'أدخل بريدك الإلكتروني.' : 'Enter your email address.',
    everywhere: ar ? 'بعد الحفظ نُخرج حسابك من الأجهزة الأخرى حفاظاً على أمانه.' : 'Saving signs your account out on every other device, to keep it safe.',
  };
  const resetError = (failure: unknown) => {
    if (!(failure instanceof ApiError)) return t('authError');
    if (failure.kind === 'rate_limit') return resetCopy.tooMany;
    if (failure.code === 'INVALID_RESET_CODE' || failure.code === 'invalid_reset_code') return resetCopy.badCode;
    if (failure.code === 'INVALID_PASSWORD' || failure.code === 'invalid_password') return t('passwordRules');
    if (failure.code === 'PASSWORD_RESET_EMAIL_UNAVAILABLE') return resetCopy.mailDown;
    if (failure.code === 'invalid_email' || failure.code === 'INVALID_EMAIL') return resetCopy.enterEmail;
    return t('authError');
  };
  const goTo = (next: typeof mode) => { setMode(next); setError(''); setNotice(''); setPassword(''); setCode(''); };
  const sendResetCode = async (again = false) => {
    if (busy) return;
    setError(''); setNotice('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError(resetCopy.enterEmail); return; }
    setBusy(true);
    try { await requestPasswordReset(email.trim()); setCode(''); setPassword(''); setMode('reset'); if (again) setNotice(resetCopy.resent); }
    catch (failure) { setError(resetError(failure)); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (busy) return;
    setError('');
    if (mode === 'login' && (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password)) { setError(t('loginRequired')); return; }
    if (mode === 'register' && !registrationFormReady(name,email,password)) { setError(t('registrationRequired')); return; }
    if (mode === 'verify' && !/^\d{6}$/.test(code)) { setError(t('code')); return; }
    if (mode === 'forgot') { await sendResetCode(); return; }
    if (mode === 'reset' && !/^\d{6}$/.test(code)) { setError(t('code')); return; }
    if (mode === 'reset' && password.length < 10) { setError(t('passwordRules')); return; }
    setBusy(true);
    try {
      if (mode === 'register') {
        await requestRegistration({ name: name.trim(), email: email.trim(), password, phone: phone.trim() });
        setPassword(''); setMode('verify');
        return;
      }
      if (mode === 'verify') await verifyRegistration(email.trim(), code);
      else if (mode === 'reset') await resetPassword(email.trim(), code, password);
      else await signIn(email.trim(), password);
      setNotice(''); setPassword(''); setCode(''); setEmail(''); setName(''); setPhone(''); setMode('login');
      if (navigation.isFocused()) {
        const destination = afterSignInRoute(returnTo);
        if (returnTo) router.setParams({ returnTo: undefined });
        if (destination === '/' || destination === '/saved' || destination === '/bookings') router.navigate(destination);
        else router.dismissTo(destination);
      }
    } catch (failure) { setError(mode === 'reset' ? resetError(failure) : t('authError')); }
    finally { setBusy(false); }
  };
  const openPolicy=async(path:'/privacy'|'/terms')=>{try{await WebBrowser.openBrowserAsync(websiteUrl(path),{toolbarColor:colors.navy});}catch{setError(t('websiteError'));}};
  const visibleError=error||(status==='signedOut'&&sessionError&&!restorePending?t('authError'):'');
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader/><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
    <Txt kind="heading" accessibilityRole="header">{t('account')}</Txt>
    {status==='signedOut'&&<LanguageChoice/>}
    {status==='signedOut'&&restorePending&&<StatePanel title={language==='ar'?'تعذّر التحقق من جلستك':'We couldn’t verify your session'}
      body={language==='ar'?'أعد المحاولة لاستعادة حسابك على هذا الجهاز.':'Try again to restore your account on this device.'}
      retry={()=>void refresh()}/>}
    {status==='loading'?<StatePanel title={t('accountChecking')} busy/>:user?<>
      <View testID="signed-in-profile" style={accountStyles.profile}>
        <Row><AccountAvatar name={user.name} large/><View style={{flex:1,minWidth:0,gap:0}}>
          <Txt kind="subheading" numberOfLines={1}>{user.name}</Txt>
          <Txt kind="small" numberOfLines={1} style={{writingDirection:'ltr',textAlign:language==='ar'?'right':'left'}}>{user.email}</Txt>
          <Row style={{gap:4}}><Icon name="checkCircle" size={13} color={colors.success}/><Txt kind="caption" accessibilityLiveRegion="polite" tone="success">{language==='ar'?'مسجّل الدخول':'Signed in'}</Txt></Row>
        </View></Row>
      </View>
      <LanguageChoice/>
      <AccountMembership key={sessionRevision}/>
      <View style={accountStyles.menu}>
        <AccountLink icon="trips" title={t('bookingsTitle')} onPress={()=>router.navigate('/bookings')}/>
        <View style={ui.rule}/><AccountLink icon="saved" title={t('saved')} onPress={()=>router.navigate('/saved')}/>      </View>
      <View style={accountStyles.menu}>
        <AccountLink icon="support" title={t('support')} onPress={()=>router.push('/support')}/>
        <View style={ui.rule}/><AccountLink icon="info" title={language === 'ar' ? 'الإشعارات' : 'Notifications'} onPress={()=>router.push('/notifications')}/>
        <View style={ui.rule}/><AccountLink icon="account" title={t('accountDeletion')} onPress={()=>router.push('/account-deletion')}/>
      </View>
      <Txt kind="small">{t('accountSecurity')}</Txt>
      <Button variant="quiet" title={t('signOut')} busy={busy} onPress={()=>{setBusy(true);void signOut().catch(()=>setError(t('authError'))).finally(()=>setBusy(false));}}/>
    </>:<View style={ui.card}>
      <Row>{(['login','register'] as const).map(value=><View key={value} style={{flex:1}}><Button title={t(value==='login'?'signIn':'createAccount')} variant={mode===value?'primary':'secondary'} disabled={busy} onPress={()=>goTo(value)}/></View>)}</Row>
      {mode==='forgot'&&<View testID="account-forgot" style={{gap:6}}><Txt kind="subheading" accessibilityRole="header">{resetCopy.forgotTitle}</Txt><Txt kind="small">{resetCopy.forgotBody}</Txt>
        <Field label={t('email')} value={email} onChangeText={setEmail} ltr keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}/></View>}
      {mode==='reset'&&<View testID="account-reset" style={{gap:6}}><Txt accessibilityLiveRegion="polite">{resetCopy.sent}</Txt><Txt style={{writingDirection:'ltr',textAlign:ar?'right':'left'}}>{email}</Txt>
        <Field label={t('code')} value={code} onChangeText={value=>setCode(normalizeVerificationCode(value))} ltr keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}/>
        <Field label={resetCopy.newPassword} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" maxLength={128}/>
        <Txt kind="small">{t('passwordRules')} {resetCopy.everywhere}</Txt></View>}
      {mode==='register'&&<Field label={t('name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={120}/>}
      {mode==='forgot'||mode==='reset'?null:mode!=='verify'?<><Field label={t('email')} value={email} onChangeText={setEmail} ltr keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}/><Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode==='login'?'current-password':'new-password'} textContentType={mode==='login'?'password':'newPassword'} maxLength={128}/>{mode==='login'&&<View testID="account-forgot-link" style={{alignSelf:ar?'flex-end':'flex-start'}}><Button variant="quiet" title={resetCopy.forgot} disabled={busy} onPress={()=>{setMode('forgot');setError('');setNotice('');setPassword('');}}/></View>}{mode==='register'&&<><Txt kind="small">{t('passwordRules')}</Txt><Field label={t('phone')} value={phone} onChangeText={setPhone} ltr keyboardType="phone-pad" autoComplete="tel" maxLength={40}/></>}</>:<><Txt>{t('codeSent')}</Txt><Txt style={{writingDirection:'ltr'}}>{email}</Txt><Field label={t('code')} value={code} onChangeText={value=>setCode(normalizeVerificationCode(value))} ltr keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}/></>}
      {mode==='register'&&<View style={{gap:6}}><Txt kind="small">{t('registrationPrivacy')}</Txt><Button variant="quiet" title={t('privacy')} disabled={busy} onPress={()=>void openPolicy('/privacy')}/><Button variant="quiet" title={t('terms')} disabled={busy} onPress={()=>void openPolicy('/terms')}/></View>}
      {visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}{notice&&!visibleError?<Txt accessibilityLiveRegion="polite" tone="success">{notice}</Txt>:null}<View testID="account-auth-submit"><Button title={mode==='forgot'?resetCopy.send:mode==='reset'?resetCopy.save:t(mode==='login'?'signIn':mode==='register'?'sendCode':'verify')} busy={busy} onPress={()=>void submit()}/></View>
      {mode==='reset'&&<Button variant="quiet" title={resetCopy.resend} disabled={busy} onPress={()=>void sendResetCode(true)}/>}
      {(mode==='forgot'||mode==='reset')&&<Button variant="quiet" title={resetCopy.back} disabled={busy} onPress={()=>goTo('login')}/>}
    </View>}
    {user&&visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}
    {status==='signedOut'&&<View style={accountStyles.menu}>
      <AccountLink icon="users" title={language === 'ar' ? 'عضوية مخدة' : 'Membership'} onPress={()=>router.push('/membership')}/>
      <View style={ui.rule}/><AccountLink icon="support" title={t('support')} onPress={()=>router.push('/support')}/>
      <View style={ui.rule}/><AccountLink icon="info" title={language === 'ar' ? 'الإشعارات' : 'Notifications'} onPress={()=>router.push('/notifications')}/>
      <View style={ui.rule}/><AccountLink icon="account" title={t('accountDeletion')} onPress={()=>router.push('/account-deletion')}/>
    </View>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const accountStyles = StyleSheet.create({
  profile: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: color.bgSurface, borderColor: color.borderCard, borderWidth: 1 },
  explore: { alignSelf: 'stretch' },
  member: { borderRadius: 16, backgroundColor: colors.pistachioMist, paddingVertical: 4, paddingHorizontal: 14 },
  memberIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.pistachio, alignItems: 'center', justifyContent: 'center' },
  menu: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, borderColor: color.borderCard, borderWidth: 1 },
  link: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6 },
  linkIcon: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, backgroundColor: colors.softBlue },
});
