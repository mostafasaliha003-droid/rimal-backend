import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { websiteUrl } from '../api';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { Button, Txt } from '../components/Primitives';

export default function SupportScreen(){const {t}=useLanguage();const [error,setError]=useState(false);const open=async(path:'/support'|'/privacy'|'/terms'|'/account-deletion')=>{setError(false);try{await WebBrowser.openBrowserAsync(websiteUrl(path),{toolbarColor:colors.navy});}catch{setError(true);}};return <SafeAreaView edges={['top','bottom']} style={ui.screen}><BrandHeader back/><EnvironmentBanner/><ScrollView contentContainerStyle={ui.page}><View style={{backgroundColor:colors.navy,borderRadius:24,padding:25,gap:16}}><Txt accessibilityRole="header" kind="title" style={{color:'#fff'}}>{t('supportTitle')}</Txt><Txt style={{color:'#D1E1EC'}}>{t('supportBody')}</Txt></View><View style={ui.card}><Txt kind="label">{t('contactEmail')}</Txt><Txt selectable style={{writingDirection:'ltr'}}>{t('supportEmail')}</Txt><Button title={t('contactEmail')} onPress={()=>{void Linking.openURL('mailto:management@remaltourismllc.com').catch(()=>setError(true));}}/><Button variant="secondary" title={t('websiteSupport')} onPress={()=>void open('/support')}/><Txt kind="small">{t('websiteBody')}</Txt></View><View style={ui.card}><Button variant="quiet" title={t('privacy')} onPress={()=>void open('/privacy')}/><View style={ui.rule}/><Button variant="quiet" title={t('terms')} onPress={()=>void open('/terms')}/><View style={ui.rule}/><Button variant="quiet" title={t('deletionWeb')} onPress={()=>void open('/account-deletion')}/></View>{error&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{t('websiteError')}</Txt>}<Txt kind="small">{t('foundationNote')}</Txt></ScrollView></SafeAreaView>;}
