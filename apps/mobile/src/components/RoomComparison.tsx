import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { Button, Icon, Row, Txt } from './Primitives';
import { roomChoiceCopy } from './roomChoiceCopy';
import { canReviewRoomOffer, type RoomChoiceEntry } from './roomChoiceModel';
import { rateCopy, roomFactKeys, roomRateFacts } from './roomRateFacts';
import Cancellation from './Cancellation';
import Taxes from './Taxes';

export default function RoomComparison({ entries, now, currency, visible, onClose, onReview }: {
  entries: RoomChoiceEntry[]; now: number; currency: string; visible: boolean;
  onClose: () => void; onReview: (entry: RoomChoiceEntry) => void;
}) {
  const { language } = useLanguage(); const copy = rateCopy(language); const roomCopy = roomChoiceCopy(language);
  const [differentOnly, setDifferentOnly] = useState(false);
  const [detail, setDetail] = useState<'fees' | 'cancellation' | null>(null);
  const { width, height, fontScale } = useWindowDimensions();
  if (entries.length !== 2 || !visible) return null;
  const [a,b] = entries.map(entry => roomRateFacts(entry.offer, language, now));
  const [aKeys,bKeys] = entries.map(entry => roomFactKeys(entry.offer));
  const keys = (['price', 'bedding', 'meal', 'cancellation', 'payment', 'fees'] as const)
    .filter(key => key !== 'bedding' || entries.some(entry => entry.offer.bedding))
    .filter(key => !differentOnly || aKeys[key] !== bKeys[key]);
  const stacked = width / Math.max(fontScale, 1) < 305;
  const names = entries.map(entry => `${roomCopy.rateNumber(entry.index + 1)} · ${entry.offer.name}`);
  const close = () => { setDifferentOnly(false); setDetail(null); onClose(); };
  return <Modal transparent visible onRequestClose={close} animationType="slide">
    <SafeAreaView edges={['top','bottom']} style={styles.scrim}>
      <View testID="room-comparison" accessibilityViewIsModal style={[styles.sheet, { maxHeight: Math.max(180, height * .9) }]}>
        <Row style={{ gap: 12 }}><View style={styles.flex}><Txt accessibilityRole="header" kind="heading">{copy.compareTitle}</Txt></View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.close} onPress={close} style={styles.close}><Icon name="close" size={20}/></Pressable>
        </Row>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
          <Row style={{ gap: 8, alignItems: 'flex-start', ...(stacked && { flexDirection: 'column' as const }) }}>
            {entries.map(entry => <View key={entry.key} style={[styles.columnName, !stacked && styles.flex]}>
              <Txt kind="small">{roomCopy.rateNumber(entry.index + 1)}</Txt><Txt kind="label">{entry.offer.name}</Txt>
            </View>)}
          </Row>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: differentOnly }}
            onPress={() => setDifferentOnly(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Row style={{ gap: 9 }}><View style={[styles.box, differentOnly && { backgroundColor: colors.navy }]}>
              {differentOnly && <Icon name="check" color={colors.surface} size={15}/>}</View><Txt kind="label">{copy.differences}</Txt></Row>
          </Pressable>
          {keys.map(key => <View key={key} testID={`comparison-row-${key}`} style={[styles.fact, aKeys[key] !== bKeys[key] && styles.difference]}>
            <Txt kind="small" style={{ fontFamily: fonts.medium }}>{copy[key]}</Txt>
            <Row style={{ alignItems: 'stretch', gap: 12, ...(stacked && { flexDirection: 'column' as const }) }}>
              {[a[key],b[key]].map((value,i) => <View key={i} style={!stacked && styles.flex}>
                {stacked && <Txt kind="small">{roomCopy.rateNumber(entries[i].index + 1)}</Txt>}
                <Txt accessibilityLabel={`${names[i]} · ${copy[key]} · ${value}`} kind="label">{value}</Txt>
              </View>)}
            </Row>
            {(key === 'fees' || key === 'cancellation') && <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: detail === key }} aria-expanded={detail === key}
                onPress={() => setDetail(detail === key ? null : key)} style={styles.expand}>
                <Txt kind="label">{key === 'fees' ? copy.taxDetails : copy.schedules}</Txt>
              </Pressable>
              {detail === key && entries.map((entry,i) => <View key={entry.key} style={{ gap: 6, paddingVertical: 6 }}>
                <Txt kind="label">{names[i]}</Txt>
                {key === 'fees' ? <Taxes taxes={entry.offer.taxes} defaultExpanded/> : <Cancellation offer={entry.offer} now={now} defaultExpanded/>}
              </View>)}
            </>}
          </View>)}
          {keys.length === 0 && <Txt kind="small">{copy.same}</Txt>}
          <Row style={{ alignItems: 'stretch', gap: 8, ...(stacked && { flexDirection: 'column' as const }) }}>
            {entries.map((entry,i) => <View key={entry.key} testID={`compare-review-${entry.index + 1}`} style={!stacked && styles.flex}>
              <Button compact variant="secondary" disabled={!canReviewRoomOffer(entry.offer,currency)} title={roomCopy.reviewRate(entry.index + 1)}
                label={`${copy.choose} · ${names[i]}`} onPress={() => { close(); onReview(entry); }}/>
            </View>)}
          </Row>
        </ScrollView>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(32,22,38,.42)', direction: 'ltr' },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 8, backgroundColor: colors.surface, flexShrink: 1 },
  flex: { flex: 1, minWidth: 0 },
  columnName: { padding: 10, backgroundColor: colors.softBlue, borderRadius: 12, gap: 2 },
  close: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  box: { width: 21, height: 21, borderRadius: 6, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  fact: { paddingHorizontal: 10, paddingVertical: 9, gap: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  difference: { borderRadius: 10, backgroundColor: colors.background },
  expand: { minHeight: 44, justifyContent: 'center' },
});
