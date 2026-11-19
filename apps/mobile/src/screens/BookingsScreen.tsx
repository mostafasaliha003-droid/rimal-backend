import React, { useCallback, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, websiteUrl } from '../api';
import type { BookingHistoryItem } from '../api/bookings';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, colors, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Badge, Button, Card, Chip, Field, MoneyText, Notice, Row, StatePanel, Txt, DisclosureMark, type BadgeTone, type IconName, type NoticeTone } from '../components/Primitives';
import { canDownloadVoucher } from '../api/voucher';
import { formatWeekday, stayWords } from '../components/format';
import {
  buildTripsModel, filterTrips, formatTripDate, localTodayKey,
  type TripBucket, type TripFilter, type TripRow,
} from '../components/tripsModel';
import VoucherButton from '../components/VoucherButton';
import * as WebBrowser from 'expo-web-browser';
import { tripsCopy } from './tripsCopy';

const buckets: TripBucket[] = ['current', 'upcoming', 'past', 'unknown'];
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
  const [accountError, setAccountError] = useState(false);
  const manage = (amend = false) => {
    setAccountError(false);
    const url = new URL(websiteUrl(amend ? '/support' : '/account'));
    if (amend) {
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(booking.reference)) { setAccountError(true); return; }
      url.searchParams.set('reference', booking.reference); url.searchParams.set('request', 'amendment');
    }
    void WebBrowser.openBrowserAsync(url.href, { toolbarColor: color.bgBrand }).catch(() => setAccountError(true));
  };
  // Received is not confirmed: say so plainly, and discourage a second booking for the same stay.
  const statusText = {
    confirmed: { title: ar ? 'مؤكد من الفندق' : 'Confirmed by the hotel', body: ar ? 'حجزك مؤكد. أبرز رقم الحجز أو الفاوجر عند الوصول.' : 'Your booking is confirmed. Show the booking reference or voucher at check-in.' },
    pending: { title: ar ? 'استلمنا طلبك · بانتظار التأكيد' : 'Request received · awaiting confirmation', body: ar ? 'لا يُعد الحجز مؤكداً حتى يؤكده المورّد، وستتحدّث الحالة هنا. لا تحجز التواريخ نفسها مرة أخرى.' : 'It is not confirmed until the supplier confirms it; the status updates here. Please do not book the same dates again.' },
    cancelled: { title: copy.status.cancelled, body: ar ? 'هذا الحجز ملغى.' : 'This booking is cancelled.' },
    failed: { title: copy.status.failed, body: ar ? 'لم يكتمل الحجز. إن ظهر خصم على وسيلة الدفع، تواصل مع الدعم مع رقم الحجز.' : 'The booking did not complete. If you see a charge, contact support with the booking reference.' },
    unknown: { title: copy.status.unknown, body: ar ? 'تعذّر تأكيد حالة هذا الحجز. تواصل مع الدعم للتحقق قبل أي خطوة.' : 'We could not confirm this booking’s status. Contact support to check before taking any step.' },
  }[row.statusKind];
  const bookAgain = () => router.navigate({ pathname: '/', params: { q: booking.hotelName || '' } });
  return (
    <Card testID={`trip-${booking.reference}`} style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
        <Badge tone={meta.tone} icon={meta.icon} label={statusText.title}/>
        {row.bucket === 'current' && <Badge tone="info" label={copy.groups.current}/>}
      </Row>
      <View style={{ gap: space.xxs }}>
        <Txt kind="subheading" accessibilityRole="header">{booking.hotelName || copy.hotelUnknown}</Txt>
        {booking.roomName && <Txt kind="small">{booking.roomName}</Txt>}
      </View>
      <View style={styles.dates}>
        <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        {(['checkin', 'checkout'] as const).map(key => <View key={key} style={{ flex: 1, minWidth: 0 }}>
          <Txt kind="caption">{copy[key]}</Txt>
          <Txt kind="bodyStrong">{formatTripDate(row.dates[key], language) || copy.dateUnknown}</Txt>
          {row.dates[key] && <Txt kind="caption">{formatWeekday(row.dates[key]!, language)}</Txt>}
        </View>)}
        </Row>
        {row.dates.nights !== null && <Badge tone="info" icon="moon" label={stayWords(language).nights(row.dates.nights)}/>}
      </View>
      {row.bucket === 'current' && row.dates.checkin === today && <Txt kind="label" tone="info">{copy.arrivalToday}</Txt>}
      {row.bucket === 'current' && row.dates.checkout === today && <Txt kind="label" tone="info">{copy.departureToday}</Txt>}
      {row.dates.issue && <Txt kind="small">{row.dates.issue === 'missing' ? copy.datesIncomplete : copy.datesInvalid}</Txt>}
      {row.statusKind !== 'confirmed' && <Notice tone={meta.notice} body={statusText.body}/>}
      <Row style={{ justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: space.xxs }}>
          <Txt kind="caption">{copy.reference}</Txt>
          <Txt selectable kind="bodyStrong" style={{ writingDirection: 'ltr' }}>{booking.reference}</Txt>
        </View>
        {booking.price && <View style={{ gap: space.xxs, alignItems: ar ? 'flex-start' : 'flex-end' }}>
          <Txt kind="caption">{copy.recordedAmount}</Txt><MoneyText money={booking.price}/>
        </View>}
      </Row>
      {canDownloadVoucher(booking) && <View style={{ gap: space.xs }}>
        <VoucherButton booking={booking}/>
        <Txt kind="caption">{ar ? 'يتضمن الفاوجر عنوان الفندق ووقت الوصول عند توفّرهما من المورّد.' : 'The voucher includes the hotel address and check-in time when the supplier provides them.'}</Txt>
      </View>}
      <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1, flexBasis: 150 }}><Button variant="secondary" icon="support" title={ar ? 'مساعدة بهذا الحجز' : 'Help with this booking'}
          onPress={() => router.navigate('/support')}/></View>
        {booking.recordedStatus?.toLowerCase() === 'active' && booking.supplierStatus?.toUpperCase() === 'CONFIRMED' &&
          <View style={{ flexGrow: 1, flexBasis: 150 }}><Button variant="secondary" icon="edit" title={ar ? 'طلب تعديل' : 'Request a change'} onPress={() => manage(true)}/></View>}
      </Row>
      <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1, flexBasis: 150 }}><Button variant="quiet" icon="external" title={ar ? 'الإلغاء والاسترداد على الموقع' : 'Cancellation & refunds online'} onPress={() => manage()}/></View>
        {(row.bucket === 'past' || row.statusKind === 'cancelled') && !!booking.hotelName &&
          <View style={{ flexGrow: 1, flexBasis: 150 }}><Button testID={`trip-book-again-${booking.reference}`} variant="tonal" icon="refresh" title={ar ? 'احجز مجدداً' : 'Book again'}
            hint={ar ? 'نبدأ بحثاً جديداً بهذا الفندق ونتحقق من الأسعار والتوفر لتواريخك الجديدة.' : 'Starts a new search for this hotel and checks prices and availability for your new dates.'} onPress={bookAgain}/></View>}
      </Row>
      {accountError && <Txt accessibilityRole="alert" kind="small" tone="danger">{ar ? 'تعذّر فتح حسابك على الموقع. حاول مجدداً.' : 'Could not open your online account. Try again.'}</Txt>}
      {(booking.recordedStatus || booking.supplierStatus) && (
        <View style={{ gap: space.xs }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
            onPress={() => setExpanded(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" tone="link">{copy.recordDetails}</Txt>
              <DisclosureMark open={expanded}/>
            </Row>
          </Pressable>
          {expanded && (
            <View style={{ gap: space.xxs }}>
              {booking.recordedStatus && <Txt kind="small">{copy.recordedStatus}: {booking.recordedStatus}</Txt>}
              {booking.supplierStatus && <Txt kind="small">{copy.supplierStatus}: {booking.supplierStatus}</Txt>}
            </View>
          )}
        </View>
      )}
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
  const sections = useMemo(() => buckets.map(bucket => ({
    key: bucket, bucket, data: visible.filter(row => row.bucket === bucket),
  })).filter(section => section.data.length > 0), [visible]);
  const refresh = () => setRetry(value => value + 1);
  const reset = () => { setFilter('all'); setQuery(''); };
  const findStay = () => router.navigate('/');
  const heading = <Txt kind="title" accessibilityRole="header">{copy.title}</Txt>;
  const controls = (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Txt kind="label">{copy.filtersLabel}</Txt>
        <Button compact title={copy.refresh} variant="quiet" onPress={refresh} />
      </Row>
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        {filters.map(filter => {
          const selected = activeFilter === filter;
          return (
            <Chip key={filter} selected={selected} label={`${copy.filters[filter]} (${model.counts[filter]})`} onPress={() => setFilter(filter)}/>
          );
        })}
      </Row>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: lookupOpen }} aria-expanded={lookupOpen}
        onPress={() => setLookupOpen(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label" style={{ color: colors.blueStrong }}>{copy.findBooking}</Txt>
          <DisclosureMark open={lookupOpen}/>
        </Row>
      </Pressable>
      {lookupOpen && (
        <Field label={copy.lookupLabel} value={query} maxLength={200} autoCorrect={false} autoCapitalize="none"
          accessibilityHint={copy.lookupHint} onChangeText={setQuery} />
      )}
      {query.length > 0 && (
        <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <Txt kind="small">{copy.lookupApplied}</Txt>
          <Button compact title={copy.clearLookup} variant="quiet" onPress={() => setQuery('')} />
        </Row>
      )}
      <Txt kind="small" accessibilityLiveRegion="polite">{copy.results(visible.length, model.rows.length)}</Txt>
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
        <SectionList sections={sections} keyExtractor={row => row.booking.reference}
          renderItem={({ item }) => <BookingCard row={item} today={today} />}
          renderSectionHeader={({ section }) => (
            <View style={{ paddingTop: 8, paddingBottom: 12 }}>
              <Txt kind="heading" accessibilityRole="header">{copy.groups[section.bucket]} ({section.data.length})</Txt>
            </View>
          )}
          contentContainerStyle={ui.page} stickySectionHeadersEnabled={false}
          initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
          keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          renderSectionFooter={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={<View style={{ gap: 12, paddingBottom: 8 }}>{heading}{controls}</View>}
          ListEmptyComponent={(
            <View style={{ gap: 14 }}>
              <StatePanel title={copy.noMatchesTitle} body={copy.noMatchesBody} />
              <Button title={copy.allTrips} onPress={reset} />
            </View>
          )}
          ListFooterComponent={footer} />
      ) : (
        <ScrollView contentContainerStyle={ui.page}>
          {heading}
          {status === 'loading' || status === 'signedIn' && !current ? (
            <StatePanel title={copy.loadingTitle} body={copy.loadingBody} busy />
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
  dates: { gap: space.sm, backgroundColor: color.bgMuted, borderRadius: radius.md, padding: space.md },
});
