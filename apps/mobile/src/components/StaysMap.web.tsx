import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';
import { color, radius } from '../theme';
import { buildMapHtml } from './mapHtml';
import type { StaysMapProps } from './StaysMap';

/** The same map page in a sandboxed iframe for the web build. */
export default function StaysMap({ markers, selected = null, onSelect, onFailed, height, interactive = true, label, testID }: StaysMapProps) {
  const { language, rtl } = useLanguage();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const failure = language === 'ar' ? 'تعذّر تحميل الخريطة. تحقق من الاتصال.' : 'The map could not load. Check your connection.';
  const markerKey = JSON.stringify(markers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMapHtml({ markers, interactive, selected, failure, rtl }), [markerKey, interactive, failure, rtl]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      try {
        const message = JSON.parse((event.data as { mkhaddaMap?: string })?.mkhaddaMap || '{}') as { type?: string; id?: number };
        if (message.type === 'select' && typeof message.id === 'number') onSelect?.(message.id);
        else if (message.type === 'error') onFailed?.();
      } catch { /* ignore anything that is not ours */ }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onSelect, onFailed]);
  useEffect(() => {
    if (selected !== null) frame.current?.contentWindow?.postMessage({ mkhaddaSelect: selected }, '*');
  }, [selected]);
  return <View testID={testID} accessibilityLabel={label} style={[styles.frame, { height }]}>
    {React.createElement('iframe', { ref: frame, srcDoc: html, title: label, sandbox: 'allow-scripts allow-popups',
      style: { border: 0, width: '100%', height: '100%', display: 'block' } })}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgField },
});
