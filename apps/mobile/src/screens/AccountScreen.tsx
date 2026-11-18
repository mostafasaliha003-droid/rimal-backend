import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { websiteUrl } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { Button, Field, Row, StatePanel, Txt } from '../components/Primitives';
import { normalizeVerificationCode, registrationFormReady } from '../components/foundationContracts';

export default function AccountScreen() {
  const {sessionRevision}=useAuth();
  return <AccountContents key={sessionRevision}/>;
}
function AccountContents() {
  const {user,status,error:sessionError,signIn,requestRegistration,verifyRegistration,signOut,refresh}=useAuth(); const {t,language}=useLanguage(); const router=useRouter();
  const [mode,setMode]=useState<'login'|'register'|'verify'>('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [code,setCode]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const submit=async()=>{setError('');const validEmail=/^\S+@\S+\.\S+$/.test(email.trim());if(mode==='login'&&(!validEmail||!password)){setError(t('loginRequired'));return;}if(mode==='register'&&(!registrationFormReady(name,email,password))){setError(t('registrationRequired'));return;}if(mode==='verify'&&!/^\d{6}$/.test(code)){setError(t('code'));return;}setBusy(true);try{if(mode==='login')await signIn(email.trim(),password);else if(mode==='register'){await requestRegistration({name:name.trim(),email:email.trim(),password,phone:phone.trim()});setMode('verify');}else await verifyRegistration(email.trim(),code);setPassword('');}catch{setError(t('authError'));}finally{setBusy(false);}};
  const website=async()=>{try{await WebBrowser.openBrowserAsync(websiteUrl('/account'),{toolbarColor:colors.navy});}catch{setError(t('websiteError'));}};
  const openPolicy=async(path:'/privacy'|'/terms')=>{try{await WebBrowser.openBrowserAsync(websiteUrl(path),{toolbarColor:colors.navy});}catch{setError(t('websiteError'));}};
  const visibleError=error||(status==='signedOut'&&sessionError?t('authError'):'');
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader/><EnvironmentBanner/><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}><View style={{gap:10}}><Txt kind="title" accessibilityRole="header">{t('welcome')}</Txt><Txt style={{color:colors.muted}}>{t('accountBody')}</Txt></View>
    {status==='loading'?<StatePanel title={t('accountChecking')} busy/>:user?<><View style={ui.card}><View style={{width:60,height:60,borderRadius:30,backgroundColor:colors.softBlue,justifyContent:'center',alignItems:'center',alignSelf:'center'}}><Txt style={{fontFamily:fonts.bold,fontSize:25,color:colors.blueStrong}}>{user.name.trim().slice(0,1).toLocaleUpperCase()}</Txt></View><Txt kind="heading" style={{textAlign:'center'}}>{user.name}</Txt><Txt style={{textAlign:'center',writingDirection:'ltr'}}>{user.email}</Txt><Txt kind="small" style={{color:colors.success,textAlign:'center'}}>{t('profileReady')}</Txt><View style={ui.rule}/><Button variant="secondary" title={t('bookingsTitle')} onPress={()=>router.navigate('/bookings')}/><Button variant="secondary" title={t('myBookings')} onPress={()=>void website()}/><Txt kind="small">{t('websiteBody')}</Txt></View><View style={ui.card}><Txt kind="small">{t('accountSecurity')}</Txt><Button variant="quiet" title={t('signOut')} busy={busy} onPress={()=>{setBusy(true);void signOut().catch(()=>setError(t('authError'))).finally(()=>setBusy(false));}}/><Button variant="secondary" title={t('accountDeletion')} onPress={()=>router.push('/account-deletion')}/></View></>:<View style={ui.card}>
      <Row>{(['login','register'] as const).map(value=><View key={value} style={{flex:1}}><Button title={t(value==='login'?'signIn':'createAccount')} variant={mode===value?'primary':'secondary'} disabled={busy} onPress={()=>{setMode(value);setError('');setPassword('');}}/></View>)}</Row>
      {mode==='register'&&<Field label={t('name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={120}/>}
      {mode!=='verify'?<><Field label={t('email')} value={email} onChangeText={setEmail} ltr keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}/><Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={mode==='login'?'current-password':'new-password'} textContentType={mode==='login'?'password':'newPassword'} maxLength={128}/>{mode==='register'&&<><Txt kind="small">{t('passwordRules')}</Txt><Field label={t('phone')} value={phone} onChangeText={setPhone} ltr keyboardType="phone-pad" autoComplete="tel" maxLength={40}/></>}</>:<><Txt>{t('codeSent')}</Txt><Txt style={{writingDirection:'ltr'}}>{email}</Txt><Field label={t('code')} value={code} onChangeText={value=>setCode(normalizeVerificationCode(value))} ltr keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}/></>}
      {mode==='register'&&<View style={{gap:6}}><Txt kind="small">{t('registrationPrivacy')}</Txt><Button variant="quiet" title={t('privacy')} disabled={busy} onPress={()=>void openPolicy('/privacy')}/><Button variant="quiet" title={t('terms')} disabled={busy} onPress={()=>void openPolicy('/terms')}/></View>}
      {visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}{status==='signedOut'&&sessionError&&<Button variant="secondary" title={t('retry')} disabled={busy} onPress={()=>{setError('');void refresh();}}/>}<Button title={t(mode==='login'?'signIn':mode==='register'?'sendCode':'verify')} busy={busy} onPress={()=>void submit()}/>
    </View>}
    {user&&visibleError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{visibleError}</Txt>}{!user&&<Button variant="quiet" title={t('accountDeletion')} onPress={()=>router.push('/account-deletion')}/>}<Button variant="secondary" title={language === 'ar' ? 'عضوية مخدة' : 'Membership'} onPress={()=>router.push('/membership')}/><Button variant="secondary" title={language === 'ar' ? 'الإشعارات' : 'Notifications'} onPress={()=>router.push('/notifications')}/><Button variant="secondary" title={t('support')} onPress={()=>router.push('/support')}/>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
