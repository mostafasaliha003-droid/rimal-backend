import React, { useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Button, Txt } from './Primitives';

export default function HotelMapLink({ hotel, showName = false }: { hotel: HotelSummary; showName?: boolean }) {
  const { rtl } = useLanguage();
  const [error, setError] = useState(false);
  if (!hotel.location) return null;
  const { latitude, longitude } = hotel.location;
  const open = () => {
    setError(false);
    const url = new URL('https://www.google.com/maps/search/');
    url.searchParams.set('api', '1'); url.searchParams.set('query', [latitude, longitude].join(','));
    void WebBrowser.openBrowserAsync(url.href, { toolbarColor: colors.navy }).catch(() => setError(true));
  };
  return <View style={{ gap: 4 }}><Button variant="secondary"
    title={showName ? hotel.name : rtl ? 'فتح موقع الفندق على الخريطة' : 'Open hotel location in Maps'} onPress={open}/>
    {error && <Txt accessibilityRole="alert" kind="small">{rtl ? 'تعذّر فتح الخريطة' : 'Could not open the map'}</Txt>}</View>;
}
