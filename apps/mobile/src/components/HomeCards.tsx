import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SearchCriteria } from '../types';
import { api } from '../api';
import type { BookingHistoryItem } from '../api/bookings';
import { canDownloadVoucher } from '../api/voucher';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, radius, space } from '../theme';
import { Badge, Button, Card, Icon, IconButton, Notice, Row, Skeleton, Txt } from './Primitives';
import { formatDay, guestLine, nightsBetween, stayWords, untilLabel } from './format';
import { buildTripsModel, localTodayKey } from './tripsModel';
import VoucherButton from './VoucherButton';

function Fact({ icon, text, testID }: { icon: 'pin' | 'calendar' | 'users'; text: string; testID?: string }) {
  return <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
    <View style={{ paddingTop: 3 }}><Icon name={icon} size={16} color={color.textSecondary}/></View>
    <Txt testID={testID} kind="bodyStrong" style={{ flex: 1 }}>{text}</Txt>
  </Row>;
}

/** Where the traveler stopped: destination, dates, nights and guests, resumable in one tap. */
export function ContinueSearchCard({ name, criteria, current, datesPassed, onResume, onEdit, onNewDates, onClear }: {
  name: string; criteria: SearchCriteria; current: boolean; datesPassed: boolean;
  onResume: () => void; onEdit: () => void; onNewDates: () => void; onClear?: () => void;
}) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const nights = nightsBetween(criteria.checkin, criteria.checkout);
  const dates = `${formatDay(criteria.checkin, language, { weekday: true })} – ${formatDay(criteria.checkout, language, { weekday: true })}${nights ? ` · ${stayWords(language).nights(nights)}` : ''}`;
  return <Card testID="continue-search" elevated style={styles.continue}>
    <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
      <Row style={{ gap: space.sm, flexShrink: 1 }}>
        <View style={styles.badgeIcon}><Icon name="history" size={18} color={color.accent}/></View>
        <Txt kind="subheading" accessibilityRole="header">{current ? (ar ? 'بحثك الحالي' : 'Your current search') : (ar ? 'أكمل بحثك' : 'Continue your search')}</Txt>
      </Row>
      {onClear && <IconButton icon="close" size={18} label={ar ? 'إزالة هذا البحث من الجهاز' : 'Remove this search from this device'} onPress={onClear}/>}
    </Row>
    <View style={{ gap: space.xs }}>
      <Fact icon="pin" text={name} testID="continue-search-destination"/>
      <Fact icon="calendar" text={dates} testID="continue-search-dates"/>
      <Fact icon="users" text={guestLine(criteria.guests, language)} testID="continue-search-guests"/>
    </View>
    {datesPassed ? <>
      <Notice tone="warning" title={ar ? 'مرّت تواريخ هذا البحث' : 'These dates have passed'}
        body={ar ? 'نحتفظ بالوجهة والضيوف. اختر تواريخ جديدة لنعرض الأسعار المتاحة.' : 'We kept the destination and guests. Choose new dates to see current prices.'}/>
      <Button testID="continue-search-new-dates" icon="calendar" title={ar ? 'اختر تواريخ جديدة' : 'Choose new dates'} onPress={onNewDates}/>
    </> : <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
      <View style={{ flexGrow: 1, flexBasis: 180 }}><Button testID="continue-search-resume" iconEnd="forward" title={current ? (ar ? 'العودة إلى النتائج' : 'Back to results') : (ar ? 'عرض الأسعار' : 'Show prices')} onPress={onResume}/></View>
      <View style={{ flexGrow: 1, flexBasis: 120 }}><Button testID="continue-search-edit" variant="secondary" title={ar ? 'تعديل البحث' : 'Edit search'} onPress={onEdit}/></View>
    </Row>}
  </Card>;
}

type TripResult = { key: string; bookings: BookingHistoryItem[] } | null;

/** The next stay on the account, with a direct path to its voucher. Silent when there is nothing to show. */
export function UpcomingTripCard() {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const { status, sessionRevision } = useAuth();
  const key = `${status}:${sessionRevision}`;
  const [result, setResult] = useState<TripResult>(null);
  useFocusEffect(useCallback(() => {
    if (status !== 'signedIn') return;
    const controller = new AbortController();
    api.getBookings(controller.signal).then(bookings => { if (!controller.signal.aborted) setResult({ key, bookings }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, bookings: [] }); });
    return () => controller.abort();
  }, [status, key]));
  if (status !== 'signedIn') return null;
  if (!result || result.key !== key) return <Card style={{ gap: space.sm }}><Skeleton width="40%" height={14}/><Skeleton width="80%" height={20}/><Skeleton width="60%" height={14}/></Card>;
  const today = localTodayKey();
  const row = buildTripsModel(result.bookings, today).rows.find(item => (item.bucket === 'current' || item.bucket === 'upcoming')
    && (item.statusKind === 'confirmed' || item.statusKind === 'pending'));
  if (!row) return null;
  const booking = row.booking, confirmed = row.statusKind === 'confirmed';
  const until = row.dates.checkin ? Math.round((Date.parse(row.dates.checkin + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000) : null;
  const when = until === null ? '' : untilLabel(until, language);
  return <Card testID="upcoming-trip" elevated style={styles.trip}>
    <Row style={{ justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
      <Txt kind="caption" style={{ color: color.textOnDarkMuted }}>{ar ? 'رحلتك القادمة' : 'Your upcoming trip'}{when ? ` · ${when}` : ''}</Txt>
      <Badge tone={confirmed ? 'success' : 'warning'} icon={confirmed ? 'checkCircle' : 'hourglass'}
        label={confirmed ? (ar ? 'مؤكد من الفندق' : 'Confirmed by the hotel') : (ar ? 'بانتظار تأكيد الفندق' : 'Awaiting hotel confirmation')}/>
    </Row>
    <Txt kind="heading" style={{ color: color.textOnDark }}>{booking.hotelName || (ar ? 'اسم الفندق غير متاح' : 'Hotel name unavailable')}</Txt>
    {row.dates.checkin && row.dates.checkout && <Txt kind="bodyStrong" style={{ color: color.textOnDark }}>
      {formatDay(row.dates.checkin, language, { weekday: true })} – {formatDay(row.dates.checkout, language, { weekday: true })}
      {row.dates.nights ? ` · ${stayWords(language).nights(row.dates.nights)}` : ''}</Txt>}
    <Txt kind="caption" style={{ color: color.textOnDarkMuted }}>{ar ? 'مرجع الحجز' : 'Booking reference'} · <Txt kind="caption" style={{ color: color.textOnDark, writingDirection: 'ltr' }}>{booking.reference}</Txt></Txt>
    {!confirmed && <Txt kind="small" style={{ color: color.textOnDark }}>{ar ? 'استلمنا طلب الحجز وننتظر تأكيد المورّد. ستظهر الحالة هنا فور تحديثها.' : 'We received your booking request and are waiting for the supplier to confirm. The status updates here.'}</Txt>}
    <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
      {canDownloadVoucher(booking) && <View style={{ flexGrow: 1, flexBasis: 160 }}><VoucherButton booking={booking} onDark/></View>}
      <View style={{ flexGrow: 1, flexBasis: 140 }}><Button variant="tonal" iconEnd="forward" title={ar ? 'تفاصيل الرحلة' : 'Trip details'} onPress={() => router.navigate('/bookings')}/></View>
    </Row>
  </Card>;
}

const styles = StyleSheet.create({
  continue: { borderColor: color.accentBorder, gap: space.md },
  badgeIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.accentBg, alignItems: 'center', justifyContent: 'center' },
  trip: { backgroundColor: color.bgBrand, borderColor: color.bgBrand, gap: space.sm },
});
