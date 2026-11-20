import React, { useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useRouter } from 'expo-router';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { color, elevation, radius, space, touch } from '../theme';
import { useAppState } from './AppState';
import { Badge, Icon, Photo, Row, Txt } from './Primitives';
import { priceInCurrency, stayNights } from './resultsDecisionModel';
import { useChargeMoney } from './ChargeCurrency';
import { resultsCopy } from './resultsCopy';
import { formatMoney, stayLine } from './format';
import { useLayout, useReducedMotion } from './motion';
import { useToast } from './Toast';

const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

export function StarRating({ stars, size = 14 }: { stars?: number; size?: number }) {
  const { language } = useLanguage();
  const valid = Number.isInteger(stars) && Number(stars) >= 1 && Number(stars) <= 5;
  if (!valid) return <Txt kind="caption">{language === 'ar' ? 'التصنيف غير متوفر' : 'Rating not supplied'}</Txt>;
  return <Row accessible accessibilityRole="image" accessibilityLabel={language === 'ar' ? `فندق ${stars} نجوم` : `${stars}-star hotel`} style={{ gap: 1 }}>
    {Array.from({ length: Number(stars) }, (_, index) => <Icon key={index} name="star" filled size={size} color={color.rating}/>)}
  </Row>;
}

export default function HotelCard({ hotel, comparisonDisabled = false, variant = 'list', recentlyViewed = false, onOpen }: {
  hotel: HotelSummary; comparisonDisabled?: boolean; variant?: 'list' | 'photo'; recentlyViewed?: boolean; onOpen?: (hid: number) => void;
}) {
  const charge = useChargeMoney();
  const { t, language, rtl } = useLanguage(), L = resultsCopy(language), router = useRouter();
  const ar = language === 'ar';
  const { criteria, saved, savedReady, toggleSaved, comparisonItems, comparisonContextKey, toggleComparison } = useAppState();
  const toast = useToast();
  const reduced = useReducedMotion();
  const { wide, width } = useLayout();
  const thumbWidth = wide ? 184 : width < 360 ? 104 : 120;
  const selected = saved.includes(hotel.hid), compared = comparisonItems.some(item => item.hid === hotel.hid);
  const [feedback, setFeedback] = useState<{ context: string; code: 'limit' | 'context_changed' | 'unavailable' } | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<ReadonlySet<string>>(() => new Set());
  const [pop] = useState(() => new Animated.Value(1));
  const hasPhoto = [hotel.imageUrl, ...(hotel.images || [])].some(uri => uri && !failedPhotos.has(uri));
  const open = () => { onOpen?.(hotel.hid); router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } }); };
  const price = priceInCurrency(hotel.price, criteria?.currency || ''), nights = stayNights(criteria);
  const stay = criteria ? stayLine(nights, criteria.guests, language) : '';
  const compare = () => {
    const result = toggleComparison(hotel, comparisonContextKey);
    setFeedback(result === 'added' || result === 'removed' ? null : { context: comparisonContextKey, code: result });
  };
  const save = () => {
    const adding = !selected;
    toggleSaved(hotel.hid);
    if (!reduced) Animated.sequence([
      Animated.spring(pop, { toValue: 1.25, useNativeDriver: Platform.OS !== 'web', speed: 40, bounciness: 12 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: Platform.OS !== 'web', speed: 30 }),
    ]).start();
    toast(adding ? { message: ar ? `حُفظ ${hotel.name} في المفضلة` : `${hotel.name} saved`, icon: 'saved', action: { label: ar ? 'عرض المفضلة' : 'View saved', onPress: () => router.navigate('/saved') } }
      : { message: ar ? 'أُزيل من المفضلة' : 'Removed from saved', icon: 'info', action: { label: ar ? 'تراجع' : 'Undo', onPress: () => toggleSaved(hotel.hid) } });
  };
  const priceText = formatMoney(charge(price));
  const onPhotoError = (uri: string) => setFailedPhotos(previous => new Set(previous).add(uri));
  const notice = feedback?.context === comparisonContextKey && <Txt accessibilityRole="alert" kind="small" style={styles.notice}>
    {feedback.code === 'limit' ? L.compareLimit : feedback.code === 'context_changed' ? L.compareChanged : L.compareUnavailable}</Txt>;

  const heart = <Animated.View style={{ transform: [{ scale: pop }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t(selected ? 'removeSaved' : 'saveStay')}: ${hotel.name}`} aria-pressed={selected}
      accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={save} testID={`hotel-save-${hotel.hid}`}
      style={state => [styles.heart, elevation.card, (state.pressed || hovered(state)) && { backgroundColor: color.bgSelected }]}>
      <Icon name="saved" size={20} filled={selected} color={selected ? color.danger : color.textBrand}/>
    </Pressable>
  </Animated.View>;
  const compareToggle = <Pressable testID={`hotel-compare-${hotel.hid}`} accessibilityRole="checkbox" aria-checked={compared}
    accessibilityState={{ checked: compared, disabled: comparisonDisabled || !comparisonContextKey }}
    accessibilityLabel={`${compared ? L.compareAdded : L.compare}: ${hotel.name}`} disabled={comparisonDisabled || !comparisonContextKey} onPress={compare}
    style={state => [styles.compare, compared && styles.compared, (state.pressed || hovered(state)) && !compared && { backgroundColor: color.bgMuted },
      (comparisonDisabled || !comparisonContextKey) && { opacity: 0.45 }]}>
    <Row style={{ gap: space.xs }}>
      <View style={[styles.box, compared && styles.boxChecked]}>{compared && <Icon name="check" size={12} strokeWidth={3} color={color.textOnDark}/>}</View>
      <Txt kind="micro" style={{ color: compared ? color.interactiveStrong : color.textBrand }}>{L.compare}</Txt>
    </Row>
  </Pressable>;

  const priceBlock = <View testID={`hotel-price-${hotel.hid}`} style={[styles.price, { alignItems: rtl ? 'flex-start' : 'flex-end' }]}>
    {priceText ? <>
      <Txt kind="caption" align="end">{ar ? 'الإجمالي' : 'Total'} · {stay}</Txt>
      <Txt kind="price" align="end" style={styles.amount}>{priceText}</Txt>
    </> : <>
      <Txt kind="caption" align="end">{stay}</Txt>
      <Txt kind="small" align="end">{ar ? 'لا يتوفر سعر لهذه التواريخ' : 'No price for these dates'}</Txt>
    </>}
  </View>;

  const summary = <>
    <Row style={{ gap: space.sm, justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <StarRating stars={hotel.stars} size={13}/>
      {recentlyViewed && <Badge tone="info" icon="history" label={ar ? 'شاهدته مؤخراً' : 'Recently viewed'}/>}
    </Row>
    <Txt kind="subheading" numberOfLines={2} accessibilityRole="header">{hotel.name}</Txt>
    {!!hotel.address && <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}><Icon name="pin" size={14} color={color.textSecondary}/></View>
      <Txt kind="caption" numberOfLines={1} style={{ flex: 1 }}>{hotel.address}</Txt></Row>}
  </>;

  if (variant === 'photo') return <View testID={`hotel-card-${hotel.hid}`} style={[styles.card, recentlyViewed && styles.viewed]}>
    <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityHint={t('viewStay')}
      onPress={open} style={state => [(state.pressed || hovered(state)) && styles.pressed]}>
      <View style={{ aspectRatio: 16 / 10, width: '100%' }}>
        {hasPhoto ? <Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name} height="100%" onFailed={onPhotoError}/>
          : <Photo label={hotel.name} height="100%"/>}
      </View>
      <View style={styles.details}>{summary}{priceBlock}</View>
    </Pressable>
    <View pointerEvents="box-none" style={[styles.overlay, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>{compareToggle}{heart}</View>
    {notice}
  </View>;

  return <View testID={`hotel-card-${hotel.hid}`} style={[styles.card, recentlyViewed && styles.viewed]}>
    <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityHint={t('viewStay')}
      onPress={open} style={state => [{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'stretch' }, (state.pressed || hovered(state)) && styles.pressed]}>
      <View style={[styles.thumb, { width: thumbWidth }]}>
        {hasPhoto ? <Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name} height="100%" thumbnail onFailed={onPhotoError}/>
          : <Photo label={hotel.name} height="100%" thumbnail/>}
      </View>
      <View style={[styles.details, { flex: 1, minWidth: 0 }]}>
        {summary}
        <View style={{ flex: 1 }}/>
        {priceBlock}
      </View>
    </Pressable>
    <View pointerEvents="box-none" style={[styles.thumbOverlay, { width: thumbWidth - space.lg }, rtl ? { right: space.sm, alignItems: 'flex-end' } : { left: space.sm, alignItems: 'flex-start' }]}>
      {heart}{compareToggle}
    </View>
    {notice}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.border },
  viewed: { borderColor: color.infoBorder, borderWidth: 1.5 },
  pressed: { backgroundColor: color.bgMuted },
  details: { paddingHorizontal: space.md, paddingVertical: space.md, gap: space.xs },
  thumb: { minHeight: 168, backgroundColor: color.photoPlaceholder },
  thumbOverlay: { position: 'absolute', top: space.sm, bottom: space.sm, justifyContent: 'space-between' },
  overlay: { position: 'absolute', top: space.sm, left: space.sm, right: space.sm, justifyContent: 'space-between' },
  heart: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.95)', margin: 2 },
  compare: { minHeight: 32, minWidth: touch.min, paddingHorizontal: space.sm, borderRadius: radius.pill, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)', borderWidth: 1, borderColor: color.borderControl },
  compared: { backgroundColor: color.bgSelected, borderColor: color.borderSelected },
  box: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSurface },
  boxChecked: { backgroundColor: color.interactive, borderColor: color.interactive },
  price: { gap: 0, marginTop: space.xs },
  amount: { writingDirection: 'ltr' },
  notice: { color: color.danger, paddingHorizontal: space.md, paddingBottom: space.sm },
});
