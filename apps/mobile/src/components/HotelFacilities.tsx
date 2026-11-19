import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { HotelAmenity, HotelDetails } from '../types';
import { normalizeHotelAmenities } from '../api/hotelAmenities';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { InternetConditions } from './Policies';
import { canShowFacilityAvailability, facilityLabel } from './hotelFacilityLabels';
import { Row, Txt } from './Primitives';

const serviceLabels = {
  free: { ar: 'مجاني', en: 'Free', color: colors.leafInk, surface: colors.pistachioMist },
  paid: { ar: 'برسوم إضافية', en: 'Extra charge', color: colors.goldInk, surface: colors.softGold },
  unknown: { ar: 'متاح', en: 'Available', color: colors.muted, surface: 'transparent' },
};

type Filter = 'all' | 'free' | 'paid';
const previewCount = 6;

function FacilityRow({ item, ar, divider }: { item: HotelAmenity; ar: boolean; divider: boolean }) {
  const name = facilityLabel(item.name, ar);
  const { ar: arabic, en: english, surface, color } = serviceLabels[item.fee];
  const status = item.fee !== 'unknown' || canShowFacilityAvailability(item.name) ? (ar ? arabic : english) : '';
  return <View testID={'hotel-facility-' + item.fee} accessible accessibilityLabel={status ? name + (ar ? '، ' : ', ') + status : name}
    style={divider && styles.divider}>
    <Row style={styles.serviceRow}>
      <Txt style={styles.serviceName}>{name}</Txt>
      {!!status && <Txt kind="label" style={[styles.priceTag, { color, backgroundColor: surface }]}>{status}</Txt>}
    </Row>
  </View>;
}

export default function HotelFacilities({ hotel }: { hotel: HotelDetails }) {
  const { language, t } = useLanguage();
  const ar = language === 'ar';
  const [selected, setSelected] = useState<Filter>('all');
  const [expanded, setExpanded] = useState(false);
  const groups = hotel.amenityGroups?.length ? hotel.amenityGroups :
    normalizeHotelAmenities(undefined, hotel.policies?.internet, hotel.amenities);
  const fees = new Set(groups.flatMap(group => group.items.map(item => item.fee)));
  const filters: { key: Filter; text: string; label: string }[] = [
    { key: 'all', text: ar ? 'الكل' : 'All', label: ar ? 'عرض كل المرافق' : 'Show all facilities' },
    { key: 'free', text: ar ? 'مجاني' : 'Free', label: ar ? 'عرض المرافق المجانية' : 'Show free facilities' },
    { key: 'paid', text: ar ? 'برسوم' : 'Extra charge', label: ar ? 'عرض المرافق برسوم إضافية' : 'Show facilities with an extra charge' },
  ];
  const active = selected !== 'all' && fees.has(selected) ? selected : 'all';
  const visible: typeof groups = [];
  let matchingCount = 0;
  for (const group of groups) {
    const matches = group.items.filter(item => active === 'all' || item.fee === active);
    const items = expanded ? matches : matches.slice(0, Math.max(0, previewCount - matchingCount));
    if (items.length) visible.push({ name: group.name, items });
    matchingCount += matches.length;
  }
  const hiddenCount = matchingCount - previewCount;
  const showCostNote = visible.some(group => group.items.some(item => item.fee === 'unknown'));

  return <View testID="hotel-facilities" style={styles.section}>
    <Txt accessibilityRole="header" kind="heading">{ar ? 'المرافق والخدمات' : 'Facilities & services'}</Txt>
    {fees.size > 1 && <View style={styles.filterBlock}>
      <Txt kind="small">{ar ? 'تصفية حسب التكلفة' : 'Filter by cost'}</Txt>
      <Row style={styles.filters}>{filters.filter(filter => filter.key === 'all' || fees.has(filter.key)).map(filter =>
        <Pressable key={filter.key} testID={'hotel-guide-' + filter.key} accessibilityRole="button" accessibilityLabel={filter.label}
          accessibilityState={{ selected: active === filter.key }} aria-pressed={active === filter.key}
          onPress={() => { setSelected(filter.key); setExpanded(false); }}
          style={({ pressed }) => [styles.chip, active === filter.key && styles.activeChip, pressed && { opacity: .75 }]}>
          <Txt kind="label" style={[styles.chipText, active === filter.key && { color: colors.surface }]}>{filter.text}</Txt>
        </Pressable>)}</Row>
    </View>}
    {visible.length ? visible.map((group, index) => <View key={index}>
      {!!group.name && <Txt kind="label" accessibilityRole="header" style={styles.groupTitle}>{facilityLabel(group.name, ar)}</Txt>}
      {group.items.map((item, i) => <FacilityRow key={item.name} item={item} ar={ar} divider={i > 0}/>)}
    </View>) : <Txt kind="small">{t('noAmenities')}</Txt>}
    {showCostNote && <Txt testID="hotel-service-cost-note" kind="small">
      {ar ? 'تظهر عبارة «مجاني» أو «برسوم» عندما يحدّد الفندق تكلفة المرفق.' : 'Free or extra charge is shown when the hotel specifies the cost.'}
    </Txt>}
    {hiddenCount > 0 && <Pressable testID="hotel-all-amenities" accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
      onPress={() => setExpanded(!expanded)} style={({ pressed }) => [styles.more, pressed && { opacity: .75 }]}>
      <Txt kind="label" style={styles.moreText}>{expanded ? (ar ? 'عرض أقل' : 'Show fewer') :
        (ar ? 'عرض بقية المرافق' : 'Show remaining facilities') + ' (' + hiddenCount + ')'}</Txt>
    </Pressable>}
    {active === 'all' && <InternetConditions source={hotel.policies}/>}
  </View>;
}

const styles = StyleSheet.create({
  section: { ...ui.card, gap: 14 }, filterBlock: { gap: 5 },
  filters: { flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface },
  activeChip: { borderColor: colors.grape, backgroundColor: colors.grape }, chipText: { color: colors.violetInk, textAlign: 'center' },
  groupTitle: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, color: colors.violetInk, backgroundColor: colors.lavenderMist },
  serviceRow: { paddingVertical: 8, paddingHorizontal: 3, minHeight: 44, gap: 8, flexWrap: 'wrap' },
  serviceName: { flexBasis: 90, flexGrow: 1, fontSize: 15 },
  priceTag: { maxWidth: '100%', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2, fontSize: 13, lineHeight: 20 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  more: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderWidth: 1, borderRadius: 12, borderColor: colors.border },
  moreText: { color: colors.violetInk },
});
