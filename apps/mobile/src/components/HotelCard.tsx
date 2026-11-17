import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Button, MoneyText, Photo, Row, Txt } from './Primitives';
import { priceInCurrency, stayNights } from './resultsDecisionModel';
import { resultsCopy } from './resultsCopy';

export default function HotelCard({ hotel, comparisonDisabled = false }: { hotel: HotelSummary; comparisonDisabled?: boolean }) {
  const { t, language } = useLanguage(), L = resultsCopy(language), router = useRouter();
  const { criteria, saved, savedReady, toggleSaved, comparisonItems, comparisonContextKey, toggleComparison } = useAppState();
  const selected = saved.includes(hotel.hid), compared = comparisonItems.some(item => item.hid === hotel.hid);
  const [feedback, setFeedback] = useState<{ context: string; code: 'limit' | 'context_changed' | 'unavailable' } | null>(null);
  const open = () => router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } });
  const price = priceInCurrency(hotel.price, criteria?.currency || ''), nights = stayNights(criteria);
  const compare = () => {
    const result = toggleComparison(hotel, comparisonContextKey);
    setFeedback(result === 'added' || result === 'removed' ? null : { context: comparisonContextKey, code: result });
  };
  return <View style={[ui.card, ui.shadow, { padding: 0, overflow: 'hidden', gap: 0 }]}>
    <View><Pressable accessibilityRole="button" accessibilityLabel={`${t('viewStay')}: ${hotel.name}`} onPress={open}><Photo uri={hotel.imageUrl} label={hotel.name}/></Pressable>
      <Pressable accessibilityRole="button" aria-pressed={selected} accessibilityLabel={`${t(selected ? 'removeSaved' : 'saveStay')}: ${hotel.name}`} accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={() => toggleSaved(hotel.hid)}
        style={{ position: 'absolute', top: 14, right: 14, width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}><Txt style={{ color: selected ? colors.red : colors.navy, fontSize: 29, lineHeight: 34 }}>{selected ? '♥' : '♡'}</Txt></Pressable>
    </View>
    <View style={{ padding: 20, gap: 12 }}>
      {Number.isInteger(hotel.stars) && Number(hotel.stars) > 0 && Number(hotel.stars) <= 5 && <Txt kind="small" style={{ color: colors.goldInk }}>{'★'.repeat(Number(hotel.stars))} · {hotel.stars} {t('stars')}</Txt>}
      <Txt accessibilityRole="header" kind="heading">{hotel.name}</Txt>{hotel.address && <Txt kind="small">{hotel.address}</Txt>}
      <View style={ui.rule}/>
      <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
        <View style={{ gap: 4, flexShrink: 1 }}>{price && <Txt kind="small">{L.from}</Txt>}<MoneyText money={price}/><Txt kind="small">{L.stayTotal}</Txt></View>
        <Button compact variant="secondary" title={t('viewStay')} onPress={open}/>
      </Row>
      {nights !== null && criteria && <Txt kind="small">{L.stayContext(nights, criteria.guests.length)}</Txt>}<Txt kind="small">{L.taxesNote}</Txt>
      <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
        <Pressable accessibilityRole="checkbox" aria-checked={compared} accessibilityState={{ checked: compared, disabled: comparisonDisabled || !comparisonContextKey }}
          accessibilityLabel={`${compared ? L.compareAdded : L.compare}: ${hotel.name}`} disabled={comparisonDisabled || !comparisonContextKey} onPress={compare}
          style={{ minHeight: 48, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: compared ? colors.blueStrong : colors.border, backgroundColor: compared ? colors.softBlue : colors.surface, opacity: comparisonDisabled ? .5 : 1 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{compared ? `✓ ${L.compareAdded}` : L.compare}</Txt></Pressable>
      </Row>
      {feedback?.context === comparisonContextKey && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red }}>{feedback.code === 'limit' ? L.compareLimit : feedback.code === 'context_changed' ? L.compareChanged : L.compareUnavailable}</Txt>}
    </View>
  </View>;
}
