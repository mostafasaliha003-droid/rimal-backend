import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HotelDetails } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { Button, Icon, Row, Txt } from './Primitives';
import HotelMapLink from './HotelMapLink';
import Policies from './Policies';
import { policyPlainText } from './hotelPoliciesData';

type Amenity = { name: string; paid: boolean };
const facilityNames: Record<string, string> = {
  'wi-fi': 'واي فاي', wifi: 'واي فاي', pool: 'مسبح', 'swimming pool': 'مسبح', gym: 'صالة رياضية',
  spa: 'سبا', massage: 'تدليك', sauna: 'ساونا', parking: 'مواقف السيارات', 'airport shuttle': 'النقل من وإلى المطار',
  'air conditioning': 'تكييف', terrace: 'تراس', garden: 'حديقة', elevator: 'مصعد', internet: 'الإنترنت',
  general: 'عام', transfer: 'النقل', 'beauty and wellness': 'العناية والاستجمام', 'pool and beach': 'المسبح والشاطئ',
};
function amenityLabel(name: string, ar: boolean) {
  const cleaned = name.replace(/_/g, ' ').trim();
  return (ar && facilityNames[cleaned.toLowerCase()]) || cleaned;
}

function Facility({ item, ar }: { item: Amenity; ar: boolean }) {
  return <Row style={styles.facility}>
    <View style={styles.bullet}/><Txt style={{ flex: 1, fontSize: 15 }}>{amenityLabel(item.name, ar)}</Txt>
    {item.paid && <Txt kind="label" style={styles.paid}>{ar ? 'برسوم' : 'Extra charge'}</Txt>}
  </Row>;
}

function More({ id, expanded, title, onPress }: { id: string; expanded: boolean; title: string; onPress: () => void }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
    onPress={onPress} style={({ pressed }) => [styles.more, pressed && { opacity: .7 }]}>
    <Row style={{ gap: 6 }}><Txt kind="label" style={{ color: colors.violetInk }}>{title}</Txt>
      <Txt accessible={false} style={styles.toggleMark}>{expanded ? '−' : '+'}</Txt></Row>
  </Pressable>;
}

function StayHours({ hotel, ar }: { hotel: HotelDetails; ar: boolean }) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(1, fontScale) < 330;
  const { checkInTime, checkInEnds, checkOutTime } = hotel;
  if (!checkInTime && !checkInEnds && !checkOutTime) return null;
  const clock = (time: string) => '\u2066' + time + '\u2069';
  const unknown = ar ? 'غير محدد' : 'Not provided';
  let arrival = unknown;
  if (checkInTime && checkInEnds) arrival = clock(checkInTime) + (ar ? ' إلى ' : ' to ') + clock(checkInEnds);
  else if (checkInTime) arrival = (ar ? 'من ' : 'From ') + clock(checkInTime);
  else if (checkInEnds) arrival = (ar ? 'حتى ' : 'Until ') + clock(checkInEnds);
  return <View testID="hotel-stay-hours" style={styles.hours}>
    <Row style={{ gap: 7 }}><Icon name="clock" size={19} color={colors.pistachio}/><Txt kind="label" style={styles.lightLabel}>{ar ? 'بتوقيت الفندق المحلي' : 'Hotel local time'}</Txt></Row>
    <Row style={{ gap: 12, alignItems: 'stretch', ...(stacked ? { flexDirection: 'column' } : {}) }}>
      {[[ar ? 'تسجيل الوصول' : 'Check-in', arrival],
        [ar ? 'تسجيل المغادرة' : 'Check-out', checkOutTime ? (ar ? 'حتى ' : 'By ') + clock(checkOutTime) : unknown]].map(([label, value]) =>
        <View key={label} style={{ gap: 2, ...(stacked ? {} : { flex: 1 }) }}>
          <Txt kind="small" style={styles.lightLabel}>{label}</Txt><Txt style={styles.clock}>{value}</Txt></View>)}
    </Row>
  </View>;
}

export default function HotelAbout({ hotel, onChooseRooms }: { hotel: HotelDetails; onChooseRooms: () => void }) {
  const { language, t } = useLanguage();
  const ar = language === 'ar';
  const [allAmenities, setAllAmenities] = useState(false);
  const [allDescription, setAllDescription] = useState(false);
  const groups = hotel.amenityGroups?.length ? hotel.amenityGroups :
    [{ name: '', items: hotel.amenities.map(name => ({ name, paid: false })) }];
  const items = groups.flatMap(group => group.items);
  const paidNames = new Set(items.filter(item => item.paid).map(item => item.name));
  const unique = [...new Set(items.map(item => item.name))].map(name => ({ name, paid: paidNames.has(name) }));
  const grouped = groups.some(group => group.name);
  const moreAmenities = unique.length > 4 || grouped;
  const paragraphs = hotel.description.flatMap(value => policyPlainText(value).split(/\n+/)).map(value => value.trim()).filter(Boolean);
  const moreDescription = paragraphs.length > 1 || (paragraphs[0]?.length || 0) > 160;
  return <View testID="hotel-about" style={{ gap: 14 }}>
    <StayHours hotel={hotel} ar={ar}/>
    {(hotel.address || hotel.location) && <View style={styles.section}>
      <Row style={{ gap: 8 }}><View style={styles.pin}><Icon name="pin" size={19} color={colors.leafInk}/></View>
        <Txt accessibilityRole="header" kind="heading">{ar ? 'موقع الفندق' : 'Location'}</Txt></Row>
      {hotel.address && <Txt>{hotel.address}</Txt>}{hotel.location && <HotelMapLink hotel={hotel}/>}
    </View>}
    <View style={styles.section}><Txt accessibilityRole="header" kind="heading">{ar ? 'المرافق والخدمات' : 'Facilities & services'}</Txt>
      {unique.length ? <View style={{ gap: 4 }}>
        {allAmenities ? groups.map((group, index) => <View key={index} style={{ gap: 3 }}>
          {!!group.name && <Txt kind="label" style={styles.groupName}>{amenityLabel(group.name, ar)}</Txt>}
          {group.items.map(item => <Facility key={item.name} item={{ name: item.name, paid: paidNames.has(item.name) }} ar={ar}/>)}
        </View>) : unique.slice(0, 4).map(item => <Facility key={item.name} item={item} ar={ar}/>)}
        {moreAmenities && <More id="hotel-all-amenities" expanded={allAmenities} onPress={() => setAllAmenities(!allAmenities)}
          title={allAmenities ? (ar ? 'عرض أقل' : 'Show less') : (ar ? 'جميع المرافق' : 'All facilities') + ' (' + unique.length + ')'}/>}
      </View> : <Txt kind="small">{t('noAmenities')}</Txt>}
    </View>
    <Policies source={hotel.policies} extra={hotel.policyExtraInfo}/>
    <View style={styles.section}><Txt accessibilityRole="header" kind="heading">{ar ? 'نبذة عن الفندق' : 'About the property'}</Txt>
      {paragraphs.length ? <>{(allDescription ? paragraphs : paragraphs.slice(0, 1)).map((paragraph, index) =>
        <Txt key={index} numberOfLines={!allDescription && moreDescription ? 3 : undefined}>{paragraph}</Txt>)}
        {moreDescription && <More id="hotel-full-description" expanded={allDescription} onPress={() => setAllDescription(!allDescription)}
          title={allDescription ? (ar ? 'عرض أقل' : 'Show less') : (ar ? 'اقرأ وصف الفندق كاملًا' : 'Read full description')}/>}</> :
        <Txt kind="small">{t('noDescription')}</Txt>}
    </View>
    <Button title={ar ? 'عرض الغرف والأسعار' : 'View rooms and rates'} onPress={onChooseRooms}/>
  </View>;
}

const styles = StyleSheet.create({
  section: { ...ui.card, gap: 10 },
  pin: { width: 33, height: 33, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pistachioMist },
  hours: { gap: 12, padding: 16, backgroundColor: colors.primary, borderRadius: 18 },
  lightLabel: { color: colors.pistachio }, clock: { color: colors.surface, fontFamily: fonts.bold, fontSize: 18, lineHeight: 27 },
  groupName: { marginTop: 8, color: colors.violetInk }, facility: { gap: 9, minHeight: 32, paddingVertical: 2 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.grape },
  paid: { color: colors.goldInk, backgroundColor: colors.softGold, borderRadius: 8, paddingHorizontal: 8, fontSize: 12 },
  more: { minHeight: 44, justifyContent: 'center' }, toggleMark: { fontSize: 18, lineHeight: 22, color: colors.violetInk },
});
