import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space } from '../theme';
import { Badge, Button, Icon, Row, Txt, type IconName } from './Primitives';
import { mealPlanTitle, rateCopy, roomPriceDifference, roomRateFacts } from './roomRateFacts';
import { canReviewRoomOffer, compareRoomAmounts, type RoomChoiceEntry } from './roomChoiceModel';
import { roomChoiceCopy } from './roomChoiceCopy';
import StayEstimate from './StayEstimate';
import OfferTermsSheet from './OfferTermsSheet';
import { formatMoney } from './format';
import { useLayout } from './motion';

interface OptionsProps {
  entries: readonly RoomChoiceEntry[]; selected: RoomChoiceEntry; preferredKey?: string; groupName: string;
  currency: string; now: number; comparison: readonly RoomChoiceEntry[]; showCompare: boolean; reviewError: string;
  stayCaption: string;
  onSelect: (entry: RoomChoiceEntry) => void; onToggle: (entry: RoomChoiceEntry) => void; onReview: (entry: RoomChoiceEntry) => void;
  onRefresh: () => void; onEditSearch: () => void;
}
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

function Fact({ icon, children, tone }: { icon: IconName; children: React.ReactNode; tone?: string }) {
  return <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
    <View style={{ paddingTop: 2 }}><Icon name={icon} size={16} color={tone || color.textSecondary}/></View>
    <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
  </Row>;
}

export default function RoomOfferPicker({ entries, selected, preferredKey, groupName, currency, now, comparison, showCompare, reviewError, stayCaption,
  onSelect, onToggle, onReview, onRefresh, onEditSearch }: OptionsProps) {
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

  return <View style={styles.picker} testID={multiple ? 'room-offer-picker' : undefined}>
    {multiple && <Row style={{ gap: space.xs, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Txt kind="label" accessibilityRole="header">{ar ? `اختر العرض (${rate.plans(entries.length)})` : `Choose a rate (${rate.plans(entries.length)})`}</Txt>
      <Txt kind="caption">{ar ? 'الأسعار إجمالية لكامل الإقامة' : 'Prices are totals for the whole stay'}</Txt>
    </Row>}
    {visible.map(entry => {
      const offer = entry.offer, number = entry.index + 1;
      const active = entry.key === selected.key;
      const compared = comparison.some(item => item.key === entry.key);
      const disableCompare = !compared && comparison.length >= 2;
      const canReview = canReviewRoomOffer(offer, currency);
      const facts = roomRateFacts(offer, language, now);
      const cheapest = distinguishLowest && basePrice && compareRoomAmounts(offer.price!.amount, basePrice.amount) === 0;
      const title = mealPlanTitle(offer.meal, language);
      const reviewLabel = [rate.choose, title, offer.name, facts.price].join(' · ');
      const difference = roomPriceDifference(basePrice, offer.price, language);
      const mismatch = Boolean(offer.price && offer.price.currency !== currency);
      const price = formatMoney(offer.price) || facts.price;
      const free = facts.decision.kind === 'free';
      const cancelTone = free ? color.success : facts.decision.nonRefundable ? color.danger : color.textPrimary;
      const heading = <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        {multiple && <View style={[styles.radio, active && styles.radioOn]}>{active && <View style={styles.radioDot}/>}</View>}
        <View style={{ flex: 1, gap: space.xs, minWidth: 0 }}>
          <Row style={{ gap: space.sm, alignItems: 'flex-start', justifyContent: 'space-between', ...(narrow && { flexDirection: 'column', alignItems: 'stretch' }) }}>
            <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
              <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
                <View style={{ paddingTop: 4 }}><Icon name={offer.meal && offer.meal.toLowerCase() !== 'nomeal' ? 'coffee' : 'bed'} size={16} color={color.textBrand}/></View>
                <Txt kind="subheading" style={{ flexShrink: 1 }}>{title}</Txt>
              </Row>
              {cheapest && <Badge tone="success" label={ar ? 'أقل سعر لهذه الغرفة' : 'Lowest price for this room'}/>}
              {free && !cheapest && <Badge tone="success" icon="checkCircle" label={ar ? 'قابل للإلغاء مجاناً' : 'Free cancellation'}/>}
            </View>
            <View style={{ alignItems: narrow ? 'flex-start' : 'flex-end' }}>
              <Txt kind="price" style={styles.amount}>{price}</Txt>
              <Txt kind="caption" align={narrow ? 'start' : 'end'}>{stayCaption}</Txt>
              <StayEstimate money={offer.price}/>
            </View>
          </Row>
          {difference && <Txt testID={`rate-difference-${number}`} kind="caption">{difference}</Txt>}
        </View>
      </Row>;
      return <View key={entry.key} testID={entry.key === preferredKey && multiple ? 'lowest-reviewable-rate' : undefined}
        style={[styles.card, active && multiple && styles.cardActive]}>
        {multiple ? <Pressable testID={`pick-rate-${number}`} accessibilityRole="radio" aria-checked={active}
          accessibilityState={{ checked: active }} accessibilityLabel={[facts.meal, facts.price, facts.decision.headline, offer.name].join(' · ')}
          accessibilityHint={ar ? 'اختيار العرض للاطلاع على شروطه ومراجعته' : 'Select to see full terms and review this rate'}
          onPress={() => onSelect(entry)} style={state => [styles.heading, (state.pressed || hovered(state)) && !active && { backgroundColor: color.bgMuted }]}>
          {heading}
        </Pressable> : <View style={styles.heading}>{heading}</View>}
        <View style={styles.body}>
          <Fact icon={free ? 'checkCircle' : facts.decision.nonRefundable ? 'alertCircle' : 'clock'} tone={cancelTone}>
            <View testID={active ? 'rate-cancellation-summary' : undefined}>
              <Txt kind="label" style={{ color: cancelTone }}>{facts.decision.headline}</Txt>
              {!!facts.decision.detail && <Txt kind="caption" tone="primary">{facts.decision.detail}</Txt>}
            </View>
          </Fact>
          {facts.meal !== title && <Fact icon="info" tone={color.warning}><Txt kind="small" tone="warning">{ar ? 'وجبات الأطفال غير مشمولة' : 'Children’s meals excluded'}</Txt></Fact>}
          {offer.bedding && <Fact icon="bed"><Txt kind="small" tone="primary">{offer.bedding}</Txt></Fact>}
          <Fact icon="card"><Txt kind="small" tone="primary">{rate.payment}: {facts.payment}</Txt></Fact>
          <Fact icon="hotel"><Txt kind="small" tone="primary">{ar ? 'يُدفع في الفندق' : 'Due at the property'}: <Txt kind="small" tone="primary" style={{ fontFamily: fonts.bold }}>{facts.fees}</Txt></Txt></Fact>
          {offer.name !== groupName && <Txt kind="caption">{offer.name}</Txt>}
        </View>
        <Row style={styles.actions}>
          {showCompare ? <Pressable testID={`compare-rate-${number}`} accessibilityRole="checkbox" aria-checked={compared}
            accessibilityState={{ checked: compared, disabled: disableCompare }} accessibilityLabel={`${rate.compare} · ${title} · ${offer.name} · ${facts.price}`}
            disabled={disableCompare} onPress={() => onToggle(entry)}
            style={state => [styles.action, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }, disableCompare && { opacity: 0.45 }]}>
            <Row style={{ gap: space.xs }}>
              <View style={[styles.box, compared && styles.boxOn]}>{compared && <Icon name="check" size={12} strokeWidth={3} color={color.textOnDark}/>}</View>
              <Txt kind="label">{rate.compare}</Txt>
            </Row>
          </Pressable> : <View/>}
          <Row style={{ gap: space.xs, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Pressable testID={`terms-rate-${number}`} accessibilityRole="button" aria-expanded={termsKey === entry.key}
              accessibilityState={{ expanded: termsKey === entry.key }} accessibilityLabel={`${rate.terms} · ${title} · ${offer.name}`}
              onPress={() => setTermsKey(entry.key)} style={state => [styles.action, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
              <Txt kind="label" tone="link">{ar ? 'الشروط كاملة' : 'Full terms'}</Txt>
            </Pressable>
            {active && <View testID={`review-rate-${number}`}>
              <Button compact title={rate.choose} label={reviewLabel} iconEnd="forward" disabled={!canReview} onPress={() => onReview(entry)}/>
            </View>}
          </Row>
        </Row>
        {!canReview && <View style={styles.recovery}>
          <Txt kind="small">{mismatch ? room.currencyMismatch(offer.price!.currency, currency) : room.notReady}</Txt>
          <Button variant="quiet" title={mismatch ? t('searchAgain') : t('retry')} onPress={mismatch ? onEditSearch : onRefresh}/>
        </View>}
        {reviewError === entry.key && <View style={styles.recovery}>
          <Txt accessibilityRole="alert" kind="small" tone="danger">{t('reviewExpiredBody')}</Txt>
          <Button variant="secondary" icon="refresh" title={t('retry')} onPress={onRefresh}/>
        </View>}
      </View>;
    })}
    {remaining > 0 && <Button testID="more-room-options" variant="quiet" iconEnd="chevronDown" title={ar ? `المزيد من العروض (${remaining})` : `More rates (${remaining})`} onPress={() => setLimit(n => n + 4)}/>}
    {!!terms && <OfferTermsSheet offer={terms.offer} roomName={terms.offer.name} visible now={now} onClose={() => setTermsKey(null)}/>}
  </View>;
}

const styles = StyleSheet.create({
  picker: { padding: space.md, gap: space.md, backgroundColor: color.bgCanvas, borderTopWidth: 1, borderTopColor: color.border },
  card: { borderWidth: 1, borderColor: color.border, backgroundColor: color.bgSurface, borderRadius: radius.md, overflow: 'hidden' },
  cardActive: { borderColor: color.borderSelected, borderWidth: 2 },
  heading: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  amount: { writingDirection: 'ltr' },
  body: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  actions: { justifyContent: 'space-between', gap: space.xs, flexWrap: 'wrap', paddingHorizontal: space.sm, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.border },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.sm },
  box: { width: 18, height: 18, borderWidth: 1.5, borderColor: color.borderControl, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: color.interactive, borderColor: color.interactive },
  radio: { marginTop: 4, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.interactive },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.interactive },
  recovery: { padding: space.md, gap: space.xs, borderTopWidth: 1, borderTopColor: color.border },
});
