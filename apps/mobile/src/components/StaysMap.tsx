import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useLanguage } from '../i18n';
import { color, radius } from '../theme';
import { buildMapHtml, type MapMarker } from './mapHtml';

// The package types WebView's props as WebViewProps & P with P = undefined, which collapses to never.
const MapWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebView> }>;

export interface StaysMapProps {
  markers: readonly MapMarker[]; selected?: number | null; onSelect?: (id: number) => void; onFailed?: () => void;
  height: number; interactive?: boolean; label: string; testID?: string;
}

/**
 * Hotels on a real map (MapLibre with free OpenFreeMap tiles) inside a WebView. The page is built
 * once per set of markers; choosing a hotel elsewhere only moves the highlight. Links inside the
 * map (the map credits) open in the browser, never inside the app's view.
 */
export default function StaysMap({ markers, selected = null, onSelect, onFailed, height, interactive = true, label, testID }: StaysMapProps) {
  const { language, rtl } = useLanguage();
  const view = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const failure = language === 'ar' ? 'تعذّر تحميل الخريطة. تحقق من الاتصال.' : 'The map could not load. Check your connection.';
  // The page depends on the markers, not on the highlight, so choosing a hotel never reloads the map.
  const markerKey = JSON.stringify(markers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMapHtml({ markers, interactive, selected, failure, rtl }), [markerKey, interactive, failure, rtl]);
  useEffect(() => {
    if (ready && selected !== null) view.current?.injectJavaScript(`window.__select && window.__select(${Number(selected)}, true); true;`);
  }, [selected, ready]);
  const receive = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; id?: number };
      if (message.type === 'ready') setReady(true);
      else if (message.type === 'select' && typeof message.id === 'number') onSelect?.(message.id);
      else if (message.type === 'error') onFailed?.();
    } catch { /* ignore anything that is not ours */ }
  };
  return <View testID={testID} accessibilityLabel={label} style={[styles.frame, { height }]}>
    <MapWebView ref={view} originWhitelist={['*']} source={{ html, baseUrl: 'https://localhost/' }} onMessage={receive}
      javaScriptEnabled domStorageEnabled={false} setSupportMultipleWindows={false} allowsLinkPreview={false}
      scrollEnabled={false} bounces={false} overScrollMode="never" style={styles.web}
      onShouldStartLoadWithRequest={(request: { url: string; isTopFrame?: boolean }) => {
        if (request.url.startsWith('https://localhost') || request.url === 'about:blank' || request.url.startsWith('data:')) return true;
        if (request.isTopFrame !== false && /^https?:/i.test(request.url)) void WebBrowser.openBrowserAsync(request.url).catch(() => undefined);
        return false;
      }}/>
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgField },
  web: { flex: 1, backgroundColor: 'transparent' },
});
