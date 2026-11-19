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

export default function HotelCard({ hotel, comparisonDisabled = false, compact = false }: { hotel: HotelSummary; comparisonDisabled?: boolean; compact?: boolean }) {
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
  const stars = hasStars && <Txt kind="label" accessibilityLabel={`${hotel.stars} ${t('stars')}`} style={styles.stars}>{'★'.repeat(Number(hotel.stars))}</Txt>;
  const openHint = [hotel.address, hasStars && `${hotel.stars} ${t('stars')}`, price ? `${L.from} ${price.amount} ${price.currency}, ${L.stayTotal}` : t('priceUnknown'), stayContext].filter(Boolean).join('. ');
  const iconOnly = compact || !hasPhoto;
  const controls = <Row style={iconOnly ? styles.iconRail : styles.actions}>
      <Pressable testID={`hotel-compare-${hotel.hid}`} accessibilityRole="checkbox" aria-checked={compared} accessibilityState={{ checked: compared, disabled: comparisonDisabled || !comparisonContextKey }}
        accessibilityLabel={`${compared ? L.compareAdded : L.compare}: ${hotel.name}`} disabled={comparisonDisabled || !comparisonContextKey} onPress={compare}
        style={({ pressed }) => [iconOnly ? styles.save : styles.compare, compared && styles.chosen, pressed && styles.pressed]}>
        <Row style={{ gap: 6 }}><Icon name={compared ? 'check' : 'compare'} color={compared ? colors.surface : colors.navy} size={16}/>
          {!iconOnly && <Txt kind="label" style={[styles.compareText, compared && styles.white]}>{L.compare}</Txt>}</Row>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t(selected ? 'removeSaved' : 'saveStay')}: ${hotel.name}`} aria-pressed={selected}
        accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={() => toggleSaved(hotel.hid)}
        style={({ pressed }) => [styles.save, pressed && styles.pressed]}>
        {selected ? <Txt style={{ color: colors.red, fontSize: 22 }}>♥</Txt> : <Icon name="saved" size={20}/>}
      </Pressable>
    </Row>;
  const notice = feedback?.context === comparisonContextKey && <Txt accessibilityRole="alert" kind="small" style={styles.notice}>
    {feedback.code === 'limit' ? L.compareLimit : feedback.code === 'context_changed' ? L.compareChanged : L.compareUnavailable}</Txt>;
  const onPhotoError = (uri: string) => setFailedPhotos(previous => new Set(previous).add(uri));
  if (compact) return <View testID={`hotel-card-${hotel.hid}`} style={styles.card}>
    <Row style={styles.listRow}>
      <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityLabel={`${t('viewStay')}: ${hotel.name}`}
        accessibilityHint={openHint} onPress={open} style={({ pressed }) => [styles.listMain, pressed && styles.pressed]}>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          {hasPhoto && fontScale <= 1.4 && <View style={styles.thumbnail}><Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name}
            height="100%" thumbnail onFailed={onPhotoError}/></View>}
          <View style={styles.listDescription}>
            {stars}
            <Txt kind="heading" numberOfLines={fontScale <= 1.4 ? 2 : undefined} style={styles.listName}>{hotel.name}</Txt>
            {!!hotel.address && <Txt kind="small" numberOfLines={1}>{hotel.address}</Txt>}
            <View testID={`hotel-price-${hotel.hid}`}>{!!price && <Txt kind="small" style={styles.note}>{L.totalFrom}</Txt>}<MoneyText money={price}/></View>
          </View>
        </Row>
      </Pressable>
      {controls}
    </Row>
    {notice}
  </View>;
  return <View testID={`hotel-card-${hotel.hid}`} style={styles.card}>
    <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityLabel={`${t('viewStay')}: ${hotel.name}`}
      accessibilityHint={openHint}
      onPress={open} style={({ pressed }) => pressed && styles.pressed}>
      {hasPhoto && <View><Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name} height={photoHeight} onFailed={onPhotoError}/>
        {hasStars && <View style={[styles.rating, rtl ? { right: 12 } : { left: 12 }]}>{stars}</View>}</View>}
      <View style={[styles.details, !hasPhoto && [styles.compactDetails, rtl ? { paddingLeft: 70 } : { paddingRight: 70 }]]}>
        {!hasPhoto && stars}
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
        {!!price && <Txt kind="small" style={styles.note}>{L.totalFrom}{stayContext ? ` · ${stayContext}` : ''}</Txt>}
        <MoneyText money={price}/>
        {!price && !!stayContext && <Txt kind="small" style={styles.note}>{stayContext}</Txt>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('viewStay')} onPress={open}
        style={({ pressed }) => [styles.openStay, pressed && styles.pressed]}>
        <Row style={{ justifyContent: 'center', gap: 4 }}><Txt kind="label" style={styles.white}>{t('viewStay')}</Txt><Icon name="chevron" color={colors.surface} size={15}/></Row>
      </Pressable>
    </Row>
    {notice}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: .78 },
  white: { color: colors.surface },
  details: { paddingHorizontal: 15, paddingVertical: 10, gap: 4 },
  name: { fontSize: 21, lineHeight: 29 },
  stars: { color: colors.goldInk, fontSize: 13, lineHeight: 18, letterSpacing: 1 },
  rating: { position: 'absolute', bottom: 9, borderRadius: 8, backgroundColor: colors.softGold, paddingHorizontal: 8, paddingVertical: 2 },
  note: { fontSize: 13, lineHeight: 19 },
  overlay: { position: 'absolute', top: 9, left: 9, right: 9 },
  compactDetails: { minHeight: 110, justifyContent: 'center' },
  compactControls: { position: 'absolute', top: 10 },
  iconRail: { flexDirection: 'column-reverse', gap: 4 },
  actions: { gap: 8, justifyContent: 'space-between' },
  save: { width: 48, minHeight: 48, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  compare: { minHeight: 48, paddingHorizontal: 12, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  compareText: { fontSize: 13 },
  chosen: { backgroundColor: colors.navy, borderColor: colors.navy },
  total: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  footer: { paddingVertical: 10, paddingHorizontal: 16, gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' },
  openStay: { backgroundColor: colors.grape, borderRadius: 14, minHeight: 48, paddingHorizontal: 13, justifyContent: 'center' },
  listRow: { padding: 10, gap: 8, alignItems: 'center' },
  listMain: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center' },
  listDescription: { flex: 1, minWidth: 0, gap: 1 },
  listName: { fontSize: 17, lineHeight: 23 },
  thumbnail: { width: 75, height: 98, borderRadius: 13, overflow: 'hidden' },
  notice: { color: colors.red, paddingHorizontal: 12, paddingBottom: 10 },
});
