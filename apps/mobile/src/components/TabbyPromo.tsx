import React, { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useLanguage } from '../i18n';
import { color, fonts, latinFonts, radius, space } from '../theme';
import { Icon, Txt } from './Primitives';
import { tabbyBannerCopy, tabbyLearnMoreUrl, tabbyMonthly, tabbyPromoText, tabbyName, type TabbyPromoSettings } from './tabbyModel';
import TabbyLogo from './TabbyLogo';

/* Tabby's brand colours, from its Merchant guidelines (slide 25). */
const TABBY_BLACK = '#1A1919';

/*
 * Tabby's home screen banner in Tabby's official light theme (Merchant guidelines, slide 20: white
 * card, black text, the green Tabby badge), with the approved UAE message (slides 7–8) and the UAE
 * disclaimer (slide 11). The light theme sits calmly on our brand instead of shouting over it.
 * Copy comes only from tabbyBannerCopy; nothing here is ours to reword.
 */
export function TabbyBanner({ compact = false }: { compact?: boolean }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const copy = tabbyBannerCopy(language);
  const bold = ar ? fonts.bold : latinFonts.bold, regular = ar ? fonts.regular : latinFonts.regular;
  const align = { textAlign: ar ? 'right' as const : 'left' as const, writingDirection: ar ? 'rtl' as const : 'ltr' as const };
  return <View testID="welcome-tabby" accessible accessibilityLabel={`Tabby. ${copy.lead}. ${copy.support} ${copy.disclaimer}`}
    style={[banner.card, compact && banner.compact]}>
    <View style={[banner.row, { flexDirection: ar ? 'row-reverse' : 'row' }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text allowFontScaling={false} style={[banner.ink, align, { fontFamily: bold, fontSize: compact ? 16 : 18, lineHeight: ar ? (compact ? 25 : 28) : (compact ? 21 : 24) }]}>{copy.lead}</Text>
        <Text allowFontScaling={false} style={[banner.ink, align, { fontFamily: regular, fontSize: compact ? 12.5 : 13.5, lineHeight: ar ? 21 : 18 }]}>{copy.support}</Text>
      </View>
      <TabbyLogo height={compact ? 24 : 28}/>
    </View>
    <Text allowFontScaling={false} style={[banner.disclaimer, { fontFamily: latinFonts.regular }]}>{copy.disclaimer}</Text>
  </View>;
}

const banner = StyleSheet.create({
  card: { width: '100%', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.lg, backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(26,25,25,0.14)',
    shadowColor: '#1A0F22', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  compact: { paddingVertical: space.sm, gap: 4 },
  row: { alignItems: 'center', gap: space.md },
  ink: { color: TABBY_BLACK },
  disclaimer: { color: TABBY_BLACK, opacity: 0.72, fontSize: 10, lineHeight: 13, textAlign: 'left', writingDirection: 'ltr' },
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
