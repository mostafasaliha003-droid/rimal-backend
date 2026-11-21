import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { HotelDetails, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { color, colors, radius, space, ui } from '../theme';
import { Icon, Row, Txt, DisclosureMark } from './Primitives';
import HotelMapLink from './HotelMapLink';
import HotelFacilities from './HotelFacilities';
import Policies from './Policies';
import { policyPlainText } from './hotelPoliciesData';
import { addDays } from './calendarModel';
import { displayTravelDate, stayNights } from './searchJourneyModel';
import { stayWords } from './format';

function More({ id, expanded, title, onPress }: { id: string; expanded: boolean; title: string; onPress: () => void }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
    onPress={onPress} style={({ pressed }) => [styles.more, pressed && { opacity: .7 }]}>
    <Row style={{ gap: 6 }}><Txt kind="label" style={{ color: colors.violetInk }}>{title}</Txt>
      <DisclosureMark open={expanded}/></Row>
  </Pressable>;
}

type StayDates = Pick<SearchCriteria, 'checkin'|'checkout'>;

/**
 * Check-in and check-out as two quiet columns: day, date and time, in the hotel's local time.
 * Four facts do not need a dark block; they need to be easy to find.
 */
function StayHours({ hotel, criteria }: { hotel: HotelDetails; criteria: StayDates }) {
  const { language, rtl } = useLanguage();
  const ar = language === 'ar';
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / Math.max(1, fontScale) < 320;
  const { checkInTime, checkInEnds, checkOutTime } = hotel;
  const clock = (time: string) => '\u2066' + time + '\u2069';
  const nights = stayNights(criteria.checkin, criteria.checkout);
  const unknown = ar ? 'الوقت غير محدد' : 'Time not provided';
  const arrival = checkInTime ? (ar ? 'من ' : 'From ') + clock(checkInTime) :
    checkInEnds ? (ar ? 'حتى ' : 'Until ') + clock(checkInEnds) : unknown;
  const overnight = checkInTime && checkInEnds && checkInEnds < checkInTime;
  const lastArrival = checkInEnds && checkInTime && (ar ? 'آخر وقت للوصول ' : 'Latest check-in ') + clock(checkInEnds)
    + (overnight ? ' · ' + displayTravelDate(addDays(criteria.checkin, 1), language) : '');
  const schedule = [
    { label: ar ? 'تسجيل الوصول' : 'Check-in', date: criteria.checkin, time: arrival, note: lastArrival || '' },
    { label: ar ? 'تسجيل المغادرة' : 'Check-out', date: criteria.checkout, time: checkOutTime ? (ar ? 'حتى ' : 'By ') + clock(checkOutTime) : unknown, note: '' },
  ];
  const caption = [nights !== null ? stayWords(language).nights(nights) : '', ar ? 'بتوقيت الفندق المحلي' : 'Hotel local time'].filter(Boolean).join(' · ');
  return <View testID="hotel-stay-hours" style={styles.card}>
    <Row style={{ alignItems: 'stretch', gap: 0, ...(stacked ? { flexDirection: 'column' } : {}) }}>
      {schedule.map((event, index) => <React.Fragment key={event.label}>
        {index > 0 && <View style={stacked ? styles.ruleH : styles.ruleV}/>}
        <View style={[{ gap: 1, minWidth: 0, paddingVertical: space.xxs }, !stacked && { flex: 1 }, !stacked && index > 0 && (rtl ? { paddingRight: space.md } : { paddingLeft: space.md })]}>
          <Txt kind="caption">{event.label}</Txt>
          <Txt kind="bodyStrong" numberOfLines={1}>{displayTravelDate(event.date, language)}</Txt>
          <Txt kind="small" tone="primary">{event.time}</Txt>
          {!!event.note && <Txt kind="caption">{event.note}</Txt>}
        </View>
      </React.Fragment>)}
    </Row>
    <Row style={{ gap: space.xs }}><Icon name="clock" size={14} color={color.textSecondary}/><Txt kind="caption" style={{ flex: 1 }}>{caption}</Txt></Row>
  </View>;
}

/** One titled block of the guide. */
function Section({ icon, title, children, testID }: { icon: 'pin' | 'info'; title: string; children: React.ReactNode; testID?: string }) {
  return <View testID={testID} style={styles.card}>
    <Row style={{ gap: space.sm }}><View style={styles.sectionIcon}><Icon name={icon} size={17} color={color.interactiveStrong}/></View>
      <Txt accessibilityRole="header" kind="subheading" style={{ flex: 1 }}>{title}</Txt></Row>
    {children}
  </View>;
}

/**
 * The hotel guide as one calm page: stay times, location, the description, facilities and the
 * stay terms, one after another. The fixed bar below the page is the single way back to rooms.
 */
export default function HotelAbout({ hotel, criteria }: { hotel: HotelDetails; criteria: StayDates }) {
  const { language, t } = useLanguage();
  const ar = language === 'ar';
  const [allDescription, setAllDescription] = useState(false);
  const paragraphs = hotel.description.flatMap(value => policyPlainText(value).split(/\n+/)).map(value => value.trim()).filter(Boolean);
  const moreDescription = paragraphs.length > 1 || (paragraphs[0]?.length || 0) > 160;
  return <View testID="hotel-about" style={{ gap: space.md }}>
    <StayHours hotel={hotel} criteria={criteria}/>
    {(hotel.address || hotel.location) && <Section testID="hotel-guide-location" icon="pin" title={ar ? 'الموقع' : 'Location'}>
      {hotel.address && <Txt kind="small" tone="primary">{hotel.address}</Txt>}
      {hotel.location && <HotelMapLink hotel={hotel}/>}
    </Section>}
    <Section testID="hotel-guide-about" icon="info" title={ar ? 'نبذة عن الفندق' : 'About the property'}>
      {paragraphs.length ? <>{(allDescription ? paragraphs : paragraphs.slice(0, 1)).map((paragraph, index) =>
        <Txt key={index} kind="small" tone="primary" numberOfLines={!allDescription && moreDescription ? 3 : undefined}>{paragraph}</Txt>)}
        {moreDescription && <More id="hotel-full-description" expanded={allDescription} onPress={() => setAllDescription(!allDescription)}
          title={allDescription ? (ar ? 'عرض أقل' : 'Show less') : (ar ? 'اقرأ الوصف كاملاً' : 'Read full description')}/>}</> :
        <Txt kind="small">{t('noDescription')}</Txt>}
    </Section>
    <View testID="hotel-guide-facilities"><HotelFacilities key={hotel.hid} hotel={hotel}/></View>
    <View testID="hotel-guide-arrival"><Policies source={hotel.policies} extra={hotel.policyExtraInfo}/></View>
  </View>;
}

const styles = StyleSheet.create({
  card: { ...ui.card, gap: space.sm, padding: space.md },
  sectionIcon: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSelected },
  ruleV: { width: 1, backgroundColor: color.border, marginHorizontal: space.md },
  ruleH: { height: 1, backgroundColor: color.border, marginVertical: space.sm },
  more: { minHeight: 44, justifyContent: 'center' },
});
