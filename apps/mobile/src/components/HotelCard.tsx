import React, { useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useRouter } from 'expo-router';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { color, elevation, fonts, radius, space } from '../theme';
import { useAppState } from './AppState';
import { Icon, Photo, Row, Txt } from './Primitives';
import { priceInCurrency, stayNights } from './resultsDecisionModel';
import { useChargeMoney } from './ChargeCurrency';
import { resultsCopy } from './resultsCopy';
import { formatPrice, stayLine, stayWords } from './format';
import { useLayout, useReducedMotion } from './motion';
import { useToast } from './Toast';
import { haptic } from './haptics';
import { rememberHotelPreview } from './hotelPreview';

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
  const thumbWidth = wide ? 184 : width < 360 ? 104 : 116;
  const selected = saved.includes(hotel.hid), compared = comparisonItems.some(item => item.hid === hotel.hid);
  const [feedback, setFeedback] = useState<{ context: string; code: 'limit' | 'context_changed' | 'unavailable' } | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<ReadonlySet<string>>(() => new Set());
  const [pop] = useState(() => new Animated.Value(1));
  const hasPhoto = [hotel.imageUrl, ...(hotel.images || [])].some(uri => uri && !failedPhotos.has(uri));
  const shownPhoto = [hotel.imageUrl, ...(hotel.images || [])].find(uri => uri && !failedPhotos.has(uri));
  const open = () => {
    onOpen?.(hotel.hid);
    // The hotel page opens on the photo the traveler just tapped while its rooms load.
    rememberHotelPreview(hotel.hid, { name: hotel.name, photo: shownPhoto, stars: hotel.stars, address: hotel.address });
    router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } });
  };
  const price = priceInCurrency(hotel.price, criteria?.currency || ''), nights = stayNights(criteria);
  const stay = criteria ? stayLine(nights, criteria.guests, language) : '';
  const compare = () => {
    const result = toggleComparison(hotel, comparisonContextKey);
    if (result === 'added' || result === 'removed') haptic(result === 'added' ? 'toggleOn' : 'toggleOff');
    setFeedback(result === 'added' || result === 'removed' ? null : { context: comparisonContextKey, code: result });
  };
  const save = () => {
    const adding = !selected;
    haptic(adding ? 'toggleOn' : 'toggleOff');
    toggleSaved(hotel.hid);
    if (!reduced) Animated.sequence([
      Animated.spring(pop, { toValue: 1.25, useNativeDriver: Platform.OS !== 'web', speed: 40, bounciness: 12 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: Platform.OS !== 'web', speed: 30 }),
    ]).start();
    toast(adding ? { message: ar ? `حُفظ ${hotel.name} في المفضلة` : `${hotel.name} saved`, icon: 'saved', action: { label: ar ? 'عرض المفضلة' : 'View saved', onPress: () => router.navigate('/saved') } }
      : { message: ar ? 'أُزيل من المفضلة' : 'Removed from saved', icon: 'info', action: { label: ar ? 'تراجع' : 'Undo', onPress: () => toggleSaved(hotel.hid) } });
  };
  const priceText = formatPrice(charge(price));
  // The stay (dates, guests, rooms) is stated once above the list; the card says what its total covers.
  const covers = nights ? (ar ? `الإجمالي لـ ${stayWords(language, { genitive: true }).nights(nights)}` : `Total for ${stayWords(language).nights(nights)}`) : (ar ? 'الإجمالي' : 'Total');
  const onPhotoError = (uri: string) => setFailedPhotos(previous => new Set(previous).add(uri));
  const notice = feedback?.context === comparisonContextKey && <Txt accessibilityRole="alert" kind="small" style={styles.notice}>
    {feedback.code === 'limit' ? L.compareLimit : feedback.code === 'context_changed' ? L.compareChanged : L.compareUnavailable}</Txt>;

  const heart = <Animated.View style={{ transform: [{ scale: pop }] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t(selected ? 'removeSaved' : 'saveStay')}: ${hotel.name}`} aria-pressed={selected}
      accessibilityState={{ selected, disabled: !savedReady }} disabled={!savedReady} onPress={save} hitSlop={4} testID={`hotel-save-${hotel.hid}`}
      style={state => [styles.heart, elevation.card, (state.pressed || hovered(state)) && { backgroundColor: color.bgSelected }]}>
      <Icon name="saved" size={20} filled={selected} color={selected ? color.danger : color.textBrand}/>
    </Pressable>
  </Animated.View>;
  // Compare is a quiet text toggle beside the stars: the photo keeps only the heart.
  const compareToggle = <Pressable testID={`hotel-compare-${hotel.hid}`} accessibilityRole="checkbox" aria-checked={compared}
    accessibilityState={{ checked: compared, disabled: comparisonDisabled || !comparisonContextKey }}
    accessibilityLabel={`${compared ? L.compareAdded : L.compare}: ${hotel.name}`} disabled={comparisonDisabled || !comparisonContextKey} onPress={compare}
    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
    style={state => [styles.compare, compared && styles.compared, (state.pressed || hovered(state)) && !compared && { backgroundColor: color.bgField },
      (comparisonDisabled || !comparisonContextKey) && { opacity: 0.45 }]}>
    <Row style={{ gap: space.xs }}>
      <View style={[styles.box, compared && styles.boxChecked]}>{compared && <Icon name="check" size={11} strokeWidth={3} color={color.textOnDark}/>}</View>
      <Txt kind="micro" style={{ color: compared ? color.interactiveStrong : color.textSecondary }}>{L.compare}</Txt>
    </Row>
  </Pressable>;

  // The average night helps compare stays of different lengths; the total stays the headline.
  const charged = charge(price);
  const perNight = charged && nights && nights > 1 ? formatPrice({ amount: String(Math.round(Number(charged.amount) / nights)), currency: charged.currency }) : '';
  const priceBlock = <View testID={`hotel-price-${hotel.hid}`} style={[styles.price, { alignItems: rtl ? 'flex-start' : 'flex-end' }]}>
    {priceText ? <>
      <Txt kind="price" align="end" accessibilityLabel={`${priceText} · ${ar ? 'الإجمالي' : 'Total'} · ${stay}`} style={styles.amount}>{priceText}</Txt>
      <Txt kind="caption" align="end" numberOfLines={2} testID={`hotel-covers-${hotel.hid}`}>{covers}{perNight ? (ar ? ` · ${perNight} لليلة` : ` · ${perNight}/night`) : ''}</Txt>
    </> : <>
      <Txt kind="caption" align="end">{stay}</Txt>
      <Txt kind="small" align="end">{ar ? 'لا يتوفر سعر لهذه التواريخ' : 'No price for these dates'}</Txt>
    </>}
  </View>;

  // Decision facts beside the price: free cancellation (stated exactly) and a recent visit.
  const cancel = priceText ? hotel.freeCancellation : undefined;
  const fact = (icon: 'checkCircle' | 'history', text: string, tint: string, testID?: string) => <Row testID={testID} style={{ gap: space.xs }}>
    <Icon name={icon} size={14} color={tint}/><Txt kind="caption" numberOfLines={1} style={{ color: tint, flexShrink: 1, fontFamily: fonts.medium }}>{text}</Txt></Row>;
  const facts = <>
    {cancel === 'lowest' && fact('checkCircle', ar ? 'إلغاء مجاني لهذا السعر' : 'Free cancellation at this price', color.success, `hotel-free-cancel-${hotel.hid}`)}
    {cancel === 'available' && fact('checkCircle', ar ? 'يتوفر خيار بإلغاء مجاني' : 'Free cancellation option', color.success, `hotel-free-cancel-${hotel.hid}`)}
    {recentlyViewed && fact('history', ar ? 'شاهدته مؤخراً' : 'Recently viewed', color.info)}
  </>;

  const summary = <>
    <Row style={{ gap: space.sm, justifyContent: 'space-between' }}>
      <StarRating stars={hotel.stars} size={13}/>
      {compareToggle}
    </Row>
    <Txt kind="subheading" numberOfLines={2} accessibilityRole="header" style={{ fontSize: 16 }}>{hotel.name}</Txt>
    {!!hotel.address && <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}><Icon name="pin" size={14} color={color.textSecondary}/></View>
      <Txt kind="caption" numberOfLines={1} style={{ flex: 1 }}>{hotel.address}</Txt></Row>}
    {facts}
  </>;
  const bottom = priceBlock;

  if (variant === 'photo') return <View testID={`hotel-card-${hotel.hid}`} style={[styles.card, recentlyViewed && styles.viewed]}>
    <Pressable testID={`hotel-open-${hotel.hid}`} accessibilityRole="button" accessibilityHint={t('viewStay')}
      onPress={open} style={state => [(state.pressed || hovered(state)) && styles.pressed]}>
      <View style={{ aspectRatio: 16 / 10, width: '100%' }}>
        {hasPhoto ? <Photo uri={hotel.imageUrl} alternatives={hotel.images} label={hotel.name} height="100%" onFailed={onPhotoError}/>
          : <Photo label={hotel.name} height="100%"/>}
      </View>
      <View style={styles.details}>{summary}{bottom}</View>
    </Pressable>
    <View pointerEvents="box-none" style={[styles.overlay, rtl ? { left: space.sm } : { right: space.sm }]}>{heart}</View>
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
        <View style={{ flex: 1, minHeight: space.xxs }}/>
        {bottom}
      </View>
    </Pressable>
    <View pointerEvents="box-none" style={[styles.thumbOverlay, rtl ? { right: space.sm } : { left: space.sm }]}>{heart}</View>
    {notice}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard, ...elevation.card },
  viewed: { borderColor: color.infoBorder, borderWidth: 1.5 },
  pressed: { backgroundColor: color.bgMuted },
  details: { paddingHorizontal: space.md, paddingVertical: space.sm + 2, gap: space.xxs + 1 },
  thumb: { minHeight: 150, backgroundColor: color.photoPlaceholder },
  thumbOverlay: { position: 'absolute', top: space.sm },
  overlay: { position: 'absolute', top: space.sm },
  heart: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.95)', margin: 2 },
  compare: { minHeight: 28, paddingHorizontal: space.xs + 2, borderRadius: radius.pill, justifyContent: 'center' },
  compared: { backgroundColor: color.bgSelected },
  box: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSurface },
  boxChecked: { backgroundColor: color.interactive, borderColor: color.interactive },
  price: { gap: 0, marginTop: space.xxs },
  amount: { writingDirection: 'ltr', fontSize: 20, lineHeight: 28 },
  notice: { color: color.danger, paddingHorizontal: space.md, paddingBottom: space.sm },
});
