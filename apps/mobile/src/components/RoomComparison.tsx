import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Button, Icon, Row, Txt } from './Primitives';
import { canReviewRoomOffer, type RoomChoiceEntry } from './roomChoiceModel';
import { roomChoiceCopy } from './roomChoiceCopy';
import { comparedPlanNames, mealDescription, rateCopy, roomFactKeys, roomRateFacts } from './roomRateFacts';
import { compareStayPrices } from './offerChangeSummary';
import { padStayPriceDifference } from './offerChangesCopy';
import Cancellation from './Cancellation';
import StayEstimate from './StayEstimate';
import Taxes from './Taxes';

interface Props {
  entries: RoomChoiceEntry[]; now: number; currency: string; visible: boolean;
  onClose: () => void; onReview: (entry: RoomChoiceEntry) => void;
}

const fields = ['price', 'meal', 'cancellation', 'fees', 'bedding', 'payment'] as const;
const icons = { price: 'trips', meal: 'meal', cancellation: 'clock', fees: 'pin', bedding: 'bed', payment: 'info' } as const;

export default function RoomComparison(props: Props) {
  if (!props.visible || props.entries.length !== 2) return null;
  return <ComparisonSheet key={JSON.stringify(props.entries.map(entry => entry.key))} {...props}/>;
}

function ComparisonSheet({ entries, now, currency, onClose, onReview }: Props) {
  const { language } = useLanguage();
  const ar = language === 'ar', copy = rateCopy(language), roomCopy = roomChoiceCopy(language);
  const [differentOnly, setDifferentOnly] = useState(false);
  const [detail, setDetail] = useState<'fees' | 'cancellation' | null>(null);
  const { width, height, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(fontScale, 1) < 305;
  const planLabels = comparedPlanNames(entries, language, now);
  const docked = !stacked && height > 580 && fontScale <= 1.4 && planLabels.every(label => label.length < 48);
  const facts = entries.map(entry => roomRateFacts(entry.offer, language, now));
  const [aKeys, bKeys] = entries.map(entry => roomFactKeys(entry.offer));
  const keys = fields.filter(key => key !== 'bedding' || entries.some(entry => entry.offer.bedding));
  const visibleKeys = keys.filter(key => !differentOnly || aKeys[key] !== bKeys[key]);
  const accessibleNames = entries.map((entry,i) => `${planLabels[i]} · ${entry.offer.name}`);
  const sameName = entries[0].offer.name === entries[1].offer.name;
  const price = compareStayPrices(entries[0].offer.price, entries[1].offer.price);
  let priceNote = '';
  if (price.status === 'unchanged') priceNote = ar ? 'سعر الغرفة متساوٍ في العرضين.' : 'Both offers have the same room price for the stay.';
  if (price.status === 'differentCurrency') priceNote = ar ? 'السعران بعملتين مختلفتين.' : 'The room prices are in different currencies.';
  if ((price.status === 'increase' || price.status === 'decrease') && price.difference) {
    const lower = planLabels[price.status === 'increase' ? 0 : 1];
    const delta = padStayPriceDifference(price.difference, language);
    const money = `\u2066${delta.currency}\u00a0${delta.amount}\u2069`;
    priceNote = ar ? `سعر الغرفة في ${lower} أقل بمقدار ${money} لكل الليالي.`
      : `${lower} costs ${money} less for the room across all nights.`;
  }
  const columns = { alignItems: 'stretch' as const, gap: 8, ...(stacked && { flexDirection: 'column' as const }) };
  const labelStyle = (i: number) => i === 0 ? styles.lilac : styles.leaf;
  const labels = <Row style={columns}>{entries.map((entry,i) => <View key={entry.key}
    style={[styles.legend, labelStyle(i), !stacked && styles.flex]}>
    <Txt kind="label">{planLabels[i]}</Txt>
    {!sameName && <Txt kind="small">{entry.offer.name}</Txt>}
  </View>)}</Row>;
  const keepLabels = docked && (sameName || entries.every(entry => entry.offer.name.length < 55));
  const actions = <Row style={{ ...columns, ...styles.actions }}>{entries.map((entry,i) =>
    <View key={entry.key} testID={`compare-review-${entry.index + 1}`} style={!stacked && styles.flex}>
      <Button compact disabled={!canReviewRoomOffer(entry.offer,currency)}
        title={ar ? `مراجعة · ${planLabels[i]}` : `Review · ${planLabels[i]}`}
        label={`${copy.choose} · ${accessibleNames[i]}`} onPress={() => { onClose(); onReview(entry); }}/>
    </View>)}</Row>;
  return <Modal transparent visible onRequestClose={onClose} animationType="slide">
    <SafeAreaView edges={['top','bottom']} style={styles.scrim}>
      <View testID="room-comparison" accessibilityViewIsModal style={[styles.sheet, { maxHeight: height * .94 }]}>
        <Row style={styles.header}><View style={styles.flex}>
          <Txt accessibilityRole="header" kind="heading" style={styles.heading}>{copy.compareTitle}</Txt>
          {sameName && <Txt kind="small" numberOfLines={docked ? 2 : 1} accessibilityLabel={entries[0].offer.name}>{entries[0].offer.name}</Txt>}
        </View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.close} onPress={onClose} style={styles.close}><Icon name="close" size={18}/></Pressable>
        </Row>
        {keepLabels && <View style={styles.inset}>{labels}</View>}
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.content}>
          {!keepLabels && (!stacked || !sameName) && labels}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: differentOnly }} aria-checked={differentOnly}
            onPress={() => setDifferentOnly(value => !value)} style={styles.toggle}>
            <Row style={{ gap: 8 }}><View style={[styles.box, differentOnly && styles.checked]}>
              {differentOnly && <Icon name="check" color={colors.surface} size={13}/>}</View>
              <Txt kind="label" style={styles.flex}>{copy.differences}</Txt></Row>
          </Pressable>
          {visibleKeys.map(key => <View key={key} testID={`comparison-row-${key}`} style={styles.fact}>
            <Row style={styles.factLabel}><Icon name={icons[key]} color={colors.violetInk} size={16}/>
              <Txt kind="label" style={styles.factTitle}>{copy[key]}</Txt></Row>
            <Row style={columns}>{entries.map((entry,i) => {
              const fact = facts[i];
              const value = key === 'meal' && (entries[0].offer.noChildMeal === true) !== (entries[1].offer.noChildMeal === true)
                ? mealDescription(entry.offer, language, true) : fact[key];
              return <View key={entry.key} style={[styles.cell, !stacked && styles.flex]}>
                {(!keepLabels || stacked) && <Txt kind="small" style={styles.small}>{planLabels[i]}</Txt>}
                {key === 'cancellation' ? <View accessible accessibilityLabel={`${accessibleNames[i]} · ${copy[key]} · ${value}`} style={{ gap: 4 }}>
                  <Txt kind="label" style={{ color: fact.decision.kind === 'free' ? colors.success : colors.ink }}>{fact.decision.headline}</Txt>
                  {!!fact.decision.detail && <Txt kind="small">{fact.decision.detail}</Txt>}
                </View> : <Txt accessibilityLabel={`${accessibleNames[i]} · ${copy[key]} · ${value}`} kind={key === 'price' ? 'heading' : 'label'}
                  style={key === 'price' ? [styles.amount, entry.offer.price && { writingDirection: 'ltr' }] : undefined}>{value}</Txt>}
                {key === 'price' && <StayEstimate money={entry.offer.price}/>}
              </View>;
            })}</Row>
            {key === 'price' && !!priceNote && <View testID="comparison-price-difference" style={styles.priceNote}><Txt kind="small" style={{ color: colors.leafInk }}>{priceNote}</Txt></View>}
            {(key === 'fees' || key === 'cancellation') && <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: detail === key }} aria-expanded={detail === key}
                onPress={() => setDetail(detail === key ? null : key)} style={styles.expand}>
                <Row style={{ gap: 8 }}><Txt kind="label" style={[styles.flex, { color: colors.violetInk }]}>{key === 'fees' ? copy.taxDetails : copy.schedules}</Txt>
                  <Txt accessible={false} kind="label">{detail === key ? '−' : '+'}</Txt></Row>
              </Pressable>
              {detail === key && entries.map((entry,i) => <View key={entry.key} style={styles.fullDetail}>
                <View style={[styles.legend, labelStyle(i)]}><Txt kind="label">{accessibleNames[i]}</Txt></View>
                {key === 'fees' ? <Taxes taxes={entry.offer.taxes} defaultExpanded/> : <Cancellation offer={entry.offer} now={now} defaultExpanded/>}
              </View>)}
            </>}
          </View>)}
          {!visibleKeys.length && <Txt style={styles.empty}>{ar ? 'لا يظهر فرق في الشروط المتاحة لهذين العرضين.' : 'No differences in the listed terms.'}</Txt>}
          {entries.map((entry, i) => !canReviewRoomOffer(entry.offer,currency) && <Txt kind="small" key={entry.key}>
            {planLabels[i]} · {entry.offer.price && entry.offer.price.currency !== currency
              ? roomCopy.currencyMismatch(entry.offer.price.currency, currency) : roomCopy.notReady}
          </Txt>)}
          {!docked && actions}
        </ScrollView>
        {docked && actions}
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(32,22,38,.46)', direction: 'ltr' },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
  heading: { fontSize: 22, lineHeight: 31 },
  close: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  inset: { paddingHorizontal: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 10, gap: 4 },
  legend: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10 },
  lilac: { backgroundColor: colors.lavenderMist },
  leaf: { backgroundColor: colors.pistachioMist },
  toggle: { minHeight: 48, justifyContent: 'center' },
  box: { width: 19, height: 19, borderRadius: 5, borderWidth: 1, borderColor: colors.muted, justifyContent: 'center', alignItems: 'center' },
  checked: { borderColor: colors.primary, backgroundColor: colors.primary },
  fact: { gap: 4, paddingBottom: 8, borderBottomColor: colors.border, borderBottomWidth: 1 },
  factLabel: { gap: 7, paddingTop: 7, paddingBottom: 2 },
  factTitle: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 21 },
  cell: { paddingHorizontal: 9, paddingVertical: 6, gap: 1 },
  amount: { fontSize: 20, lineHeight: 30, color: colors.ink },
  priceNote: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.pistachioMist },
  small: { fontSize: 12, lineHeight: 18 },
  expand: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.background },
  fullDetail: { gap: 8, paddingVertical: 5 },
  actions: { paddingHorizontal: 12, paddingVertical: 8, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface },
  empty: { paddingVertical: 14 },
});
