import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HotelDetails, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { Button, Icon, Row, Txt } from './Primitives';
import HotelMapLink from './HotelMapLink';
import Policies from './Policies';
import { policyPlainText } from './hotelPoliciesData';
import { addDays } from './calendarModel';
import { displayTravelDate, stayNights } from './searchJourneyModel';

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

type StayDates = Pick<SearchCriteria, 'checkin'|'checkout'>;
type GuideSection = 'arrival' | 'facilities' | 'location';

function StayHours({ hotel, criteria }: { hotel: HotelDetails; criteria: StayDates }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(1, fontScale) < 320;
  const { checkInTime, checkInEnds, checkOutTime } = hotel;
  const clock = (time: string) => '\u2066' + time + '\u2069';
  const nights = stayNights(criteria.checkin, criteria.checkout);
  const nightLabel = nights === 1 ? (ar ? 'ليلة واحدة' : '1 night') : ar && nights === 2 ? 'ليلتان' : nights + (ar ? (nights && nights < 11 ? ' ليالٍ' : ' ليلة') : ' nights');
  const unknown = ar ? 'الوقت غير محدد' : 'Time not provided';
  const arrival = checkInTime ? (ar ? 'من ' : 'From ') + clock(checkInTime) :
    checkInEnds ? (ar ? 'حتى ' : 'Until ') + clock(checkInEnds) : unknown;
  const overnight = checkInTime && checkInEnds && checkInEnds < checkInTime;
  const lastArrival = checkInEnds && checkInTime && (ar ? 'آخر وقت للوصول ' : 'Latest check-in ') + clock(checkInEnds)
    + (overnight ? ' · ' + displayTravelDate(addDays(criteria.checkin, 1), language) : '');
  const schedule = [
    { label: ar ? 'تسجيل الوصول' : 'Check-in', date: criteria.checkin, time: arrival },
    { label: ar ? 'تسجيل المغادرة' : 'Check-out', date: criteria.checkout, time: checkOutTime ? (ar ? 'حتى ' : 'By ') + clock(checkOutTime) : unknown },
  ];
  return <View testID="hotel-stay-hours" style={styles.hours}>
    <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
      <Row style={{ gap: 8 }}><Icon name="calendar" size={19} color={colors.pistachio}/>
        <Txt accessibilityRole="header" kind="heading" style={styles.stayTitle}>{ar ? 'مواعيد إقامتك' : 'Your stay dates'}</Txt></Row>
      {nights !== null && <Txt kind="label" style={styles.nights}>{nightLabel}</Txt>}
    </Row>
    <Row style={{ gap: 10, alignItems: 'stretch', ...(stacked ? { flexDirection: 'column' } : {}) }}>
      {schedule.map((event, index) => <View key={event.label} style={[styles.milestone, !stacked && { flex: 1 }]}>
        <Txt kind="small" style={styles.lightLabel}>{event.label}</Txt>
        <Txt style={styles.date}>{displayTravelDate(event.date, language)}</Txt>
        <Txt kind="label" style={styles.time}>{event.time}</Txt>
        {index === 0 && !!lastArrival && <Txt kind="small" style={styles.latest}>{lastArrival}</Txt>}
      </View>)}
    </Row>
    <Txt kind="small" style={styles.lightLabel}>{ar ? 'بتوقيت الفندق المحلي' : 'Hotel local time'}</Txt>
  </View>;
}

export default function HotelAbout({ hotel, criteria, onChooseRooms, initialSection = 'arrival' }: {
  hotel: HotelDetails; criteria: StayDates; onChooseRooms: () => void; initialSection?: GuideSection;
}) {
  const { language, t } = useLanguage();
  const ar = language === 'ar';
  const [section, setSection] = useState<GuideSection>(initialSection);
  const [paidOnly, setPaidOnly] = useState(false);
  const [allAmenities, setAllAmenities] = useState(false);
  const [allDescription, setAllDescription] = useState(false);
  const groups = hotel.amenityGroups?.length ? hotel.amenityGroups :
    [{ name: '', items: hotel.amenities.map(name => ({ name, paid: false })) }];
  const items = groups.flatMap(group => group.items);
  const paidNames = new Set(items.filter(item => item.paid).map(item => item.name));
  const unique = [...new Set(items.map(item => item.name))].map(name => ({ name, paid: paidNames.has(name) }));
  const grouped = groups.some(group => group.name);
  const moreAmenities = unique.length > 4 || grouped;
  const visibleFacilities = paidOnly ? unique.filter(item => item.paid) : unique;
  const paragraphs = hotel.description.flatMap(value => policyPlainText(value).split(/\n+/)).map(value => value.trim()).filter(Boolean);
  const moreDescription = paragraphs.length > 1 || (paragraphs[0]?.length || 0) > 160;
  const guides: {key: GuideSection; title: string}[] = [
    { key: 'arrival', title: ar ? 'قبل الوصول' : 'Before arrival' },
    { key: 'facilities', title: ar ? 'المرافق' : 'Facilities' },
    { key: 'location', title: ar ? 'الموقع والفندق' : 'Location & hotel' },
  ];
  return <View testID="hotel-about" style={{ gap: 13 }}>
    <StayHours hotel={hotel} criteria={criteria}/>
    <Row style={styles.navigation}>{guides.map(guide => <Pressable key={guide.key} testID={'hotel-guide-' + guide.key}
      accessibilityRole="button" accessibilityState={{ selected: section === guide.key }} aria-pressed={section === guide.key}
      onPress={() => setSection(guide.key)} style={({ pressed }) => [styles.navButton, section === guide.key && styles.navActive, pressed && { opacity: .75 }]}>
      <Txt kind="label" style={{ textAlign: 'center', color: section === guide.key ? colors.violetInk : colors.muted }}>{guide.title}</Txt>
    </Pressable>)}</Row>
    {section === 'arrival' && <Policies source={hotel.policies} extra={hotel.policyExtraInfo}/>}
    {section === 'location' && <>
    {(hotel.address || hotel.location) && <View style={styles.section}>
      <Row style={{ gap: 8 }}><View style={styles.pin}><Icon name="pin" size={19} color={colors.leafInk}/></View>
        <Txt accessibilityRole="header" kind="heading">{ar ? 'موقع الفندق' : 'Location'}</Txt></Row>
      {hotel.address && <Txt>{hotel.address}</Txt>}{hotel.location && <HotelMapLink hotel={hotel}/>}
    </View>}
    <View style={styles.section}><Txt accessibilityRole="header" kind="heading">{ar ? 'نبذة عن الفندق' : 'About the property'}</Txt>
      {paragraphs.length ? <>{(allDescription ? paragraphs : paragraphs.slice(0, 1)).map((paragraph, index) =>
        <Txt key={index} numberOfLines={!allDescription && moreDescription ? 3 : undefined}>{paragraph}</Txt>)}
        {moreDescription && <More id="hotel-full-description" expanded={allDescription} onPress={() => setAllDescription(!allDescription)}
          title={allDescription ? (ar ? 'عرض أقل' : 'Show less') : (ar ? 'اقرأ وصف الفندق كاملًا' : 'Read full description')}/>}</> :
        <Txt kind="small">{t('noDescription')}</Txt>}
    </View></>}
    {section === 'facilities' && <View style={styles.section}><Txt accessibilityRole="header" kind="heading">{ar ? 'المرافق والخدمات' : 'Facilities & services'}</Txt>
      {unique.length ? <View style={{ gap: 5 }}>
        {paidNames.size > 0 && <Pressable testID="hotel-guide-paid" accessibilityRole="checkbox" accessibilityState={{ checked: paidOnly }} aria-checked={paidOnly}
          onPress={() => setPaidOnly(!paidOnly)} style={styles.paidFilter}><Row style={{ gap: 8 }}><View style={[styles.check, paidOnly && { backgroundColor: colors.grape }]}>
            {paidOnly && <Icon name="check" size={13} color={colors.surface}/>}</View>
            <Txt kind="label">{ar ? 'الخدمات برسوم فقط' : 'Show paid services only'}</Txt></Row></Pressable>}
        {allAmenities && !paidOnly ? groups.map((group, index) => <View key={index} style={{ gap: 3 }}>
          {!!group.name && <Txt kind="label" style={styles.groupName}>{amenityLabel(group.name, ar)}</Txt>}
          {group.items.map(item => <Facility key={item.name} item={{ name: item.name, paid: paidNames.has(item.name) }} ar={ar}/>)}
        </View>) : (paidOnly ? visibleFacilities : visibleFacilities.slice(0, 4)).map(item => <Facility key={item.name} item={item} ar={ar}/>)}
        {!paidOnly && moreAmenities && <More id="hotel-all-amenities" expanded={allAmenities} onPress={() => setAllAmenities(!allAmenities)}
          title={allAmenities ? (ar ? 'عرض أقل' : 'Show less') : (ar ? 'جميع المرافق' : 'All facilities') + ' (' + unique.length + ')'}/>}
      </View> : <Txt kind="small">{t('noAmenities')}</Txt>}
    </View>}
    <Button title={ar ? 'عرض الغرف والأسعار' : 'View rooms and rates'} onPress={onChooseRooms}/>
  </View>;
}

const styles = StyleSheet.create({
  section: { ...ui.card, gap: 10 },
  pin: { width: 33, height: 33, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pistachioMist },
  hours: { gap: 11, padding: 15, backgroundColor: colors.primary, borderRadius: 20 },
  stayTitle: { color: colors.surface, fontSize: 19 }, nights: { color: colors.primary, backgroundColor: colors.pistachio, borderRadius: 13, paddingHorizontal: 9, paddingVertical: 2 },
  milestone: { gap: 2, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 13, backgroundColor: colors.blue },
  date: { fontFamily: fonts.bold, color: colors.surface, fontSize: 20, lineHeight: 29 }, time: { color: colors.surface },
  latest: { color: colors.pistachio, fontSize: 12, lineHeight: 19 }, lightLabel: { color: colors.pistachio },
  navigation: { gap: 4, flexWrap: 'wrap', borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 4 },
  navButton: { flexGrow: 1, flexBasis: 82, minHeight: 44, paddingHorizontal: 4, justifyContent: 'center', borderRadius: 11 },
  navActive: { backgroundColor: colors.softBlue }, paidFilter: { minHeight: 44, justifyContent: 'center' },
  check: { width: 18,height: 18,borderRadius: 5,borderWidth: 1,borderColor: colors.grape,justifyContent:'center',alignItems:'center' },
  groupName: { marginTop: 8, color: colors.violetInk }, facility: { gap: 9, minHeight: 32, paddingVertical: 2 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.grape },
  paid: { color: colors.goldInk, backgroundColor: colors.softGold, borderRadius: 8, paddingHorizontal: 8, fontSize: 12 },
  more: { minHeight: 44, justifyContent: 'center' }, toggleMark: { fontSize: 18, lineHeight: 22, color: colors.violetInk },
});
