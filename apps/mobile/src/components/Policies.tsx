import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { Icon, Row, Txt } from './Primitives';
import { hotelPolicySections, hotelExtraInformation, type PolicySection } from './hotelPoliciesData';

function PolicyDetails({ section, rtl }: { section: PolicySection; rtl: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.group}>
    <Pressable testID={'property-policy-' + section.key} accessibilityRole="button" accessibilityState={{ expanded }}
      aria-expanded={expanded} onPress={() => setExpanded(!expanded)} style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: colors.softBlue }]}>
      <Row style={{ gap: 8 }}>
        <Txt kind="label" style={{ flex: 1 }}>{section.title}</Txt>
        <Txt accessible={false} style={styles.mark}>{expanded ? '−' : '+'}</Txt>
      </Row>
    </Pressable>
    {expanded && <View style={styles.entries}>{section.entries.map((entry, index) => <View key={index}
      style={[styles.entry, index > 0 && { borderTopWidth: 1, paddingTop: 10, borderTopColor: colors.border }]}>
      {entry.rows.map((row, rowIndex) => <View key={rowIndex} style={{ gap: 2 }}>
        {!!row.label && <Txt kind="small">{row.label}</Txt>}
        <Txt style={{ fontFamily: row.emphasis ? fonts.bold : fonts.medium, color: row.emphasis ? colors.navy : colors.ink }}>
          {row.segments ? row.segments.map(segment => segment.direction === 'ltr' && rtl ? '\u2066' + segment.text + '\u2069' : segment.text).join(row.separator) : row.value}
        </Txt>
      </View>)}
    </View>)}</View>}
  </View>;
}

export default function Policies({ source, extra }: { source: Record<string, unknown>; extra: string | null }) {
  const { language, rtl } = useLanguage();
  const hotel = { metapolicy_struct: source, metapolicy_extra_info: extra || '' };
  const sections = hotelPolicySections(hotel, language);
  const additional = hotelExtraInformation(hotel);
  const [allExtra, setAllExtra] = useState(false);
  const longExtra = additional.length > 150 || additional.split('\n').length > 3;
  return <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{rtl ? 'سياسات الفندق' : 'Property policies'}</Txt>
    {!!additional && <View style={styles.note}><Row style={{ gap: 7 }}><Icon name="info" size={17} color={colors.goldInk}/>
      <Txt kind="label">{rtl ? 'معلومات مهمة قبل الوصول' : 'Important arrival information'}</Txt></Row>
      <Txt numberOfLines={longExtra && !allExtra ? 4 : undefined}>{additional}</Txt>
      {longExtra && <Pressable testID="hotel-full-policy-note" accessibilityRole="button" accessibilityState={{ expanded: allExtra }}
        aria-expanded={allExtra} onPress={() => setAllExtra(!allExtra)} style={styles.more}>
        <Txt kind="label" style={{ color: colors.goldInk }}>{allExtra ? (rtl ? 'عرض أقل' : 'Show less') : (rtl ? 'قراءة المعلومات كاملة' : 'Read all arrival information')}</Txt>
      </Pressable>}
    </View>}
    {sections.length ? <View style={styles.groups}>{sections.map(section => <PolicyDetails key={section.key} section={section} rtl={rtl}/>)}</View> :
      !additional && <Txt kind="small">{rtl ? 'لم يرسل الفندق تفاصيل سياساته.' : 'Property policies have not been provided.'}</Txt>}
  </View>;
}

const styles = StyleSheet.create({
  groups: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  group: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  toggle: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  mark: { color: colors.grape, fontSize: 21 },
  entries: { padding: 12, gap: 12, backgroundColor: colors.background }, entry: { gap: 9 },
  note: { gap: 7, padding: 12, backgroundColor: colors.softGold, borderRadius: 12 },
  more: { minHeight: 44, justifyContent: 'center' },
});
