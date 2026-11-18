import React, { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Icon, MoneyText, Photo, Row, Txt } from './Primitives';
import { priceInCurrency, stayNights } from './resultsDecisionModel';
import { resultsCopy } from './resultsCopy';

export default function HotelCard({ hotel, comparisonDisabled = false }: { hotel: HotelSummary; comparisonDisabled?: boolean }) {
  const { t, language, rtl } = useLanguage(), L = resultsCopy(language), router = useRouter();
  const { criteria, saved, savedReady, toggleSaved, comparisonItems, comparisonContextKey, toggleComparison } = useAppState();
  const selected = saved.includes(hotel.hid), compared = comparisonItems.some(item => item.hid === hotel.hid);
  const [feedback, setFeedback] = useState<{ context: string; code: 'limit' | 'context_changed' | 'unavailable' } | null>(null);
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.35;
  const open = () => router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } });
  const price = priceInCurrency(hotel.price, criteria?.currency || ''), nights = stayNights(criteria);
  const compare = () => {
    const result = toggleComparison(hotel, comparisonContextKey);
    setFeedback(result === 'added' || result === 'removed' ? null : { context: comparisonContextKey, code: result });
  };
  const stayContext = nights !== null && criteria ? L.stayContext(nights, criteria.guests.length) : '';
  const hasStars = Number.isInteger(hotel.stars) && Number(hotel.stars) > 0 && Number(hotel.stars) <= 5;
  const photoWidth = width < 360 ? 88 : Math.min(154, Math.round(width * .33));
  return <View testID={`hotel-card-${hotel.hid}`} style={[ui.card, styles.card]}>
    <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityLabel={`${t('viewStay')}: ${hotel.name}`}
      accessibilityHint={[hotel.address, price ? `${L.from} ${price.amount} ${price.currency}, ${L.stayTotal}` : t('priceUnknown'), stayContext].filter(Boolean).join('. ')}
      onPress={open} style={({ pressed }) => [styles.stay, { opacity: pressed ? .8 : 1, flexDirection: stacked ? 'column' : rtl ? 'row-reverse' : 'row' }]}>
      <View style={[styles.thumbnail, stacked ? { height: 122 } : { width: photoWidth }]}>
        <View style={StyleSheet.absoluteFill}><Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name} thumbnail height="100%"/></View>
      </View>
      <View style={[styles.details, !stacked && { flex: 1 }]}>
        <Txt kind="heading" accessibilityRole="header" style={styles.name}>{hotel.name}</Txt>
        {hasStars && <Txt kind="small" accessibilityLabel={`${hotel.stars} ${t('stars')}`} style={styles.stars}>{'★'.repeat(Number(hotel.stars))}</Txt>}
        {!!hotel.address && <Txt kind="small" numberOfLines={2}>{hotel.address}</Txt>}
        <View testID={`hotel-price-${hotel.hid}`} style={styles.total}>
          {!!price && <Txt kind="small">{rtl ? 'إجمالي الإقامة من' : 'Stay total from'}</Txt>}
          <MoneyText money={price}/>
          {!!stayContext && <Txt kind="small">{stayContext}</Txt>}
        </View>
      </View>
    </Pressable>
    <View style={ui.rule}/>
    <Row style={styles.actions}>
      <Pressable accessibilityRole="checkbox" aria-checked={compared} accessibilityState={{ checked: compared, disabled: comparisonDisabled || !comparisonContextKey }}
        accessibilityLabel={`${compared ? L.compareAdded : L.compare}: ${hotel.name}`} disabled={comparisonDisabled || !comparisonContextKey} onPress={compare}
        style={[styles.touch, { opacity: comparisonDisabled ? .5 : 1 }]}>
        <Row style={{ gap: 6 }}><View style={[styles.checkbox, compared && { backgroundColor: colors.navy }]}>
          {compared && <Icon name="check" color={colors.surface} size={13}/>}</View><Txt kind="label">{L.compare}</Txt></Row>
      </Pressable>
      <View style={{ flex: 1 }}/>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t(selected ? 'removeSaved' : 'saveStay')}: ${hotel.name}`} aria-pressed={selected}
        accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={() => toggleSaved(hotel.hid)} style={styles.touch}>
        {selected ? <Txt style={{ color: colors.red, fontSize: 20 }}>♥</Txt> : <Icon name="saved" size={20}/>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('viewStay')} onPress={open} style={styles.touch}>
        <Row style={styles.openStay}><Txt kind="label" style={{color: colors.violetInk}}>{t('viewStay')}</Txt><Icon name="chevron" color={colors.violetInk} size={15}/></Row>
      </Pressable>
    </Row>
    {feedback?.context === comparisonContextKey && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red, paddingHorizontal: 12, paddingBottom: 10 }}>
      {feedback.code === 'limit' ? L.compareLimit : feedback.code === 'context_changed' ? L.compareChanged : L.compareUnavailable}</Txt>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 0, gap: 0, overflow: 'hidden' },
  stay: { padding: 8, gap: 11, alignItems: 'stretch', minHeight: 72 },
  thumbnail: { borderRadius: 13, overflow: 'hidden', backgroundColor: colors.softBlue, minHeight: 125 },
  details: { minWidth: 0, gap: 1 },
  name: { fontSize: 18, lineHeight: 25 },
  stars: { color: colors.goldInk, letterSpacing: 1 },
  total: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.pistachioMist, borderRadius: 10 },
  openStay: { gap: 3, backgroundColor: colors.lavenderMist, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 18 },
  actions: { paddingHorizontal: 6, gap: 0, flexWrap: 'wrap' },
  touch: { minWidth: 48, minHeight: 48, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  checkbox: { width: 17, height: 17, borderWidth: 1.5, borderColor: colors.navy, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
});
