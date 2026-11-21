import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HotelDetails, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { color, colors, fonts, ui } from '../theme';
import { Button, Icon, Row, Txt, DisclosureMark } from './Primitives';
import HotelMapLink from './HotelMapLink';
import HotelFacilities from './HotelFacilities';
import Policies from './Policies';
import { policyPlainText } from './hotelPoliciesData';
import { addDays } from './calendarModel';
import { displayTravelDate, stayNights } from './searchJourneyModel';

function More({ id, expanded, title, onPress }: { id: string; expanded: boolean; title: string; onPress: () => void }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
    onPress={onPress} style={({ pressed }) => [styles.more, pressed && { opacity: .7 }]}>
    <Row style={{ gap: 6 }}><Txt kind="label" style={{ color: colors.violetInk }}>{title}</Txt>
      <DisclosureMark open={expanded}/></Row>
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
  const [allDescription, setAllDescription] = useState(false);
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
    {section === 'facilities' && <HotelFacilities key={hotel.hid} hotel={hotel}/>}
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
  navigation: { gap: 4, flexWrap: 'wrap', borderRadius: 15, backgroundColor: color.bgField, padding: 4 },
  navButton: { flexGrow: 1, flexBasis: 82, minHeight: 44, paddingHorizontal: 4, justifyContent: 'center', borderRadius: 11 },
  navActive: { backgroundColor: colors.softBlue },
  more: { minHeight: 44, justifyContent: 'center' }, toggleMark: { fontSize: 18, lineHeight: 22, color: colors.violetInk },
});
