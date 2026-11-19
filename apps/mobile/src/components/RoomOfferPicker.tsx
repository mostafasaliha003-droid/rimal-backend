import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { Button, Icon, Row, Txt } from './Primitives';
import { rateCopy, roomRateFacts } from './roomRateFacts';
import { canReviewRoomOffer, compareRoomAmounts, type RoomChoiceEntry } from './roomChoiceModel';
import { roomChoiceCopy } from './roomChoiceCopy';
import OfferTermsSheet from './OfferTermsSheet';

interface OptionsProps {
  entries: readonly RoomChoiceEntry[]; selected: RoomChoiceEntry; preferredKey?: string; groupName: string;
  currency: string; now: number; comparison: readonly RoomChoiceEntry[]; showCompare: boolean; reviewError: string;
  onSelect: (entry: RoomChoiceEntry) => void; onToggle: (entry: RoomChoiceEntry) => void; onReview: (entry: RoomChoiceEntry) => void;
  onRefresh: () => void; onEditSearch: () => void;
}

export default function RoomOfferPicker({ entries, selected, preferredKey, groupName, currency, now, comparison, showCompare, reviewError,
  onSelect, onToggle, onReview, onRefresh, onEditSearch }: OptionsProps) {
  const { language, t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
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
  const stacked = width / Math.max(1, fontScale) < 335;

  return <View style={styles.picker} testID={multiple ? 'room-offer-picker' : undefined}>
    {multiple && <Row style={{ gap: 5, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Txt kind="label" accessibilityRole="header" style={styles.title}>{ar ? 'خيارات الإقامة' : 'Rate options'}</Txt>
      <Txt kind="small">{ar ? 'السعر لكل الليالي' : 'Full-stay prices'}</Txt>
    </Row>}
    {visible.map(entry => {
      const offer = entry.offer, number = entry.index + 1;
      const active = entry.key === selected.key;
      const compared = comparison.some(item => item.key === entry.key);
      const disableCompare = !compared && comparison.length >= 2;
      const canReview = canReviewRoomOffer(offer, currency);
      const facts = roomRateFacts(offer, language, now);
      const cheapest = distinguishLowest && basePrice && compareRoomAmounts(offer.price!.amount, basePrice.amount) === 0;
      const reviewLabel = `${room.reviewRate(number)} · ${offer.name}`;
      const mismatch = Boolean(offer.price && offer.price.currency !== currency);
      const price = offer.price ? `\u2066${offer.price.currency}\u00a0${offer.price.amount}\u2069` : facts.price;
      const rateHeading = <Row style={{ gap: 8, alignItems: 'flex-start' }}>
        {multiple && <View style={[styles.circle, active && styles.selectedCircle]}>{active && <Icon name="check" size={12} color={colors.surface}/>}</View>}
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          {cheapest && <Txt kind="label" style={styles.lowest}>{ar ? 'أقل سعر غرفة ضمن الخيارات' : 'Lowest room price shown'}</Txt>}
          <Row style={{ gap: 7, alignItems: 'baseline', flexWrap: 'wrap', ...(stacked && { flexDirection: 'column', alignItems: 'stretch' }) }}>
            <Txt kind="label" style={styles.meal}>{facts.meal}</Txt>
            <Txt kind="heading" style={[styles.price, offer.price && { writingDirection: 'ltr' }]}>{price}</Txt>
          </Row>
          {offer.name !== groupName && <Txt kind="small">{offer.name}</Txt>}
          {!multiple && <Txt kind="small">{ar ? 'السعر لكل الليالي' : 'Full-stay price'}</Txt>}
        </View>
      </Row>;
      return <View key={entry.key} testID={entry.key === preferredKey && multiple ? 'lowest-reviewable-rate' : undefined}
        style={[styles.card, active && multiple && styles.selectedCard]}>
        {multiple ? <Pressable testID={`pick-rate-${number}`} accessibilityRole="button" aria-pressed={active}
          accessibilityState={{ selected: active }} accessibilityLabel={[facts.meal, facts.price, facts.decision.headline, offer.name].join(' · ')}
          onPress={() => onSelect(entry)} style={({ pressed }) => [styles.heading, active && styles.activeHeading, pressed && styles.pressed]}>
          {rateHeading}
        </Pressable> : <View style={styles.heading}>{rateHeading}</View>}
        <View style={styles.body}>
          <View testID={active ? 'rate-cancellation-summary' : undefined} style={{ gap: 3 }}>
            <Row style={{ gap: 7, alignItems: 'flex-start' }}>
              <Icon name={facts.decision.kind === 'free' ? 'check' : 'clock'} size={16} color={facts.decision.kind === 'free' ? colors.success : colors.muted}/>
              <Txt kind="small" style={[styles.fill, { color: facts.decision.kind === 'free' ? colors.success : colors.ink, fontFamily: fonts.medium }]}>{facts.decision.headline}</Txt>
            </Row>
            {active && !!facts.decision.detail && <Txt kind="small">{facts.decision.detail}</Txt>}
          </View>
          <Row style={{ gap: 7, alignItems: 'flex-start' }}><Icon name="info" size={16} color={colors.muted}/>
            <Txt kind="small" style={styles.fill}>{rate.fees} · {facts.fees}</Txt></Row>
          {active && <Row style={{ gap: 7, alignItems: 'flex-start' }}><Icon name="info" size={16} color={colors.muted}/>
            <Txt kind="small" style={styles.fill}>{rate.payment} · {facts.payment}</Txt></Row>}
          {active && offer.bedding && <Row style={{ gap: 7, alignItems: 'flex-start' }}><Icon name="bed" size={16} color={colors.muted}/>
            <Txt kind="small" style={styles.fill}>{facts.bedding}</Txt></Row>}
        </View>
        <View style={ui.rule}/>
        <Row style={styles.actions}>
          <Pressable testID={`terms-rate-${number}`} accessibilityRole="button" aria-expanded={termsKey === entry.key}
            accessibilityState={{ expanded: termsKey === entry.key }} accessibilityLabel={`${rate.terms} · ${reviewLabel}`}
            onPress={() => setTermsKey(entry.key)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <Txt kind="label" style={styles.link}>{ar ? 'شروط العرض' : 'Rate terms'}</Txt>
          </Pressable>
          {showCompare && <Pressable testID={`compare-rate-${number}`} accessibilityRole="checkbox" aria-checked={compared}
            accessibilityState={{ checked: compared, disabled: disableCompare }} accessibilityLabel={`${rate.compare} · ${reviewLabel}`}
            disabled={disableCompare} onPress={() => onToggle(entry)}
            style={({ pressed }) => [styles.action, compared && styles.compared, pressed && styles.pressed, disableCompare && { opacity: .5 }]}>
            <Row style={{ gap: 5 }}><Icon name={compared ? 'check' : 'compare'} size={15} color={colors.violetInk}/>
              <Txt kind="label" style={styles.link}>{compared ? rate.selected : rate.compare}</Txt></Row>
          </Pressable>}
          <View testID={`review-rate-${number}`} style={styles.review}>
            <Button compact variant={active ? 'primary' : 'secondary'} title={ar ? 'مراجعة' : 'Review'} label={reviewLabel} disabled={!canReview} onPress={() => onReview(entry)}/>
          </View>
        </Row>
        {!canReview && <View style={styles.recovery}>
          <Txt kind="small">{mismatch ? room.currencyMismatch(offer.price!.currency, currency) : room.notReady}</Txt>
          <Button variant="quiet" title={mismatch ? t('searchAgain') : t('retry')} onPress={mismatch ? onEditSearch : onRefresh}/>
        </View>}
        {reviewError === entry.key && <View style={styles.recovery}>
          <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('reviewExpiredBody')}</Txt>
          <Button variant="secondary" title={t('retry')} onPress={onRefresh}/>
        </View>}
      </View>;
    })}
    {remaining > 0 && <Pressable accessibilityRole="button" testID="more-room-options" onPress={() => setLimit(n => n + 4)} style={styles.more}>
      <Row style={{ gap: 6 }}><Txt kind="label" style={{ color: colors.violetInk }}>{ar ? `المزيد من الخيارات (${remaining})` : `More options (${remaining})`}</Txt>
        <Icon name="chevron" size={14} color={colors.violetInk}/></Row>
    </Pressable>}
    {!!terms && <OfferTermsSheet offer={terms.offer} roomName={terms.offer.name} visible now={now} onClose={() => setTermsKey(null)}/>}
  </View>;
}

const styles = StyleSheet.create({
  picker: { padding: 12, gap: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  title: { fontSize: 17, lineHeight: 25 },
  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 15, overflow: 'hidden' },
  selectedCard: { borderColor: colors.grape },
  heading: { paddingHorizontal: 11, paddingVertical: 11, minHeight: 48, justifyContent: 'center' },
  activeHeading: { backgroundColor: colors.lavenderMist },
  lowest: { fontSize: 12, lineHeight: 18, color: colors.violetInk },
  meal: { fontSize: 16, lineHeight: 23, flexGrow: 1, flexShrink: 1 },
  price: { fontSize: 20, lineHeight: 26, color: colors.primary, flexShrink: 1 },
  pressed: { opacity: .76 },
  fill: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 12, paddingBottom: 9, paddingTop: 7, gap: 6 },
  actions: { justifyContent: 'space-between', gap: 4, flexWrap: 'wrap', paddingHorizontal: 7, paddingVertical: 5 },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  link: { fontSize: 13, lineHeight: 20, color: colors.violetInk },
  compared: { borderRadius: 10, backgroundColor: colors.lavenderMist },
  review: { minWidth: 80, maxWidth: '100%', flexGrow: 1, flexBasis: 74 },
  circle: { marginTop: 4, width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  selectedCircle: { backgroundColor: colors.grape, borderColor: colors.grape },
  more: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  recovery: { padding: 10, gap: 5 },
});
