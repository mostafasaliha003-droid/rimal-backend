import React, { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useLanguage } from '../i18n';
import { color, fonts, latinFonts, radius, space } from '../theme';
import { Icon, Txt } from './Primitives';
import { tabbyBannerCopy, tabbyLearnMoreUrl, tabbyMonthly, tabbyPromoText, tabbyName, type TabbyPromoSettings } from './tabbyModel';
import { TabbyWordmark } from './TabbyLogo';

/* Tabby's brand colours, from its Merchant guidelines (slide 25). */
const TABBY_GREEN = '#6CFF93', TABBY_BLACK = '#1A1919';

/*
 * Tabby's home screen banner, built to Tabby's own website-banner layout (Merchant guidelines,
 * slide 37): Tabby green card, the approved UAE message, the UAE disclaimer and the official
 * wordmark. Copy comes only from tabbyBannerCopy; nothing here is ours to reword.
 */
export function TabbyBanner({ compact = false }: { compact?: boolean }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const copy = tabbyBannerCopy(language);
  const bold = ar ? fonts.bold : latinFonts.bold, regular = ar ? fonts.regular : latinFonts.regular;
  return <View testID="welcome-tabby" accessible accessibilityLabel={`Tabby. ${copy.lead}. ${copy.support} ${copy.disclaimer}`}
    style={[banner.card, compact && banner.compact]}>
    <Text allowFontScaling={false} style={[banner.lead, { fontFamily: bold, fontSize: compact ? 22 : 27, lineHeight: compact ? (ar ? 34 : 28) : (ar ? 40 : 33),
      textAlign: ar ? 'right' : 'left', writingDirection: ar ? 'rtl' : 'ltr' }]}>{copy.lead}</Text>
    <Text allowFontScaling={false} style={[banner.support, { fontFamily: regular, fontSize: compact ? 13 : 14, lineHeight: ar ? 22 : 19,
      textAlign: ar ? 'right' : 'left', writingDirection: ar ? 'rtl' : 'ltr' }]}>{copy.support}</Text>
    <View style={[banner.foot, { flexDirection: ar ? 'row-reverse' : 'row' }]}>
      <Text allowFontScaling={false} style={[banner.disclaimer, { fontFamily: latinFonts.regular }]}>{copy.disclaimer}</Text>
      <TabbyWordmark height={compact ? 17 : 20}/>
    </View>
  </View>;
}

const banner = StyleSheet.create({
  card: { width: '100%', gap: 4, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, borderRadius: radius.xl, backgroundColor: TABBY_GREEN,
    shadowColor: '#0B3D1A', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  compact: { paddingTop: space.sm, paddingBottom: space.sm, borderRadius: radius.lg },
  lead: { color: TABBY_BLACK },
  support: { color: TABBY_BLACK },
  foot: { alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginTop: space.xs },
  disclaimer: { flex: 1, color: TABBY_BLACK, opacity: 0.78, fontSize: 8, lineHeight: 10.5, textAlign: 'left', writingDirection: 'ltr' },
});

// The package types WebView's props as WebViewProps & P with P = undefined, which collapses to never.
const PromoWebView = WebView as unknown as React.ComponentType<WebViewProps>;
const TABBY_HOSTS = /^https:\/\/([a-z0-9-]+\.)*tabby\.(ai|sa)\//i;

/*
 * Tabby's standard in-app promo, exactly as Tabby specifies it: the sentence with the monthly amount
 * and a "Learn more" link that opens Tabby's own pop-up (their page, in a web view). No custom copy,
 * no drawn logo. docs.tabby.ai/pay-in-4-custom-integration/mobile-apps/app-promo-messaging
 */
export function TabbyPromoLine({ amount, currency, settings, testID = 'tabby-promo' }: {
  amount: string; currency: string; settings: TabbyPromoSettings | null; testID?: string;
}) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const monthly = tabbyMonthly(amount, currency);
  if (!monthly) return null;
  const { text, learnMore } = tabbyPromoText(monthly, language);
  const url = settings ? tabbyLearnMoreUrl(amount, language, settings) : null;
  const show = () => {
    if (!url) return;
    // The web build has no native web view: Tabby's page opens in the browser instead.
    if (Platform.OS === 'web') { void WebBrowser.openBrowserAsync(url).catch(() => undefined); return; }
    setOpen(true);
  };
  return <>
    <Txt testID={testID} kind="caption" tone="primary">
      {text}{url ? ' ' : ''}
      {url && <Txt testID={`${testID}-learn-more`} kind="caption" tone="link" accessibilityRole="link" onPress={show}
        style={{ textDecorationLine: 'underline' }}>{learnMore}</Txt>}
    </Txt>
    {url && <TabbyLearnMore visible={open} url={url} onClose={() => setOpen(false)}/>}
  </>;
}

/** Tabby's "Learn more" pop-up: their page in a sheet, with a close button. Only Tabby pages load in it. */
export function TabbyLearnMore({ visible, url, onClose }: { visible: boolean; url: string; onClose: () => void }) {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(true);
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} transparent={false}>
    <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
      <View style={[styles.bar, { flexDirection: language === 'ar' ? 'row-reverse' : 'row' }]}>
        <Txt kind="label" tone="primary">{tabbyName(language)}</Txt>
        <Pressable testID="tabby-learn-more-close" accessibilityRole="button" accessibilityLabel={language === 'ar' ? 'إغلاق' : 'Close'}
          onPress={onClose} hitSlop={10} style={styles.close}><Icon name="close" size={20} color={color.textPrimary}/></Pressable>
      </View>
      <View style={{ flex: 1 }}>
        <PromoWebView source={{ uri: url }} onLoadEnd={() => setLoading(false)} originWhitelist={['https://*']}
          onShouldStartLoadWithRequest={request => TABBY_HOSTS.test(request.url)} setSupportMultipleWindows={false}/>
        {loading && <View style={styles.loading}><ActivityIndicator color={color.interactive}/></View>}
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.bgSurface },
  bar: { alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  close: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSubtle },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
