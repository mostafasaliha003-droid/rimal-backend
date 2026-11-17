import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { APP_ENV } from '../api';
import { Row, Txt } from './Primitives';

export function EnvironmentBanner() { const { t } = useLanguage(); return <View style={{ backgroundColor: colors.softGold, paddingHorizontal: 20, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F0DFC4' }}><Txt kind="small" style={{ color: colors.goldInk, fontFamily: fonts.bold }}>{t(APP_ENV === 'production' ? 'production' : 'sandbox')}</Txt></View>; }
export default function BrandHeader({ back = false }: { back?: boolean }) {
  const { language, setLanguage, t, rtl } = useLanguage(); const router = useRouter();
  return <View style={{ paddingHorizontal: 20, paddingVertical: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
    {back ? <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ minWidth: 48, minHeight: 48, justifyContent: 'center' }}><Txt style={{ fontSize: 26 }}>{rtl ? '→' : '←'}</Txt></Pressable> : <Row><Image accessibilityLabel={language === 'ar' ? 'رمال' : 'Remal'} source={require('../../assets/remal-logo.jpg')} style={{ width: 42, height: 42, borderRadius: 13 }} /><View><Txt style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 27, color: colors.navy }}>{language === 'ar' ? 'مخدّة' : 'Mkhadda'}</Txt><Txt kind="small" style={{ color: colors.blueStrong, fontSize: 10 }}>{language === 'ar' ? 'من رمال للسياحة' : 'by Remal Tourism'}</Txt></View></Row>}
    <Row style={{ gap: 4 }}><Pressable accessibilityRole="button" accessibilityLabel={t('support')} onPress={() => router.push('/support')} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.softBlue, alignItems: 'center', justifyContent: 'center' }}><Txt style={{ color: colors.blueStrong, fontFamily: fonts.bold }}>?</Txt></Pressable><Pressable accessibilityRole="button" accessibilityLabel={language === 'ar' ? 'EN · Switch to English' : 'عربي · التبديل إلى العربية'} onPress={() => setLanguage(language === 'ar' ? 'en' : 'ar')} style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 13, justifyContent: 'center' }}><Txt kind="label">{language === 'ar' ? 'EN' : 'عربي'}</Txt></Pressable></Row>
  </Row></View>;
}
