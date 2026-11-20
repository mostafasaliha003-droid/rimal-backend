import React, { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, websiteUrl } from '../api';
import type { MemberStatus } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import BrandHeader, { AccountAvatar } from '../components/BrandHeader';
import { Button, Field, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import { afterSignInRoute, normalizeVerificationCode, registrationFormReady } from '../components/foundationContracts';
import { statusText } from '../components/membershipCopy';

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
      if (!controller.signal.aborted) setMembership(value);
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
  const {user,status,sessionRevision,error:sessionError,restorePending,signIn,requestRegistration,verifyRegistration,signOut,refresh}=useAuth(); const {t,language}=useLanguage(); const router=useRouter();
  const navigation = useNavigation();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [mode,setMode]=useState<'login'|'register'|'verify'>('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [code,setCode]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const submit = async () => {
    if (busy) return;
    setError('');
    if (mode === 'login' && (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password)) { setError(t('loginRequired')); return; }
    if (mode === 'register' && !registrationFormReady(name,email,password)) { setError(t('registrationRequired')); return; }
    if (mode === 'verify' && !/^\d{6}$/.test(code)) { setError(t('code')); return; }
    setBusy(true);
    try {
      if (mode === 'register') {
        await requestRegistration({ name: name.trim(), email: email.trim(), password, phone: phone.trim() });
        setPassword(''); setMode('verify');
        return;
      }
      if (mode === 'verify') await verifyRegistration(email.trim(), code);
      else await signIn(email.trim(), password);
      setPassword(''); setCode(''); setEmail(''); setName(''); setPhone(''); setMode('login');
      if (navigation.isFocused()) {
        const destination = afterSignInRoute(returnTo);
        if (returnTo) router.setParams({ returnTo: undefined });
        if (destination === '/' || destination === '/saved' || destination === '/bookings') router.navigate(destination);
        else router.dismissTo(destination);
      }
    } catch { setError(t('authError')); }
    finally { setBusy(false); }
  };
  const openPolicy=async(path:'/privacy'|'/terms')=>{try{await WebBrowser.openBrowserAsync(websiteUrl(path),{toolbarColor:colors.navy});}catch{setError(t('websiteError'));}};
  const visibleError=error||(status==='signedOut'&&sessionError&&!restorePending?t('authError'):'');
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader/><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
    <Txt kind="title" accessibilityRole="header">{t('account')}</Txt>
    {status==='signedOut'&&restorePending&&<StatePanel title={language==='ar'?'تعذّر التحقق من جلستك':'We couldn’t verify your session'}
      body={language==='ar'?'أعد المحاولة لاستعادة حسابك على هذا الجهاز.':'Try again to restore your account on this device.'}
      retry={()=>void refresh()}/>}
    {status==='loading'?<StatePanel title={t('accountChecking')} busy/>:user?<>
      <View testID="signed-in-profile" style={accountStyles.profile}>
        <Row><AccountAvatar name={user.name} large/><View style={{flex:1,minWidth:0,gap:2}}>
          <Txt kind="label" accessibilityLiveRegion="polite" style={{color:colors.pistachio}}>{language==='ar'?'مسجّل الدخول':'Signed in'}</Txt>
          <Txt kind="heading" style={{color:colors.surface}}>{user.name}</Txt>
          <Txt kind="small" style={{color:colors.surface,writingDirection:'ltr'}}>{user.email}</Txt>
        </View></Row>
        <View testID="account-explore" style={accountStyles.explore}><Button variant="secondary" compact title={language==='ar'?'استكشف الفنادق':'Explore hotels'} onPress={()=>router.navigate('/')}/></View>
      </View>
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
      <Row>{(['login','register'] as const).map(value=><View key={value} style={{flex:1}}><Button title={t(value==='login'?'signIn':'createAccount')} variant={mode===value?'primary':'secondary'} disabled={busy} onPress={()=>{setMode(value);setError('');setPassword('');}}/></View>)}</Row>
      {mode==='register'&&<Field label={t('name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={120}/>}
      {mode!=='verify'?<><Field label={t('email')} value={email} onChangeText={setEmail} ltr keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}/><Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode==='login'?'current-password':'new-password'} textContentType={mode==='login'?'password':'newPassword'} maxLength={128}/>{mode==='register'&&<><Txt kind="small">{t('passwordRules')}</Txt><Field label={t('phone')} value={phone} onChangeText={setPhone} ltr keyboardType="phone-pad" autoComplete="tel" maxLength={40}/></>}</>:<><Txt>{t('codeSent')}</Txt><Txt style={{writingDirection:'ltr'}}>{email}</Txt><Field label={t('code')} value={code} onChangeText={value=>setCode(normalizeVerificationCode(value))} ltr keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}/></>}
      {mode==='register'&&<View style={{gap:6}}><Txt kind="small">{t('registrationPrivacy')}</Txt><Button variant="quiet" title={t('privacy')} disabled={busy} onPress={()=>void openPolicy('/privacy')}/><Button variant="quiet" title={t('terms')} disabled={busy} onPress={()=>void openPolicy('/terms')}/></View>}
      {visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}<View testID="account-auth-submit"><Button title={t(mode==='login'?'signIn':mode==='register'?'sendCode':'verify')} busy={busy} onPress={()=>void submit()}/></View>
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
  profile: { borderRadius: 24, padding: 20, gap: 18, backgroundColor: colors.primary },
  explore: { alignSelf: 'stretch' },
  member: { borderRadius: 18, backgroundColor: colors.pistachioMist, paddingVertical: 6, paddingHorizontal: 14 },
  memberIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.pistachio, alignItems: 'center', justifyContent: 'center' },
  menu: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  link: { minHeight: 58, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  linkIcon: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, backgroundColor: colors.softBlue },
});
