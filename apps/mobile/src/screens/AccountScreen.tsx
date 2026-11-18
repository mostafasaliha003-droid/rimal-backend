import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, websiteUrl } from '../api';
import type { MemberStatus } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import BrandHeader, { AccountAvatar } from '../components/BrandHeader';
import { Button, Field, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import { normalizeVerificationCode, registrationFormReady } from '../components/foundationContracts';
import { statusText } from '../components/membershipCopy';

function AccountMembership() {
  const { language } = useLanguage();
  const router = useRouter();
  const ar = language === 'ar';
  const [membership, setMembership] = useState<MemberStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setMembership(null);
    setFailed(false);
    api.getMembershipStatus(controller.signal).then(value => {
      if (!controller.signal.aborted) setMembership(value);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []));
  let detail = ar ? 'جارٍ التحقق من حالة العضوية' : 'Checking membership';
  if (failed || membership && (!membership.enabled || !membership.authenticated)) {
    detail = ar ? 'تعذّر التحقق من حالة العضوية' : 'Membership status unavailable';
  } else if (membership) {
    detail = membership.status ? statusText[membership.status][ar ? 0 : 1] : ar ? 'تقديم طلب العضوية' : 'Apply for membership';
  }
  return <Pressable testID="account-membership" accessibilityRole="button" onPress={() => router.push('/membership')} style={ui.card}>
    <Row><View style={{ flex: 1, gap: 3 }}>
      <Txt kind="label">{ar ? 'عضوية مخدة' : 'Pillow stays membership'}</Txt>
      <Txt kind="small" accessibilityLiveRegion="polite" style={membership?.canAccess ? { color: colors.success } : undefined}>{detail}</Txt>
    </View><Icon name="chevron" size={18}/></Row>
  </Pressable>;
}

export default function AccountScreen() {
  const {sessionRevision}=useAuth();
  return <AccountContents key={sessionRevision}/>;
}
function AccountContents() {
  const {user,status,error:sessionError,restorePending,signIn,requestRegistration,verifyRegistration,signOut,refresh}=useAuth(); const {t,language}=useLanguage(); const router=useRouter();
  const [mode,setMode]=useState<'login'|'register'|'verify'>('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [code,setCode]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const submit=async()=>{setError('');const validEmail=/^\S+@\S+\.\S+$/.test(email.trim());if(mode==='login'&&(!validEmail||!password)){setError(t('loginRequired'));return;}if(mode==='register'&&(!registrationFormReady(name,email,password))){setError(t('registrationRequired'));return;}if(mode==='verify'&&!/^\d{6}$/.test(code)){setError(t('code'));return;}setBusy(true);try{if(mode==='login')await signIn(email.trim(),password);else if(mode==='register'){await requestRegistration({name:name.trim(),email:email.trim(),password,phone:phone.trim()});setMode('verify');}else await verifyRegistration(email.trim(),code);setPassword('');}catch{setError(t('authError'));}finally{setBusy(false);}};
  const website=async()=>{try{await WebBrowser.openBrowserAsync(websiteUrl('/account'),{toolbarColor:colors.navy});}catch{setError(t('websiteError'));}};
  const openPolicy=async(path:'/privacy'|'/terms')=>{try{await WebBrowser.openBrowserAsync(websiteUrl(path),{toolbarColor:colors.navy});}catch{setError(t('websiteError'));}};
  const visibleError=error||(status==='signedOut'&&sessionError&&!restorePending?t('authError'):'');
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader/><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
    <Txt kind="title" accessibilityRole="header">{t('account')}</Txt>
    {status==='signedOut'&&restorePending&&<StatePanel title={language==='ar'?'تعذّر التحقق من جلستك':'We couldn’t verify your session'}
      body={language==='ar'?'أعد المحاولة لاستعادة حسابك على هذا الجهاز.':'Try again to restore your account on this device.'}
      retry={()=>void refresh()}/>}
    {status==='loading'?<StatePanel title={t('accountChecking')} busy/>:user?<>
      <View testID="signed-in-profile" style={[ui.card,{backgroundColor:colors.navy,borderColor:colors.navy,paddingVertical:20}]}>
        <Row><AccountAvatar name={user.name} large/><View style={{flex:1,minWidth:0,gap:2}}>
          <Txt kind="label" accessibilityLiveRegion="polite" style={{color:colors.pistachio}}>{language==='ar'?'مسجّل الدخول':'Signed in'}</Txt>
          <Txt kind="heading" style={{color:colors.surface}}>{user.name}</Txt>
          <Txt kind="small" style={{color:colors.surface,writingDirection:'ltr'}}>{user.email}</Txt>
        </View></Row>
      </View>
      <View testID="account-explore"><Button title={language==='ar'?'استكشف الفنادق':'Explore hotels'} onPress={()=>router.navigate('/')}/></View>
      <AccountMembership/>
      <View style={ui.card}><Button variant="secondary" title={t('bookingsTitle')} onPress={()=>router.navigate('/bookings')}/>
        <Button variant="quiet" title={t('myBookings')} onPress={()=>void website()}/><Txt kind="small">{language==='ar'?'يفتح حساب رمال في المتصفح. قد يُطلب منك تسجيل الدخول هناك.':'Opens your Remal account in the browser. You may need to sign in there.'}</Txt>
      </View>
      <View style={ui.card}><Txt kind="small">{t('accountSecurity')}</Txt><Button variant="quiet" title={t('signOut')} busy={busy} onPress={()=>{setBusy(true);void signOut().catch(()=>setError(t('authError'))).finally(()=>setBusy(false));}}/><Button variant="secondary" title={t('accountDeletion')} onPress={()=>router.push('/account-deletion')}/></View>
    </>:<View style={ui.card}>
      <Row>{(['login','register'] as const).map(value=><View key={value} style={{flex:1}}><Button title={t(value==='login'?'signIn':'createAccount')} variant={mode===value?'primary':'secondary'} disabled={busy} onPress={()=>{setMode(value);setError('');setPassword('');}}/></View>)}</Row>
      {mode==='register'&&<Field label={t('name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={120}/>}
      {mode!=='verify'?<><Field label={t('email')} value={email} onChangeText={setEmail} ltr keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}/><Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode==='login'?'current-password':'new-password'} textContentType={mode==='login'?'password':'newPassword'} maxLength={128}/>{mode==='register'&&<><Txt kind="small">{t('passwordRules')}</Txt><Field label={t('phone')} value={phone} onChangeText={setPhone} ltr keyboardType="phone-pad" autoComplete="tel" maxLength={40}/></>}</>:<><Txt>{t('codeSent')}</Txt><Txt style={{writingDirection:'ltr'}}>{email}</Txt><Field label={t('code')} value={code} onChangeText={value=>setCode(normalizeVerificationCode(value))} ltr keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}/></>}
      {mode==='register'&&<View style={{gap:6}}><Txt kind="small">{t('registrationPrivacy')}</Txt><Button variant="quiet" title={t('privacy')} disabled={busy} onPress={()=>void openPolicy('/privacy')}/><Button variant="quiet" title={t('terms')} disabled={busy} onPress={()=>void openPolicy('/terms')}/></View>}
      {visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}<View testID="account-auth-submit"><Button title={t(mode==='login'?'signIn':mode==='register'?'sendCode':'verify')} busy={busy} onPress={()=>void submit()}/></View>
    </View>}
    {user&&visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}{status==='signedOut'&&<><Button variant="quiet" title={t('accountDeletion')} onPress={()=>router.push('/account-deletion')}/><Button variant="secondary" title={language === 'ar' ? 'عضوية مخدة' : 'Membership'} onPress={()=>router.push('/membership')}/></>}<Button variant="secondary" title={language === 'ar' ? 'الإشعارات' : 'Notifications'} onPress={()=>router.push('/notifications')}/><Button variant="secondary" title={t('support')} onPress={()=>router.push('/support')}/>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
