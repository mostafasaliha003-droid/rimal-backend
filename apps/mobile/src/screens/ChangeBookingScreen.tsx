import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { api } from '../api';
import type { BookingHistoryItem } from '../api/bookings';
import { validReference, type CancellationOffer } from '../api/cancellation';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { Badge, Card, Icon, InfoRow, Row, Skeleton, StatePanel, Txt, type IconName } from '../components/Primitives';
import { formatPrice, formatStayRange, nightsBetween, stayWords } from '../components/format';
import { localizedRoomName } from '../components/roomNameModel';
import { changeCopy, changeTerms } from '../components/changeModel';

type Loaded = { booking: BookingHistoryItem | null; offer: CancellationOffer | null };

/*
 * Changing a booking, honestly. Hotels (through our supplier) do not edit a confirmed booking:
 * new dates or a new room are a new booking, then the old one is cancelled under its own terms.
 * Names and special requests go to the team, who ask the hotel. The page says which applies
 * and what it costs right now, so nobody loses a room or pays a fee by surprise.
 */
export default function ChangeBookingScreen() {
  const { reference: param } = useLocalSearchParams<{ reference?: string }>();
  const reference = typeof param === 'string' && validReference(param) ? param : '';
  const { status, sessionRevision } = useAuth();
  return <ChangeContents key={`${reference}:${status}:${sessionRevision}`} reference={reference} signedIn={status === 'signedIn'}/>;
}

/** Two calendars joined by an arrow: the stay moving to new dates, in the reading direction. */
function MoveMark({ rtl }: { rtl: boolean }) {
  return <Svg width={76} height={40} viewBox="0 0 76 40" accessible={false} style={rtl ? { transform: [{ scaleX: -1 }] } : undefined}>
    <Rect x={2} y={6} width={24} height={26} rx={5} fill="#F3EBFD" stroke="#654288" strokeWidth={2}/>
    <Path d="M2 13h24M9 3v6M19 3v6" stroke="#654288" strokeWidth={2} strokeLinecap="round"/>
    <Circle cx={14} cy={22} r={3.2} fill="#654288" opacity={0.45}/>
    <Path d="M31 19h12" stroke="#2D173A" strokeWidth={2} strokeLinecap="round" strokeDasharray="1 4"/>
    <Path d="M41 14.5l4.5 4.5-4.5 4.5" fill="none" stroke="#2D173A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
    <Rect x={50} y={6} width={24} height={26} rx={5} fill="#FCEEE4" stroke="#774324" strokeWidth={2}/>
    <Path d="M50 13h24M57 3v6M67 3v6" stroke="#774324" strokeWidth={2} strokeLinecap="round"/>
    <Path d="M57.5 22.5l3.2 3.2 6-6.4" fill="none" stroke="#774324" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}

function Choice({ icon, title, body, cta, onPress, testID, children, accent = false }: {
  icon: IconName; title: string; body: string; cta: string; onPress: () => void; testID: string; children?: React.ReactNode; accent?: boolean;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title}. ${cta}`} onPress={onPress}
    style={state => [styles.choice, accent && styles.choiceAccent, state.pressed && { backgroundColor: color.bgSelected }]}>
    <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
      <View style={[styles.iconBox, accent && { backgroundColor: color.bgAccent }]}><Icon name={icon} size={20} color={accent ? color.accent : color.interactiveStrong}/></View>
      <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
        <Txt kind="bodyStrong" style={{ fontFamily: fonts.bold }}>{title}</Txt>
        <Txt kind="small">{body}</Txt>
        {children}
        <Row style={{ gap: space.xxs, marginTop: space.xxs }}>
          <Txt kind="label" tone="link">{cta}</Txt>
          <Icon name="chevron" size={14} color={color.textLink}/>
        </Row>
      </View>
    </Row>
  </Pressable>;
}

function ChangeContents({ reference, signedIn }: { reference: string; signedIn: boolean }) {
  const { language, rtl } = useLanguage();
  const ar = language === 'ar';
  const copy = changeCopy(language);
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // The booking, and what cancelling it would cost right now (the second half of a date change).
  useFocusEffect(useCallback(() => {
    if (!signedIn || !reference) return;
    const controller = new AbortController();
    Promise.all([api.getBookings(controller.signal).catch(() => [] as BookingHistoryItem[]),
      api.cancellation.offer(reference, controller.signal).catch(() => null)])
      .then(([bookings, offer]) => { if (!controller.signal.aborted) setLoaded({ booking: bookings.find(item => item.reference === reference) ?? null, offer }); });
    return () => controller.abort();
  }, [signedIn, reference]));

  if (!reference) return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    <View style={ui.page}><StatePanel icon="alertCircle" title={ar ? 'لم نجد هذا الحجز' : 'Booking not found'}/></View></SafeAreaView>;

  const booking = loaded?.booking ?? null;
  const terms = loaded ? changeTerms(loaded.offer, language) : null;
  const care = (draft: string) => router.push({ pathname: '/care/[reference]', params: { reference, topic: 'change', draft } });
  const nights = booking?.checkin && booking.checkout ? nightsBetween(booking.checkin, booking.checkout) : null;
  // The hotel's own name finds the same hotel for the new dates.
  const searchAgain = () => router.navigate({ pathname: '/', params: { q: booking?.hotelName || '' } });

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView contentContainerStyle={[ui.page, { gap: space.md }]}>
      <View style={{ gap: space.xs }}>
        <Txt kind="heading" accessibilityRole="header">{copy.title}</Txt>
        <Txt kind="small">{copy.lead}</Txt>
      </View>

      {booking ? <Card testID="change-summary" style={styles.card}>
        <Txt kind="bodyStrong" numberOfLines={2} style={{ fontFamily: fonts.bold }}>{booking.hotelName || (ar ? 'حجزك' : 'Your booking')}</Txt>
        {booking.checkin && booking.checkout && <InfoRow icon="calendar"><Txt kind="small" tone="primary">
          {[formatStayRange(booking.checkin, booking.checkout, language), nights ? stayWords(language).nights(nights) : ''].filter(Boolean).join(' · ')}</Txt></InfoRow>}
        {booking.roomName && <InfoRow icon="bed"><Txt kind="small" tone="primary">{localizedRoomName(booking.roomName, language)}</Txt></InfoRow>}
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: space.md }}>
          <Txt selectable kind="caption" numberOfLines={1} ellipsizeMode="middle" style={{ writingDirection: 'ltr', flex: 1, minWidth: 0 }}>{reference}</Txt>
          {booking.price && <Txt kind="label" tone="primary" style={{ writingDirection: 'ltr', flexShrink: 0 }}>{formatPrice(booking.price)}</Txt>}
        </Row>
      </Card> : !loaded && signedIn ? <Skeleton height={112} rounded={radius.lg}/> : null}

      <Choice testID="change-dates" icon="calendar" title={copy.dates.title} body={copy.dates.body} cta={copy.dates.cta} onPress={searchAgain}>
        <View style={styles.steps}>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <MoveMark rtl={rtl}/>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              {copy.dates.steps.map((step, index) => <Row key={step} style={{ gap: space.sm, alignItems: 'flex-start' }}>
                <View style={styles.stepDot}><Txt kind="micro" tone="onDark" style={{ fontFamily: fonts.bold }}>{index + 1}</Txt></View>
                <Txt kind="small" tone="primary" style={{ flex: 1 }}>{step}</Txt>
              </Row>)}
            </View>
          </Row>
          {terms ? <Row testID="change-terms" style={[styles.terms, { backgroundColor: terms.tone === 'success' ? color.successBg : terms.tone === 'warning' ? color.warningBg : color.bgSubtle }]}>
            <Icon name={terms.tone === 'success' ? 'checkCircle' : terms.tone === 'warning' ? 'alert' : 'info'} size={15}
              color={terms.tone === 'success' ? color.success : terms.tone === 'warning' ? color.warning : color.textSecondary}/>
            <Txt kind="caption" tone="primary" style={{ flex: 1 }}>{terms.text}</Txt>
          </Row> : signedIn ? <Skeleton height={36} rounded={radius.sm}/> : null}
        </View>
      </Choice>

      {terms?.canCancel && <Pressable testID="change-cancel-old" accessibilityRole="button" onPress={() => router.push({ pathname: '/cancel/[reference]', params: { reference } })}
        style={styles.secondaryLink}>
        <Row style={{ gap: space.xs, justifyContent: 'center' }}>
          <Icon name="close" size={14} color={color.textLink}/>
          <Txt kind="label" tone="link">{copy.dates.cancelOld}</Txt>
        </Row>
      </Pressable>}

      <Choice testID="change-details" icon="userPen" title={copy.details.title} body={copy.details.body} cta={copy.details.cta}
        onPress={() => care(copy.details.draft)} accent>
        <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
          {copy.details.examples.map(item => <Badge key={item} tone="accent" label={item}/>)}
        </Row>
      </Choice>

      <Choice testID="change-other" icon="chat" title={copy.other.title} body={copy.other.body} cta={copy.other.cta} onPress={() => care('')}/>

      <Row style={{ gap: space.sm, alignItems: 'flex-start', paddingHorizontal: space.xs }}>
        <View style={{ paddingTop: 2 }}><Icon name="info" size={14} color={color.textSecondary}/></View>
        <Txt kind="caption" style={{ flex: 1 }}>{copy.footnote}</Txt>
      </Row>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg },
  choice: { padding: space.md, borderRadius: radius.lg, backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard },
  choiceAccent: { borderColor: color.accentBorder },
  iconBox: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.bgSelected, alignItems: 'center', justifyContent: 'center' },
  steps: { gap: space.sm, marginTop: space.xs, padding: space.sm, borderRadius: radius.md, backgroundColor: color.bgMuted },
  stepDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: color.actionPrimary, marginTop: 1 },
  terms: { gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.sm },
  secondaryLink: { minHeight: 44, justifyContent: 'center', marginTop: -space.xs },
});
