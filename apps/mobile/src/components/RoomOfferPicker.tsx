import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Icon, Row, Txt } from './Primitives';
import { roomRateFacts } from './roomRateFacts';
import type { RoomChoiceEntry } from './roomChoiceModel';

export default function RoomOfferPicker({ entries, selected, onSelect, now }: {
  entries: readonly RoomChoiceEntry[]; selected: RoomChoiceEntry; onSelect: (entry: RoomChoiceEntry) => void; now: number;
}) {
  const { language } = useLanguage();
  const { fontScale } = useWindowDimensions();
  const ar = language === 'ar';
  const [limit, setLimit] = useState(3);
  const visible = entries.slice(0, limit);
  if (!visible.some(entry => entry.key === selected.key)) visible.push(selected);
  const remaining = entries.length - visible.length;
  return <View style={styles.picker} testID="room-offer-picker">
    <Row style={{ gap: 5, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Txt kind="label" accessibilityRole="header" style={styles.title}>{ar ? 'اختر عرض هذه الغرفة' : 'Choose a rate'}</Txt>
      <Txt kind="small">{ar ? 'السعر لكل الليالي' : 'Full-stay prices'}</Txt>
    </Row>
    {visible.map(entry => {
      const chosen = entry.key === selected.key;
      const facts = roomRateFacts(entry.offer, language, now);
      return <Pressable key={entry.key} testID={`pick-rate-${entry.index + 1}`} accessibilityRole="button"
        accessibilityState={{ selected: chosen }} aria-pressed={chosen}
        accessibilityLabel={[facts.meal, facts.price, facts.decision.headline, entry.offer.name].join(' · ')}
        onPress={() => onSelect(entry)} style={({ pressed }) => [styles.option, chosen && styles.selected, pressed && { opacity: .8 }]}>
        <Row style={{ gap: 9, alignItems: 'flex-start' }}>
          <View style={[styles.circle, chosen && styles.circleSelected]}>{chosen && <Icon name="check" size={13} color={colors.surface}/>}</View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Row style={{ gap: 5, alignItems: 'baseline', flexWrap: 'wrap', ...(fontScale > 1.3 && { flexDirection: 'column', alignItems: 'stretch' }) }}>
              <Txt kind="label" style={{ flexGrow: 1, flexShrink: 1 }}>{facts.meal}</Txt>
              <Txt kind="label" style={{ writingDirection: 'ltr', color: colors.violetInk }}>{facts.price}</Txt>
            </Row>
            <Txt kind="small" style={{ color: facts.decision.kind === 'free' ? colors.success : colors.muted }}>{facts.decision.headline}</Txt>
          </View>
        </Row>
      </Pressable>;
    })}
    {remaining > 0 && <Pressable accessibilityRole="button" testID="more-room-options" onPress={() => setLimit(n => n + 4)} style={styles.more}>
      <Row style={{ gap: 6 }}><Txt kind="label" style={{ color: colors.violetInk }}>{ar ? `المزيد من الخيارات (${remaining})` : `More options (${remaining})`}</Txt>
        <Icon name="chevron" size={14} color={colors.violetInk}/></Row>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  picker: { padding: 14, gap: 7, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  title: { fontSize: 16, lineHeight: 24, marginBottom: 2 },
  option: { minHeight: 58, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  selected: { borderColor: colors.grape, backgroundColor: colors.lavenderMist },
  circle: { marginTop: 3, width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  circleSelected: { backgroundColor: colors.grape, borderColor: colors.grape },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
