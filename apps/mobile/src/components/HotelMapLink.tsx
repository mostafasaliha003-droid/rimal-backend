import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { color, colors, space } from '../theme';
import { Button, Icon, Row, Txt } from './Primitives';
import { shortAddress } from './format';

export default function HotelMapLink({ hotel, showName = false, variant = 'button' }: { hotel: HotelSummary; showName?: boolean; variant?: 'button' | 'row' }) {
  const { rtl, language } = useLanguage();
  const [error, setError] = useState(false);
  if (!hotel.location) return null;
  const { latitude, longitude } = hotel.location;
  const open = () => {
    setError(false);
    const url = new URL('https://www.google.com/maps/search/');
    url.searchParams.set('api', '1'); url.searchParams.set('query', [latitude, longitude].join(','));
    void WebBrowser.openBrowserAsync(url.href, { toolbarColor: colors.navy }).catch(() => setError(true));
  };
  if (variant === 'row') return <Pressable accessibilityRole="link" onPress={open} accessibilityLabel={`${hotel.name} · ${rtl ? 'فتح الموقع في تطبيق الخرائط' : 'Open location in your maps app'}`}
    style={state => [{ minHeight: 56, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm }, state.pressed && { backgroundColor: color.bgMuted }]}>
    <Row style={{ gap: space.md }}>
      <Icon name="pin" size={18} color={color.interactiveStrong}/>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="label" tone="primary" numberOfLines={1}>{hotel.name}</Txt>
        {!!hotel.address && <Txt kind="caption" numberOfLines={1}>{shortAddress(hotel.address, language)}</Txt>}
        {error && <Txt accessibilityRole="alert" kind="caption" tone="danger">{rtl ? 'تعذّر فتح الخريطة' : 'Could not open the map'}</Txt>}
      </View>
      <Icon name="external" size={16} color={color.textSecondary}/>
    </Row>
  </Pressable>;
  return <View style={{ gap: 4 }}><Button variant="secondary"
    title={showName ? hotel.name : rtl ? 'فتح موقع الفندق على الخريطة' : 'Open hotel location in Maps'} onPress={open}/>
    {error && <Txt accessibilityRole="alert" kind="small">{rtl ? 'تعذّر فتح الخريطة' : 'Could not open the map'}</Txt>}</View>;
}
