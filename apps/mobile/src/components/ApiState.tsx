import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, websiteUrl } from '../api';
import { colors } from '../theme';
import { useLanguage } from '../i18n';
import { Button, StatePanel } from './Primitives';
import { useAuth } from '../auth';
import { membershipPresentation } from './foundationContracts';

export default function ApiState({ error, retry }: { error: unknown; retry: () => void }) { const { t, rtl } = useLanguage(); const {user}=useAuth(); const router = useRouter(); if (error instanceof ApiError && error.code === 'membership_status_unavailable') return <StatePanel title={rtl ? 'تعذّر التحقق من العضوية' : 'Could not verify membership'} retry={retry}/>; const membership = error instanceof ApiError && error.kind === 'membership'; const approval=membership&&membershipPresentation(error.status,Boolean(user))==='approval'; const limited = error instanceof ApiError && error.status === 429; return <View style={{ gap: 12 }}><StatePanel title={t(membership ? 'membershipTitle' : 'resultsError')} body={t(approval ? 'membershipApprovalBody' : membership ? 'membershipBody' : limited ? 'rateLimited' : 'networkError')} retry={retry} />{membership && <>{!approval&&<Button title={t('signIn')} onPress={() => router.push('/account')} />}<Button variant="secondary" title={t('openMembership')} onPress={() => router.push('/membership')} />{approval&&<Button variant="secondary" title={t('websiteSupport')} onPress={()=>{void WebBrowser.openBrowserAsync(websiteUrl('/support'),{toolbarColor:colors.navy}).catch(()=>{});}}/>}</>}</View>; }
