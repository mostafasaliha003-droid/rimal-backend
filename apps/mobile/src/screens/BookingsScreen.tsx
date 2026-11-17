import React, { useEffect, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../api';
import type { BookingHistoryItem, BookingHistoryStatus } from '../api/bookings';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { Button, MoneyText, StatePanel, Txt } from '../components/Primitives';

const statusKeys: Record<BookingHistoryStatus, 'bookingsConfirmed' | 'bookingsCancelled' | 'bookingsPending' | 'bookingsFailed' | 'bookingsUnknownStatus'> = {
  confirmed: 'bookingsConfirmed', cancelled: 'bookingsCancelled', pending: 'bookingsPending',
  failed: 'bookingsFailed', unknown: 'bookingsUnknownStatus',
};

function BookingCard({ booking }: { booking: BookingHistoryItem }) {
  const { t } = useLanguage();
  const statusColor = booking.statusKind === 'confirmed' ? colors.success
    : booking.statusKind === 'failed' ? colors.red : colors.muted;
  return <View style={ui.card}>
    <Txt kind="heading" accessibilityRole="header">{booking.hotelName || t('bookingsHotelUnknown')}</Txt>
    {booking.roomName && <Txt kind="small">{booking.roomName}</Txt>}
    <Txt kind="label" style={{ color: statusColor }}>{t(statusKeys[booking.statusKind])}</Txt>
    <View style={{ gap: 4 }}><Txt kind="small">{t('bookingsReference')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{booking.reference}</Txt></View>
    {(booking.checkin || booking.checkout) && <View style={{ gap: 4 }}><Txt kind="small">{t('bookingsDates')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{booking.checkin || t('bookingsUnknown')} → {booking.checkout || t('bookingsUnknown')}</Txt></View>}
    {booking.recordedStatus && <Txt kind="small">{t('bookingsStatus')}: {booking.recordedStatus}</Txt>}
    {booking.supplierStatus && <Txt kind="small">{t('bookingsSupplierStatus')}: {booking.supplierStatus}</Txt>}
    {booking.price && <View style={{ gap: 4 }}><Txt kind="small">{t('bookingsPrice')}</Txt><MoneyText money={booking.price}/></View>}
  </View>;
}

export default function BookingsScreen() {
  const { status, user, sessionRevision } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; bookings: BookingHistoryItem[]; error: boolean }>({ key: '', bookings: [], error: false });
  const signedIn = status === 'signedIn' && Boolean(user);
  const requestKey = `${status}:${sessionRevision}:${retry}`;
  // This render-time gate hides an old owner's rows before effect cleanup runs,
  // including while restoration/login is loading and even for the same email.
  const current = signedIn && result.key === requestKey ? result : null;
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    api.getBookings(controller.signal).then(bookings => {
      if (!controller.signal.aborted) setResult({ key: requestKey, bookings, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key: requestKey, bookings: [], error: true });
    });
    return () => controller.abort();
  }, [signedIn, requestKey]);

  const heading = <View style={{ gap: 10 }}><Txt kind="title" accessibilityRole="header">{t('bookingsTitle')}</Txt><Txt style={{ color: colors.muted }}>{t('bookingsBody')}</Txt><Txt kind="small">{t('bookingsReadOnly')}</Txt></View>;
  const refresh = () => setRetry(value => value + 1);
  const footer = <Button variant="secondary" title={t('support')} onPress={() => router.push('/support')}/>;
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/><EnvironmentBanner/>
    {signedIn && current && !current.error && current.bookings.length > 0
      ? <FlatList data={current.bookings} keyExtractor={booking => booking.reference} renderItem={({ item }) => <BookingCard booking={item}/>}
        contentContainerStyle={ui.page} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
        ListHeaderComponent={<View style={{ gap: 18 }}>{heading}<Button variant="secondary" title={t('bookingsRefresh')} onPress={refresh}/></View>}
        ListFooterComponent={footer}/>
      : <ScrollView contentContainerStyle={ui.page}>{heading}
        {status === 'loading' || signedIn && !current ? <StatePanel title={t('loading')} busy/>
          : !signedIn ? <><StatePanel title={t('bookingsSignIn')}/><Button title={t('signIn')} onPress={() => router.push('/account')}/></>
            : current?.error ? <StatePanel title={t('bookingsError')} retry={refresh}/>
              : <><StatePanel title={t('bookingsEmpty')}/><Button variant="secondary" title={t('bookingsRefresh')} onPress={refresh}/></>}
        {footer}
      </ScrollView>}
  </SafeAreaView>;
}
