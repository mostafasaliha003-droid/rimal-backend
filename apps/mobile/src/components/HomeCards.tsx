import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SearchCriteria } from '../types';
import { api } from '../api';
import { bookingHotelName, type BookingHistoryItem } from '../api/bookings';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, palette, radius, space } from '../theme';
import { Button, Icon, IconButton, Row, Txt } from './Primitives';
import { formatStayRange, guestLine, nightsBetween, stayWords, untilLabel } from './format';
import { buildTripsModel, localTodayKey } from './tripsModel';

const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/**
 * Where the traveler stopped, as one compact strip: destination and stay on the left, one action
 * on the right. Tapping the text fills the search form to edit it. Search stays on the first screen.
 */
export function ContinueSearchCard({ name, criteria, current, datesPassed, onResume, onEdit, onNewDates, onClear }: {
  name: string; criteria: SearchCriteria; current: boolean; datesPassed: boolean;
  onResume: () => void; onEdit: () => void; onNewDates: () => void; onClear?: () => void;
}) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const nights = nightsBetween(criteria.checkin, criteria.checkout);
  const dates = [formatStayRange(criteria.checkin, criteria.checkout, language), nights ? stayWords(language).nights(nights) : ''].filter(Boolean).join(' · ');
  const title = current ? (ar ? 'بحثك الحالي' : 'Your current search') : (ar ? 'تابع بحثك' : 'Continue your search');
  return <View testID="continue-search" style={[styles.strip, styles.continue]}>
    <Row style={{ gap: space.sm }}>
      <View style={styles.badgeIcon}><Icon name="history" size={17} color={color.accent}/></View>
      <Pressable testID="continue-search-edit" accessibilityRole="button" onPress={onEdit} style={state => [{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', borderRadius: radius.sm }, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}
        accessibilityLabel={`${title}: ${name} · ${dates} · ${guestLine(criteria.guests, language)}`} accessibilityHint={ar ? 'يملأ نموذج البحث لتعديله' : 'Fills the search form to edit it'}>
        <Txt kind="label" tone="primary" numberOfLines={1}>{title}: <Txt kind="label" testID="continue-search-destination">{name}</Txt></Txt>
        <Txt kind="caption" numberOfLines={1} tone={datesPassed ? 'warning' : 'secondary'}>
          {datesPassed ? (ar ? 'مرّت تواريخ هذا البحث' : 'These dates have passed') : <><Txt kind="caption" testID="continue-search-dates">{dates}</Txt> · <Txt kind="caption" testID="continue-search-guests">{guestLine(criteria.guests, language)}</Txt></>}
        </Txt>
      </Pressable>
      {datesPassed ? <Button testID="continue-search-new-dates" compact icon="calendar" title={ar ? 'تواريخ جديدة' : 'New dates'} onPress={onNewDates}/>
        : <Button testID="continue-search-resume" compact iconEnd="forward" title={current ? (ar ? 'النتائج' : 'Results') : (ar ? 'الأسعار' : 'Prices')}
          label={current ? (ar ? 'العودة إلى النتائج' : 'Back to results') : (ar ? 'عرض الأسعار' : 'Show prices')} onPress={onResume}/>}
      {onClear && <IconButton icon="close" size={16} label={ar ? 'إزالة هذا البحث من الجهاز' : 'Remove this search from this device'} onPress={onClear}/>}
    </Row>
  </View>;
}

type TripResult = { key: string; bookings: BookingHistoryItem[] } | null;

/**
 * The next stay on the account as a compact strip: hotel, dates and status; the whole strip opens
 * Trips (where the voucher is one tap away). Silent when there is nothing to show.
 */
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
  if (status !== 'signedIn' || !result || result.key !== key) return null;
  const today = localTodayKey();
  const row = buildTripsModel(result.bookings, today).rows.find(item => (item.bucket === 'current' || item.bucket === 'upcoming')
    && (item.statusKind === 'confirmed' || item.statusKind === 'pending'));
  if (!row) return null;
  const booking = row.booking, confirmed = row.statusKind === 'confirmed';
  const until = row.dates.checkin ? Math.round((Date.parse(row.dates.checkin + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000) : null;
  const when = until === null ? '' : untilLabel(until, language);
  const dates = row.dates.checkin && row.dates.checkout ? [formatStayRange(row.dates.checkin, row.dates.checkout, language), row.dates.nights ? stayWords(language).nights(row.dates.nights) : ''].filter(Boolean).join(' · ') : '';
  const statusText = confirmed ? (ar ? 'مؤكد' : 'Confirmed') : (ar ? 'بانتظار التأكيد' : 'Awaiting confirmation');
  const hotel = bookingHotelName(booking, language) || (ar ? 'اسم الفندق غير متاح' : 'Hotel name unavailable');
  return <Pressable testID="upcoming-trip" accessibilityRole="button" onPress={() => router.navigate('/bookings')}
    accessibilityLabel={[ar ? 'رحلتك القادمة' : 'Your upcoming trip', when, hotel, dates, statusText, `${ar ? 'مرجع الحجز' : 'Booking reference'} ${booking.reference}`].filter(Boolean).join(' · ')}
    accessibilityHint={ar ? 'يفتح رحلاتي' : 'Opens My trips'}
    style={state => [styles.strip, styles.trip, (state.pressed || hovered(state)) && { opacity: 0.92 }]}>
    <Row style={{ gap: space.sm }}>
      <View style={styles.tripIcon}><Icon name="trips" size={18} color={color.textOnDark}/></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="caption" numberOfLines={1} style={{ color: color.textOnDarkMuted }}>{ar ? 'رحلتك القادمة' : 'Your upcoming trip'}{when ? ` · ${when}` : ''}</Txt>
        <Txt kind="label" numberOfLines={1} style={{ color: color.textOnDark }}>{hotel}</Txt>
        <Row style={{ gap: space.xs }}>
          <Icon name={confirmed ? 'checkCircle' : 'hourglass'} size={13} color={confirmed ? palette.pistachio300 : palette.gold200}/>
          <Txt kind="caption" numberOfLines={1} style={{ color: color.textOnDark, flexShrink: 1 }}>{[dates, statusText].filter(Boolean).join(' · ')}</Txt>
        </Row>
      </View>
      <Icon name="chevron" size={18} color={color.textOnDarkMuted}/>
    </Row>
  </Pressable>;
}

const styles = StyleSheet.create({
  strip: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  continue: { backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.accentBorder },
  badgeIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.accentBg, alignItems: 'center', justifyContent: 'center' },
  trip: { backgroundColor: color.bgBrand },
  tripIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
});
