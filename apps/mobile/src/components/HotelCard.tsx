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
  const [failedPhotos, setFailedPhotos] = useState<ReadonlySet<string>>(() => new Set());
  const hasPhoto = [hotel.imageUrl, ...(hotel.images || [])].some(uri => uri && !failedPhotos.has(uri));
  const photoHeight = Math.min(218, Math.round((width - 32) * 0.50));
  const open = () => router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } });
  const price = priceInCurrency(hotel.price, criteria?.currency || ''), nights = stayNights(criteria);
  const compare = () => {
    const result = toggleComparison(hotel, comparisonContextKey);
    setFeedback(result === 'added' || result === 'removed' ? null : { context: comparisonContextKey, code: result });
  };
  const stayContext = nights !== null && criteria ? L.stayContext(nights, criteria.guests.length) : '';
  const hasStars = Number.isInteger(hotel.stars) && Number(hotel.stars) > 0 && Number(hotel.stars) <= 5;
  const controls = <Row style={hasPhoto ? styles.actions : styles.iconRail}>
      <Pressable accessibilityRole="checkbox" aria-checked={compared} accessibilityState={{ checked: compared, disabled: comparisonDisabled || !comparisonContextKey }}
        accessibilityLabel={`${compared ? L.compareAdded : L.compare}: ${hotel.name}`} disabled={comparisonDisabled || !comparisonContextKey} onPress={compare}
        style={({ pressed }) => [hasPhoto ? styles.compare : styles.save, compared && styles.chosen, pressed && styles.pressed]}>
        <Row style={{ gap: 6 }}><Icon name={compared ? 'check' : 'compare'} color={compared ? colors.surface : colors.navy} size={16}/>
          {hasPhoto && <Txt kind="label" style={[styles.compareText, compared && styles.white]}>{L.compare}</Txt>}</Row>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t(selected ? 'removeSaved' : 'saveStay')}: ${hotel.name}`} aria-pressed={selected}
        accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={() => toggleSaved(hotel.hid)}
        style={({ pressed }) => [styles.save, pressed && styles.pressed]}>
        {selected ? <Txt style={{ color: colors.red, fontSize: 22 }}>♥</Txt> : <Icon name="saved" size={20}/>}
      </Pressable>
    </Row>;
  return <View testID={`hotel-card-${hotel.hid}`} style={styles.card}>
    <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityLabel={`${t('viewStay')}: ${hotel.name}`}
      accessibilityHint={[hotel.address, price ? `${L.from} ${price.amount} ${price.currency}, ${L.stayTotal}` : t('priceUnknown'), stayContext].filter(Boolean).join('. ')}
      onPress={open} style={({ pressed }) => pressed && styles.pressed}>
      {hasPhoto && <Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name} height={photoHeight}
        onFailed={uri => setFailedPhotos(previous => new Set(previous).add(uri))}/>}
      <View style={[styles.details, !hasPhoto && [styles.compactDetails, rtl ? { paddingLeft: 70 } : { paddingRight: 70 }]]}>
        {hasStars && <Txt kind="small" accessibilityLabel={`${hotel.stars} ${t('stars')}`} style={styles.stars}>{'★'.repeat(Number(hotel.stars))}</Txt>}
        <Txt kind="heading" accessibilityRole="header" style={styles.name}>{hotel.name}</Txt>
        {!!hotel.address && <Row style={{ gap: 6, alignItems: 'flex-start' }}><View style={{ marginTop: 2 }}><Icon name="pin" size={16} color={colors.muted}/></View>
          <Txt kind="small" numberOfLines={2} style={{ flex: 1 }}>{hotel.address}</Txt></Row>}
        {!hasPhoto && <Txt kind="small" style={styles.note}>{hotel.imageUrl || hotel.images?.length ? L.photoUnavailable : t('photoUnknown')}</Txt>}
      </View>
    </Pressable>
    <View pointerEvents="box-none" style={hasPhoto ? styles.overlay : [styles.compactControls, rtl ? { left: 10 } : { right: 10 }]}>{controls}</View>
    <View style={ui.rule}/>
    <Row style={fontScale > 1.35 ? { ...styles.footer, flexDirection: 'column', alignItems: 'stretch' } : styles.footer}>
      <View testID={`hotel-price-${hotel.hid}`} style={styles.total}>
        {!!price && <Txt kind="small">{L.totalFrom}</Txt>}
        <MoneyText money={price}/>
        {!!stayContext && <Txt kind="small" style={styles.note}>{stayContext}</Txt>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('viewStay')} onPress={open}
        style={({ pressed }) => [styles.openStay, pressed && styles.pressed]}>
        <Row style={{ justifyContent: 'center', gap: 4 }}><Txt kind="label" style={styles.white}>{t('viewStay')}</Txt><Icon name="chevron" color={colors.surface} size={15}/></Row>
      </Pressable>
    </Row>
    {feedback?.context === comparisonContextKey && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red, paddingHorizontal: 12, paddingBottom: 10 }}>
      {feedback.code === 'limit' ? L.compareLimit : feedback.code === 'context_changed' ? L.compareChanged : L.compareUnavailable}</Txt>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: .78 },
  white: { color: colors.surface },
  details: { paddingHorizontal: 16, paddingVertical: 13, gap: 5 },
  name: { fontSize: 21, lineHeight: 29 },
  stars: { color: colors.goldInk, letterSpacing: 1.5 },
  note: { fontSize: 12, lineHeight: 18 },
  overlay: { position: 'absolute', top: 9, left: 9, right: 9 },
  compactDetails: { minHeight: 124, justifyContent: 'center' },
  compactControls: { position: 'absolute', top: 10 },
  iconRail: { flexDirection: 'column-reverse', gap: 4 },
  actions: { gap: 8, justifyContent: 'space-between' },
  save: { width: 48, minHeight: 48, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  compare: { minHeight: 48, paddingHorizontal: 13, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  compareText: { fontSize: 13 },
  chosen: { backgroundColor: colors.navy, borderColor: colors.navy },
  total: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  footer: { paddingVertical: 10, paddingHorizontal: 16, gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' },
  openStay: { backgroundColor: colors.navy, borderRadius: 15, minHeight: 48, paddingHorizontal: 14, justifyContent: 'center' },
});
