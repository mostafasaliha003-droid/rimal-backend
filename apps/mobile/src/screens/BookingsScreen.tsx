import React, { useCallback, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../api';
import { bookingHotelName, type BookingHistoryItem } from '../api/bookings';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Badge, Button, Card, Chip, Field, IconButton, InfoRow, Row, Skeleton, StatePanel, TextLink, Txt, DisclosureMark, type BadgeTone, type IconName, type NoticeTone } from '../components/Primitives';
import { canDownloadVoucher } from '../api/voucher';
import { formatPrice, formatStayRange, formatWeekday, stayWords } from '../components/format';
import {
  buildTripsModel, filterTrips, formatTripDate, localTodayKey,
  type TripBucket, type TripFilter, type TripRow,
} from '../components/tripsModel';
import VoucherButton from '../components/VoucherButton';
import { tripsCopy } from './tripsCopy';
import { localizedRoomName } from '../components/roomNameModel';
import { useLayout } from '../components/motion';

const buckets: TripBucket[] = ['current', 'upcoming', 'past', 'cancelled', 'unknown'];
const filters: TripFilter[] = ['all', ...buckets];
const noBookings: readonly BookingHistoryItem[] = Object.freeze([]);
type HistoryResult = { key: string; bookings: BookingHistoryItem[]; error: boolean };
type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

const statusMeta: Record<TripRow['statusKind'], { tone: BadgeTone; notice: NoticeTone; icon: IconName }> = {
  confirmed: { tone: 'success', notice: 'success', icon: 'checkCircle' }, pending: { tone: 'warning', notice: 'warning', icon: 'hourglass' },
  cancelled: { tone: 'neutral', notice: 'neutral', icon: 'close' }, failed: { tone: 'danger', notice: 'danger', icon: 'alertCircle' },
  unknown: { tone: 'neutral', notice: 'neutral', icon: 'info' },
};

function BookingCard({ row, today }: { row: TripRow; today: string }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const copy = tripsCopy(language);
  const router = useRouter();
  const booking = row.booking;
  const meta = statusMeta[row.statusKind];
  const [expanded, setExpanded] = useState(false);
  // Help and changes stay in the app: the booking's conversation with the team, and the change guide.
  // Live chat is for bookings the hotel confirmed (still open after a later cancellation, for the refund).
  const validRef = /^[A-Za-z0-9_-]{1,120}$/.test(booking.reference) && (row.statusKind === 'confirmed' || row.statusKind === 'cancelled');
  const openCare = () => router.push({ pathname: '/care/[reference]', params: { reference: booking.reference } });
  const openChange = () => router.push({ pathname: '/change/[reference]', params: { reference: booking.reference } });
  // Received is not confirmed: say so plainly, and discourage a second booking for the same stay.
  const statusText = {
    confirmed: { title: ar ? 'مؤكد من الفندق' : 'Confirmed by the hotel', body: ar ? 'حجزك مؤكد. أبرز رقم الحجز أو قسيمة الحجز عند الوصول.' : 'Your booking is confirmed. Show the booking reference or voucher at check-in.' },
    pending: { title: ar ? 'استلمنا طلبك · بانتظار التأكيد' : 'Request received · awaiting confirmation', body: ar ? 'لا يُعد الحجز مؤكداً حتى يؤكده المورّد، وستتحدّث الحالة هنا. لا تحجز التواريخ نفسها مرة أخرى.' : 'It is not confirmed until the supplier confirms it; the status updates here. Please do not book the same dates again.' },
    cancelled: { title: copy.status.cancelled, body: ar ? 'هذا الحجز ملغى.' : 'This booking is cancelled.' },
    failed: { title: copy.status.failed, body: ar ? 'لم يكتمل الحجز. إن ظهر خصم على وسيلة الدفع، تواصل مع الدعم مع رقم الحجز.' : 'The booking did not complete. If you see a charge, contact support with the booking reference.' },
    unknown: { title: copy.status.unknown, body: ar ? 'تعذّر تأكيد حالة هذا الحجز. تواصل مع الدعم للتحقق قبل أي خطوة.' : 'We could not confirm this booking’s status. Contact support to check before taking any step.' },
  }[row.statusKind];
  const bookAgain = () => router.navigate({ pathname: '/', params: { q: booking.hotelName || '' } });
  const range = row.dates.checkin && row.dates.checkout ? formatStayRange(row.dates.checkin, row.dates.checkout, language)
    : [formatTripDate(row.dates.checkin, language) || copy.dateUnknown, formatTripDate(row.dates.checkout, language) || copy.dateUnknown].join(' – ');
  const weekdays = row.dates.checkin && row.dates.checkout
    ? `${copy.checkin} ${formatWeekday(row.dates.checkin, language)} · ${copy.checkout} ${formatWeekday(row.dates.checkout, language)}` : '';
  const canAmend = booking.recordedStatus?.toLowerCase() === 'active' && booking.supplierStatus?.toUpperCase() === 'CONFIRMED';
  const canBookAgain = (row.bucket === 'past' || row.statusKind === 'cancelled') && !!booking.hotelName;
  // A confirmed, upcoming stay is cancelled inside the app, where the fee and refund are shown first.
  const canCancel = row.statusKind === 'confirmed' && row.bucket !== 'past' && /^[A-Za-z0-9_-]{1,120}$/.test(booking.reference);
  const openCancellation = () => router.push({ pathname: '/cancel/[reference]', params: { reference: booking.reference } });
  const nightsText = row.dates.nights !== null ? ` · ${stayWords(language).nights(row.dates.nights)}` : '';
  const amount = booking.price ? formatPrice(booking.price) || '' : '';
  // Received is not confirmed: the warning stays visible on the card, not behind the toggle.
  const urgent = row.statusKind === 'pending' || row.statusKind === 'failed' || row.statusKind === 'unknown';
  return (
    <Card testID={`trip-${booking.reference}`} style={[styles.card, { flexGrow: 1 }]}>
      <Row style={{ justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
        <Badge tone={meta.tone} icon={meta.icon} label={statusText.title}/>
        {row.bucket === 'current' && <Badge tone="info" label={copy.groups.current}/>}
      </Row>
      <Txt kind="subheading" accessibilityRole="header" numberOfLines={2}>{bookingHotelName(booking, language) || copy.hotelUnknown}</Txt>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <InfoRow icon="calendar">
            <Txt kind="label" tone="primary" numberOfLines={2}>{range}{nightsText}</Txt>
            {row.bucket === 'current' && row.dates.checkin === today && <Txt kind="label" tone="info">{copy.arrivalToday}</Txt>}
            {row.bucket === 'current' && row.dates.checkout === today && <Txt kind="label" tone="info">{copy.departureToday}</Txt>}
            {row.dates.issue && <Txt kind="caption" tone="warning">{row.dates.issue === 'missing' ? copy.datesIncomplete : copy.datesInvalid}</Txt>}
          </InfoRow>
          <Txt selectable kind="caption" accessibilityLabel={`${copy.reference}: ${booking.reference}`} style={{ writingDirection: 'ltr', textAlign: ar ? 'right' : 'left' }}>{booking.reference}</Txt>
        </View>
        {!!amount && <Txt kind="label" tone="primary" accessibilityLabel={`${copy.recordedAmount}: ${amount}`} style={{ writingDirection: 'ltr' }}>{amount}</Txt>}
      </Row>
      {urgent && <Txt kind="small" tone={meta.notice === 'danger' ? 'danger' : 'primary'} style={styles.urgent}>{statusText.body}</Txt>}
      <Row style={{ gap: space.md, flexWrap: 'wrap', rowGap: space.xs, justifyContent: 'space-between' }}>
        <Row style={{ gap: space.md, flexWrap: 'wrap', rowGap: space.xs, flexShrink: 1 }}>
          {canDownloadVoucher(booking) && <VoucherButton booking={booking} compact/>}
          {canBookAgain && <TextLink testID={`trip-book-again-${booking.reference}`} icon="refresh" title={ar ? 'احجز مجدداً' : 'Book again'} onPress={bookAgain}/>}
        </Row>
        <Pressable testID={`trip-more-${booking.reference}`} accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
          accessibilityLabel={`${ar ? 'التفاصيل والإجراءات' : 'Details & actions'} · ${bookingHotelName(booking, language) || booking.reference}`}
          onPress={() => setExpanded(value => !value)} hitSlop={{ top: 6, bottom: 6 }} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Row style={{ gap: space.xxs }}>
            <Txt kind="label" tone="link">{ar ? 'التفاصيل' : 'Details'}</Txt>
            <DisclosureMark open={expanded} color={color.textLink}/>
          </Row>
        </Pressable>
      </Row>
      {expanded && <View style={styles.more}>
        {booking.roomName && <InfoRow icon="bed"><Txt kind="small" tone="primary">{localizedRoomName(booking.roomName, language)}</Txt></InfoRow>}
        {!!weekdays && <InfoRow icon="calendar"><Txt kind="small">{weekdays}</Txt></InfoRow>}
        {!urgent && <Txt kind="small">{statusText.body}</Txt>}
        <Row style={{ gap: space.lg, flexWrap: 'wrap', rowGap: space.xs }}>
          {validRef ? <TextLink testID={`trip-care-${booking.reference}`} icon="chat" title={ar ? 'راسل فريق مخدة' : 'Message our team'} label={ar ? 'محادثة مع فريق مخدة عن هذا الحجز' : 'Conversation with the Mkhadda team about this booking'} onPress={openCare}/>
            : <TextLink icon="support" title={ar ? 'مساعدة' : 'Help'} label={ar ? 'مساعدة بهذا الحجز' : 'Help with this booking'} onPress={() => router.navigate('/support')}/>}
          {canAmend && validRef && <TextLink testID={`trip-change-${booking.reference}`} icon="edit" title={ar ? 'تعديل الحجز' : 'Change booking'} onPress={openChange}/>}
          {canCancel && <TextLink testID={`trip-cancel-${booking.reference}`} icon="close" title={ar ? 'إلغاء الحجز' : 'Cancel booking'}
            label={ar ? 'إلغاء الحجز ومعرفة المبلغ المسترد' : 'Cancel the booking and see the refund'} onPress={openCancellation}/>}
          {row.statusKind === 'cancelled' && <TextLink testID={`trip-cancel-status-${booking.reference}`} icon="wallet" title={ar ? 'حالة الإلغاء والاسترداد' : 'Cancellation & refund status'} onPress={openCancellation}/>}
        </Row>
        {(booking.recordedStatus || booking.supplierStatus) && <View style={{ gap: 1 }}>
          {booking.recordedStatus && <Txt kind="caption">{copy.recordedStatus}: {booking.recordedStatus}</Txt>}
          {booking.supplierStatus && <Txt kind="caption">{copy.supplierStatus}: {booking.supplierStatus}</Txt>}
        </View>}
      </View>}
    </Card>
  );
}

function OwnerTrips({ status, ownerKey }: { status: AuthStatus; ownerKey: string }) {
  const { language, t } = useLanguage();
  const copy = tripsCopy(language);
  const router = useRouter();
  const [retry, setRetry] = useState(0);
  const [today, setToday] = useState(localTodayKey);
  const [result, setResult] = useState<HistoryResult>({ key: '', bookings: [], error: false });
  const [activeFilter, setFilter] = useState<TripFilter>('all');
  const [query, setQuery] = useState('');
  const [lookupOpen, setLookupOpen] = useState(false);
  const requestKey = `${ownerKey}:${retry}`;
  const current = status === 'signedIn' && result.key === requestKey ? result : null;

  useFocusEffect(useCallback(() => {
    if (status !== 'signedIn') return;
    const controller = new AbortController();
    api.getBookings(controller.signal).then(bookings => {
      if (!controller.signal.aborted) setResult({ key: requestKey, bookings, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key: requestKey, bookings: [], error: true });
    });
    return () => controller.abort();
  }, [status, requestKey]));

  useFocusEffect(useCallback(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (!active) return;
      setToday(localTodayKey());
      if (timer) clearTimeout(timer);
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 20);
      timer = setTimeout(sync, Math.max(1, next.getTime() - now.getTime()));
    };
    sync();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []));

  const bookings = current?.bookings || noBookings;
  const model = useMemo(() => buildTripsModel(bookings, today), [bookings, today]);
  const visible = useMemo(() => filterTrips(model, activeFilter, query), [model, activeFilter, query]);
  const { desktop } = useLayout();
  const sections = useMemo(() => buckets.map(bucket => {
    const rows = visible.filter(row => row.bucket === bucket);
    // Each list item is one row of cards: two side by side on wide screens, one on phones.
    const data = desktop ? rows.reduce<TripRow[][]>((pairs, row, index) => { if (index % 2 === 0) pairs.push([row]); else pairs[pairs.length - 1].push(row); return pairs; }, [])
      : rows.map(row => [row]);
    return { key: bucket, bucket, count: rows.length, data };
  }).filter(section => section.count > 0), [visible, desktop]);
  const refresh = () => setRetry(value => value + 1);
  const reset = () => { setFilter('all'); setQuery(''); };
  const findStay = () => router.navigate('/');
  const heading = <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
    <Txt kind="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{copy.title}</Txt>
    {status === 'signedIn' && current && !current.error && current.bookings.length > 0 && <Row style={{ gap: 0 }}>
      <IconButton icon="search" testID="trips-find" label={copy.findBooking} selected={lookupOpen} onPress={() => setLookupOpen(value => !value)}/>
      <IconButton icon="refresh" testID="trips-refresh" label={copy.refresh} onPress={refresh}/>
    </Row>}
  </Row>;
  const controls = (
    <View style={{ gap: space.sm }}>
      <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
        {/* Empty groups add no choice; they stay hidden unless selected. */}
        {filters.filter(filter => filter === 'all' || filter === activeFilter || model.counts[filter] > 0).map(filter => {
          const selected = activeFilter === filter;
          return (
            <Chip size="sm" key={filter} selected={selected} label={`${copy.filters[filter]} (${model.counts[filter]})`} accessibilityLabel={`${copy.filtersLabel}: ${copy.filters[filter]}`} onPress={() => setFilter(filter)}/>
          );
        })}
      </Row>
      {lookupOpen && (
        <Field label={copy.lookupLabel} value={query} maxLength={200} autoCorrect={false} autoCapitalize="none" autoFocus
          accessibilityHint={copy.lookupHint} onChangeText={setQuery} />
      )}
      {query.length > 0 && (
        <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <Txt kind="small">{copy.lookupApplied}</Txt>
          <Button compact title={copy.clearLookup} variant="quiet" onPress={() => setQuery('')} />
        </Row>
      )}
      {(query.length > 0 || activeFilter !== 'all') && <Txt kind="caption" accessibilityLiveRegion="polite">{copy.results(visible.length, model.rows.length)}</Txt>}
    </View>
  );
  const footer = (
    <View style={{ gap: 6, paddingTop: 12 }}>
      <Txt kind="small">{copy.readOnly}</Txt>
      <Button variant="quiet" title={copy.help} hint={copy.helpHint} onPress={() => router.navigate('/support')} />
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <BrandHeader />
      {status === 'signedIn' && current && !current.error && current.bookings.length > 0 ? (
        <SectionList sections={sections} keyExtractor={rows => rows.map(row => row.booking.reference).join('|')}
          renderItem={({ item }) => item.length === 1 && !desktop ? <BookingCard row={item[0]} today={today} />
            : <Row style={{ gap: space.md, alignItems: 'stretch' }}>{item.map(row => <View key={row.booking.reference} style={{ flex: 1, minWidth: 0 }}><BookingCard row={row} today={today} /></View>)}
              {item.length === 1 && <View style={{ flex: 1 }}/>}</Row>}
          renderSectionHeader={({ section }) => (
            <View style={{ paddingTop: space.xs, paddingBottom: space.sm }}>
              <Txt kind="subheading" accessibilityRole="header">{copy.groups[section.bucket]} ({section.count})</Txt>
            </View>
          )}
          contentContainerStyle={[ui.page, styles.page]} stickySectionHeadersEnabled={false}
          initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
          keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
          ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
          renderSectionFooter={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={<View style={{ gap: space.sm, paddingBottom: space.xs }}>{heading}{controls}</View>}
          ListEmptyComponent={(
            <View style={{ gap: 14 }}>
              <StatePanel title={copy.noMatchesTitle} body={copy.noMatchesBody} />
              <Button title={copy.allTrips} onPress={reset} />
            </View>
          )}
          ListFooterComponent={footer} />
      ) : (
        <ScrollView contentContainerStyle={[ui.page, styles.page]}>
          {heading}
          {status === 'loading' || status === 'signedIn' && !current ? (
            <View style={{ gap: space.md }} accessibilityLabel={copy.loadingTitle}>
              <Txt kind="caption" accessibilityLiveRegion="polite">{copy.loadingTitle}</Txt>
              {[0, 1].map(index => <Card key={index} style={styles.card}>
                <Skeleton width={128} height={22} rounded={radius.sm}/>
                <Skeleton width="78%" height={20}/>
                <Row style={{ justifyContent: 'space-between' }}><Skeleton width="52%" height={14}/><Skeleton width="26%" height={16}/></Row>
                <Skeleton width="34%" height={12}/>
              </Card>)}
            </View>
          ) : status !== 'signedIn' ? (
            <>
              <StatePanel title={copy.signInTitle} body={copy.signInBody} />
              <Button title={t('signIn')} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: '/bookings' } })} />
              <Button title={copy.findStay} variant="secondary" onPress={findStay} />
            </>
          ) : current?.error ? (
            <StatePanel title={copy.errorTitle} body={copy.errorBody} retry={refresh} />
          ) : (
            <>
              <StatePanel title={copy.emptyTitle} body={copy.emptyBody} />
              <Button title={copy.findStay} onPress={findStay} />
              <Button title={copy.refresh} variant="secondary" onPress={refresh} />
            </>
          )}
          {footer}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default function BookingsScreen() {
  const { status, user, sessionRevision } = useAuth();
  const ownerKey = `${status}:${sessionRevision}`;
  // Unmount all record data, lookup text and filters on owner/session change.
  // Cleanup aborts pending work; response guards also prevent late publication.
  return <OwnerTrips key={ownerKey} ownerKey={ownerKey} status={status === 'signedIn' && !user ? 'signedOut' : status} />;
}

const styles = StyleSheet.create({
  page: { gap: space.md, paddingTop: space.md },
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg },
  urgent: { backgroundColor: color.bgSubtle, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xs },
  more: { gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.border },
});
