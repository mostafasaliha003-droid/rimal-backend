import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space } from '../theme';
import { Badge, Button, Icon, Row, TextLink, Txt } from './Primitives';
import { mealPlanTitle, rateCopy, roomPriceDifference, roomRateFacts } from './roomRateFacts';
import { canReviewRoomOffer, compareRoomAmounts, type RoomChoiceEntry } from './roomChoiceModel';
import { roomChoiceCopy } from './roomChoiceCopy';
import { useChargeMoney } from './ChargeCurrency';
import OfferTermsSheet from './OfferTermsSheet';
import { formatPrice } from './format';
import { useLayout } from './motion';
import { localizedRoomName } from './roomNameModel';

interface OptionsProps {
  entries: readonly RoomChoiceEntry[]; selected: RoomChoiceEntry; preferredKey?: string; groupName: string; groupBedding?: string;
  currency: string; now: number; comparison: readonly RoomChoiceEntry[]; showCompare: boolean; reviewError: string;
  stayCaption: string;
  onSelect: (entry: RoomChoiceEntry) => void; onToggle: (entry: RoomChoiceEntry) => void; onReview: (entry: RoomChoiceEntry) => void;
  onRefresh: () => void; onEditSearch: () => void;
}
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/*
 * The rates of one room as flat rows inside the room's card: meal and price on the first
 * line, the cancellation deadline on the second, hotel-paid fees on the third, then the
 * actions. Every rate has its own "Review offer" button, so choosing is one tap. Rates
 * are never nested cards; the full terms open in a sheet.
 */
export default function RoomOfferPicker({ entries, selected, preferredKey, groupName, groupBedding, currency, now, comparison, showCompare, reviewError, stayCaption,
  onSelect, onToggle, onReview, onRefresh, onEditSearch }: OptionsProps) {
  const charge = useChargeMoney();
  const { language, t } = useLanguage();
  const { narrow } = useLayout();
  const ar = language === 'ar', multiple = entries.length > 1;
  const rate = rateCopy(language), room = roomChoiceCopy(language);
  const [limit, setLimit] = useState(3);
  const [termsKey, setTermsKey] = useState<string | null>(null);
  const terms = entries.find(item => item.key === termsKey);
  const visible = entries.slice(0, limit);
  if (!visible.some(entry => entry.key === selected.key)) visible.push(selected);
  const remaining = entries.length - visible.length;
  const first = entries[0];
  const basePrice = multiple && first.key === preferredKey && entries.every(entry => canReviewRoomOffer(entry.offer, currency)) ? first.offer.price : null;
  const distinguishLowest = !!basePrice && entries.some(entry => compareRoomAmounts(entry.offer.price!.amount, basePrice.amount) > 0);

  return <View testID={multiple ? 'room-offer-picker' : undefined}>
    {visible.map(entry => {
      const offer = entry.offer, number = entry.index + 1;
      const active = entry.key === selected.key;
      const compared = comparison.some(item => item.key === entry.key);
      const disableCompare = !compared && comparison.length >= 2;
      const canReview = canReviewRoomOffer(offer, currency);
      const facts = roomRateFacts(offer, language, now, charge);
      const cheapest = distinguishLowest && basePrice && compareRoomAmounts(offer.price!.amount, basePrice.amount) === 0;
      const title = mealPlanTitle(offer.meal, language);
      const shownName = localizedRoomName(offer.name, language);
      const reviewLabel = [rate.choose, title, shownName, facts.price].join(' · ');
      const difference = roomPriceDifference(charge(basePrice), charge(offer.price), language);
      const mismatch = Boolean(offer.price && offer.price.currency !== currency);
      const price = formatPrice(charge(offer.price)) || facts.price;
      const free = facts.decision.kind === 'free';
      const cancelTone = free ? color.success : facts.decision.nonRefundable ? color.danger : color.textPrimary;
      const fees = facts.fees === rate.included ? null : facts.fees;
      return <View key={entry.key} testID={entry.key === preferredKey && multiple ? 'lowest-reviewable-rate' : undefined}
        style={[styles.rate, active && multiple && styles.rateActive]}>
        <Pressable testID={`pick-rate-${number}`} accessibilityRole={multiple ? 'radio' : undefined} aria-checked={multiple ? active : undefined}
          accessibilityState={multiple ? { checked: active } : undefined} accessibilityLabel={[facts.meal, facts.price, facts.decision.headline, shownName].join(' · ')}
          accessibilityHint={multiple ? (ar ? 'يعرض صور هذا العرض' : 'Shows this rate’s photos') : undefined}
          disabled={!multiple} onPress={() => onSelect(entry)} style={state => [styles.summary, (state.pressed || hovered(state)) && multiple && !active && { backgroundColor: color.bgMuted }]}>
          <Row style={{ gap: space.sm, alignItems: 'flex-start', justifyContent: 'space-between', ...(narrow && { flexDirection: 'column', alignItems: 'stretch' }) }}>
            <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
              <Row style={{ gap: space.xs, alignItems: 'center' }}>
                <Icon name={offer.meal && offer.meal.toLowerCase() !== 'nomeal' ? 'coffee' : 'bed'} size={16} color={color.textBrand}/>
                <Txt kind="bodyStrong" style={{ flexShrink: 1 }}>{title}</Txt>
              </Row>
              {cheapest && <Badge tone="success" label={ar ? 'أقل سعر لهذه الغرفة' : 'Lowest price for this room'}/>}
            </View>
            <View style={{ alignItems: narrow ? 'flex-start' : 'flex-end' }}>
              <Txt kind="subheading" style={styles.amount}>{price}</Txt>
              <Txt kind="caption" align={narrow ? 'start' : 'end'}>{stayCaption}</Txt>
            </View>
          </Row>
          <Row testID={active ? 'rate-cancellation-summary' : undefined} style={{ gap: space.xs, alignItems: 'flex-start' }}>
            <View style={{ paddingTop: 3 }}><Icon name={free ? 'checkCircle' : facts.decision.nonRefundable ? 'alertCircle' : 'clock'} size={15} color={cancelTone}/></View>
            <Txt kind="small" style={{ color: cancelTone, flex: 1, ...(free && { fontFamily: fonts.medium }) }}>{facts.decision.headline}</Txt>
          </Row>
          {fees && <Txt kind="caption" tone="primary">{ar ? `يُدفع في الفندق: ${fees}` : `Due at the property: ${fees}`}</Txt>}
          {facts.meal !== title && <Txt kind="caption" tone="warning">{ar ? 'وجبات الأطفال غير مشمولة' : 'Children’s meals excluded'}</Txt>}
          {offer.bedding && offer.bedding !== groupBedding && <Txt kind="caption" tone="primary">{offer.bedding}</Txt>}
          {offer.name !== groupName && <Txt kind="caption">{shownName}</Txt>}
          {difference && <Txt testID={`rate-difference-${number}`} kind="caption">{difference}</Txt>}
        </Pressable>
        <Row style={styles.actions}>
          <Row style={{ gap: space.md, flexShrink: 1 }}>
            {showCompare && <Pressable testID={`compare-rate-${number}`} accessibilityRole="checkbox" aria-checked={compared}
              accessibilityState={{ checked: compared, disabled: disableCompare }} accessibilityLabel={`${rate.compare} · ${title} · ${shownName} · ${facts.price}`}
              disabled={disableCompare} onPress={() => onToggle(entry)} hitSlop={{ top: 6, bottom: 6 }}
              style={state => [styles.compare, (state.pressed || hovered(state)) && { opacity: 0.7 }, disableCompare && { opacity: 0.45 }]}>
              <Row style={{ gap: space.xs }}>
                <View style={[styles.box, compared && styles.boxOn]}>{compared && <Icon name="check" size={12} strokeWidth={3} color={color.textOnDark}/>}</View>
                <Txt kind="small" tone="primary">{rate.compare}</Txt>
              </Row>
            </Pressable>}
            <TextLink testID={`terms-rate-${number}`} title={ar ? 'الشروط' : 'Terms'} label={`${rate.terms} · ${title} · ${shownName}`} onPress={() => setTermsKey(entry.key)}/>
          </Row>
          <View testID={`review-rate-${number}`}>
            <Button compact title={ar ? 'اختر' : 'Select'} label={reviewLabel} disabled={!canReview} onPress={() => onReview(entry)}/>
          </View>
        </Row>
        {!canReview && <View style={styles.recovery}>
          <Txt kind="small">{mismatch ? room.currencyMismatch(offer.price!.currency, currency) : room.notReady}</Txt>
          <Button compact variant="quiet" title={mismatch ? t('searchAgain') : t('retry')} onPress={mismatch ? onEditSearch : onRefresh}/>
        </View>}
        {reviewError === entry.key && <View style={styles.recovery}>
          <Txt accessibilityRole="alert" kind="small" tone="danger">{t('reviewExpiredBody')}</Txt>
          <Button compact variant="secondary" icon="refresh" title={t('retry')} onPress={onRefresh}/>
        </View>}
      </View>;
    })}
    {remaining > 0 && <View style={styles.more}><Button testID="more-room-options" compact variant="quiet" iconEnd="chevronDown"
      title={ar ? `المزيد من العروض (${remaining})` : `More rates (${remaining})`} onPress={() => setLimit(n => n + 4)}/></View>}
    {!!terms && <OfferTermsSheet offer={terms.offer} roomName={terms.offer.name} visible now={now} onClose={() => setTermsKey(null)}/>}
  </View>;
}

const styles = StyleSheet.create({
  rate: { borderTopWidth: 1, borderTopColor: color.border },
  rateActive: { backgroundColor: color.bgMuted },
  summary: { paddingHorizontal: space.md, paddingTop: space.sm + 2, paddingBottom: space.xs, gap: space.xs },
  amount: { writingDirection: 'ltr' },
  actions: { justifyContent: 'space-between', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  compare: { minHeight: 32, justifyContent: 'center' },
  box: { width: 18, height: 18, borderWidth: 1.5, borderColor: color.borderControl, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSurface },
  boxOn: { backgroundColor: color.interactive, borderColor: color.interactive },
  recovery: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.xs },
  more: { borderTopWidth: 1, borderTopColor: color.border, paddingVertical: space.xxs, alignItems: 'center', borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
