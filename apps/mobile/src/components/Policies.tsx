import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { Icon, Row, Txt } from './Primitives';
import { hotelPolicySections, hotelExtraInformation, type PolicySection, type PolicyRow } from './hotelPoliciesData';

const arrivalCosts = new Set(['deposit', 'add_fee']);
const priority = ['deposit','add_fee','check_in_check_out','no_show','parking','shuttle','children','children_meal','cot','extra_bed','pets'];
const fieldNames = (row: PolicyRow) => row.fields.flatMap(path => path.length === 1 ? [path[0]] : []);
function rowValue(row: PolicyRow, rtl: boolean) {
  return row.segments ? row.segments.map(part => part.direction === 'ltr' && rtl ? '\u2066' + part.text + '\u2069' : part.text).join(row.separator) : row.value;
}
function summary(section: PolicySection, rtl: boolean) {
  if (section.key === 'internet') {
    if (section.entries.length > 1) return rtl ? 'تختلف الشروط حسب الاتصال أو المكان' : 'Terms by connection or location';
    return section.entries[0].rows.filter(row => fieldNames(row).some(key => key === 'internet_type' || key === 'work_area' || key === 'inclusion'))
      .map(row => rowValue(row, rtl)).join(' · ');
  }
  if (section.entries.length > 1) return rtl ? 'حالات مختلفة (' + section.entries.length + ')' : section.entries.length + ' policy cases';
  const rows = section.entries[0].rows;
  const price = rows.find(row => row.emphasis && fieldNames(row).includes('price'));
  const context = rows.find(row => fieldNames(row).some(name => name === 'deposit_type' || name === 'fee_type' || name === 'availability'));
  return [context && rowValue(context, rtl), price && rowValue(price, rtl)].filter(Boolean).join(' · ');
}

function PolicyDetails({ section, rtl, testID }: { section: PolicySection; rtl: boolean; testID?: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = summary(section, rtl);
  return <View style={styles.group}>
    <Pressable testID={testID ?? 'property-policy-' + section.key} accessibilityRole="button" accessibilityState={{ expanded }}
      aria-expanded={expanded} onPress={() => setExpanded(!expanded)} style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: colors.softBlue }]}>
      <Row style={{ gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt kind="label">{section.title}</Txt>
          {!expanded && !!preview && <Txt kind="small" style={{ color: arrivalCosts.has(section.key) ? colors.goldInk : colors.muted }}>{preview}</Txt>}
        </View>
        <Txt accessible={false} style={styles.mark}>{expanded ? '−' : '+'}</Txt>
      </Row>
    </Pressable>
    {expanded && <View style={styles.entries}>{section.entries.map((entry, index) => <View key={index}
      style={[styles.entry, index > 0 && { borderTopWidth: 1, paddingTop: 10, borderTopColor: colors.border }]}>
      {section.entries.length > 1 && <Txt kind="label" style={{ color: colors.violetInk }}>{(rtl ? 'الحالة ' : 'Case ') + (index + 1)}</Txt>}
      {entry.rows.map((row, rowIndex) => <View key={rowIndex} style={{ gap: 2 }}>
        {!!row.label && <Txt kind="small">{row.label}</Txt>}
        <Txt style={{ fontFamily: row.emphasis ? fonts.bold : fonts.medium, color: row.emphasis ? colors.navy : colors.ink }}>
          {rowValue(row, rtl)}
        </Txt>
      </View>)}
    </View>)}</View>}
  </View>;
}

export function InternetConditions({ source }: { source: Record<string, unknown> }) {
  const { language, rtl } = useLanguage();
  const entries = Array.isArray(source.internet) ? source.internet : [source.internet];
  const useful = entries.filter(entry => entry && typeof entry === 'object' &&
    ['inclusion', 'work_area', 'internet_type', 'price'].some(key => {
      const value: unknown = entry[key];
      return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && !!value.trim() && value.trim() !== 'unspecified';
    }));
  if (!useful.length) return null;
  const [section] = hotelPolicySections({ metapolicy_struct: { internet: useful } }, language);
  return <View style={styles.groups}><PolicyDetails testID="facility-internet-conditions" rtl={rtl}
    section={{ ...section, title: rtl ? 'تفاصيل اتصال الإنترنت' : 'Internet access details' }}/></View>;
}

export default function Policies({ source, extra }: { source: Record<string, unknown>; extra: string | null }) {
  const { language, rtl } = useLanguage();
  const hotel = { metapolicy_struct: source, metapolicy_extra_info: extra || '' };
  const sourceSections = hotelPolicySections(hotel, language);
  const sorted = [...priority.map(key => sourceSections.find(section => section.key === key)).filter((section): section is PolicySection => !!section),
    ...sourceSections.filter(section => !priority.includes(section.key))];
  const groups = [
    { key: 'costs', title: rtl ? 'التأمين والرسوم' : 'Deposits & fees', items: sorted.filter(section => arrivalCosts.has(section.key)) },
    { key: 'rules', title: rtl ? 'شروط الإقامة' : 'House rules', items: sorted.filter(section => !arrivalCosts.has(section.key)) },
  ];
  const additional = hotelExtraInformation(hotel);
  const [allExtra, setAllExtra] = useState(false);
  const longExtra = additional.length > 150 || additional.split('\n').length > 3;
  return <View style={styles.panel}>
    {groups.filter(group => group.items.length > 0).map(group => <View key={group.key} style={{ gap: 5 }}>
      <Txt accessibilityRole="header" kind="heading" style={styles.subheading}>{group.title}</Txt>
      <View style={styles.groups}>{group.items.map(section => <PolicyDetails key={section.key} section={section} rtl={rtl}/>)}</View>
    </View>)}
    {!!additional && <View style={styles.note}><Row style={{ gap: 7 }}><Icon name="info" size={17} color={colors.goldInk}/>
      <Txt kind="label">{rtl ? 'معلومات مهمة قبل الوصول' : 'Important arrival information'}</Txt></Row>
      <Txt numberOfLines={longExtra && !allExtra ? 4 : undefined}>{additional}</Txt>
      {longExtra && <Pressable testID="hotel-full-policy-note" accessibilityRole="button" accessibilityState={{ expanded: allExtra }}
        aria-expanded={allExtra} onPress={() => setAllExtra(!allExtra)} style={styles.more}>
        <Txt kind="label" style={{ color: colors.goldInk }}>{allExtra ? (rtl ? 'عرض أقل' : 'Show less') : (rtl ? 'قراءة المعلومات كاملة' : 'Read all arrival information')}</Txt>
      </Pressable>}
    </View>}
    {!sourceSections.length && !additional && <Txt kind="small">{rtl ? 'لم يرسل الفندق تفاصيل سياساته.' : 'Property policies have not been provided.'}</Txt>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { ...ui.card, gap: 14 }, subheading: { color: colors.navy, fontSize: 17, lineHeight: 25 },
  groups: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  group: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  toggle: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  mark: { color: colors.grape, fontSize: 21 },
  entries: { padding: 12, gap: 12, backgroundColor: colors.background }, entry: { gap: 9 },
  note: { gap: 7, padding: 12, backgroundColor: colors.softGold, borderRadius: 12 },
  more: { minHeight: 44, justifyContent: 'center' },
});
