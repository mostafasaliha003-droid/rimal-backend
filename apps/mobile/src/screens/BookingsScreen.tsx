import React, { useCallback, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../api';
import type { BookingHistoryItem } from '../api/bookings';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { Button, Field, MoneyText, Row, StatePanel, Txt } from '../components/Primitives';
import {
  buildTripsModel, filterTrips, formatTripDate, localTodayKey,
  type TripBucket, type TripFilter, type TripRow,
} from '../components/tripsModel';
import { tripsCopy } from './tripsCopy';

const buckets: TripBucket[] = ['current', 'upcoming', 'past', 'unknown'];
const filters: TripFilter[] = ['all', ...buckets];
const noBookings: readonly BookingHistoryItem[] = Object.freeze([]);
type HistoryResult = { key: string; bookings: BookingHistoryItem[]; error: boolean };
type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

function BookingCard({ row, today }: { row: TripRow; today: string }) {
  const { language } = useLanguage();
  const copy = tripsCopy(language);
  const booking = row.booking;
  const [expanded, setExpanded] = useState(false);
  const statusColor = row.statusKind === 'confirmed' ? colors.success
    : row.statusKind === 'failed' ? colors.red : colors.muted;

  return (
    <View style={[ui.card, { gap: 14 }]}>
      <Txt kind="heading" accessibilityRole="header">{booking.hotelName || copy.hotelUnknown}</Txt>
      <Txt kind="label" style={{ color: statusColor }}>{copy.statusLabel}: {copy.status[row.statusKind]}</Txt>
      <View style={{ backgroundColor: colors.background, borderRadius: 14, padding: 14, gap: 8 }}>
        <Row style={{ alignItems: 'flex-start' }}>
          {(['checkin', 'checkout'] as const).map(key => (
            <View key={key} style={{ flex: 1, gap: 4 }}>
              <Txt kind="small">{copy[key]}</Txt>
              <Txt kind="label">{formatTripDate(row.dates[key], language) || copy.dateUnknown}</Txt>
            </View>
          ))}
        </Row>
        {row.dates.nights !== null && <Txt kind="small">{copy.nights(row.dates.nights)}</Txt>}
        {row.bucket === 'current' && row.dates.checkout === today && (
          <Txt kind="label" style={{ color: colors.blueStrong }}>{copy.departureToday}</Txt>
        )}
        {row.bucket === 'current' && row.dates.checkin === today && (
          <Txt kind="label" style={{ color: colors.blueStrong }}>{copy.arrivalToday}</Txt>
        )}
        {row.dates.issue && (
          <Txt kind="small">{row.dates.issue === 'missing' ? copy.datesIncomplete : copy.datesInvalid}</Txt>
        )}
      </View>
      <View style={{ gap: 4 }}>
        <Txt kind="small">{copy.reference}</Txt>
        <Txt selectable style={{ writingDirection: 'ltr' }}>{booking.reference}</Txt>
      </View>
      {booking.roomName && <Txt kind="small">{copy.room}: {booking.roomName}</Txt>}
      {booking.price && (
        <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Txt kind="small">{copy.recordedAmount}</Txt>
          <MoneyText money={booking.price} />
        </Row>
      )}
      {(booking.recordedStatus || booking.supplierStatus) && (
        <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
            onPress={() => setExpanded(value => !value)}
            style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 10 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label">{copy.recordDetails}</Txt>
              <Txt accessible={false} style={{ color: colors.blueStrong }}>{expanded ? '−' : '+'}</Txt>
            </Row>
          </Pressable>
          {expanded && (
            <View style={{ gap: 6 }}>
              {booking.recordedStatus && <Txt kind="small">{copy.recordedStatus}: {booking.recordedStatus}</Txt>}
              {booking.supplierStatus && <Txt kind="small">{copy.supplierStatus}: {booking.supplierStatus}</Txt>}
            </View>
          )}
        </View>
      )}
    </View>
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
            <Pressable key={filter} accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected}
              onPress={() => setFilter(filter)}
              style={{ minHeight: 48, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1,
                borderColor: selected ? colors.navy : colors.border, backgroundColor: selected ? colors.navy : colors.surface,
                justifyContent: 'center' }}>
              <Txt style={{ fontFamily: fonts.medium, fontSize: 14, color: selected ? colors.surface : colors.navy }}>
                {copy.filters[filter]} ({model.counts[filter]})
              </Txt>
            </Pressable>
          );
        })}
      </Row>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: lookupOpen }} aria-expanded={lookupOpen}
        onPress={() => setLookupOpen(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="label" style={{ color: colors.blueStrong }}>{copy.findBooking}</Txt>
          <Txt accessible={false} style={{ color: colors.blueStrong }}>{lookupOpen ? '−' : '+'}</Txt>
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
      <BrandHeader /><EnvironmentBanner />
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
              <Button title={t('signIn')} onPress={() => router.navigate('/account')} />
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