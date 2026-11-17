import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Button, MoneyText, Photo, Row, Txt } from './Primitives';

export default function HotelCard({ hotel }: { hotel: HotelSummary }) {
  const { t } = useLanguage(); const router = useRouter(); const { saved, savedReady, toggleSaved } = useAppState(); const selected = saved.includes(hotel.hid);
  const open = () => router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } });
  return <View style={[ui.card, ui.shadow, { padding: 0, overflow: 'hidden', gap: 0 }]}><View><Pressable accessibilityRole="button" accessibilityLabel={`${t('viewStay')}: ${hotel.name}`} onPress={open}><Photo uri={hotel.imageUrl} label={hotel.name} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t(selected ? 'removeSaved' : 'saveStay')} accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={() => toggleSaved(hotel.hid)} style={{ position: 'absolute', top: 14, right: 14, width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Txt style={{ color: selected ? colors.red : colors.navy, fontSize: 29, lineHeight: 34 }}>{selected ? '♥' : '♡'}</Txt></Pressable></View><View style={{ padding: 20, gap: 12 }}>
    {Number.isInteger(hotel.stars) && Number(hotel.stars) > 0 && Number(hotel.stars) <= 5 && <Txt kind="small" style={{ color: colors.goldInk }}>{'★'.repeat(Number(hotel.stars))} · {hotel.stars} {t('stars')}</Txt>}
    <Txt accessibilityRole="header" kind="heading">{hotel.name}</Txt>{hotel.address && <Txt kind="small">{hotel.address}</Txt>}<View style={ui.rule} /><Row style={{ alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}><View style={{ flexShrink: 1 }}><Txt kind="small">{t('priceForStay')}</Txt><MoneyText money={hotel.price} /></View><Button compact variant="secondary" title={t('viewStay')} onPress={open} /></Row>
  </View></View>;
}
