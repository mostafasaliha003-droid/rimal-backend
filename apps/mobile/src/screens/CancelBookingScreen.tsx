import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../api';
import { ApiError } from '../api/errors';
import { bookingHotelName, type BookingHistoryItem } from '../api/bookings';
import { validReference, type CancellationOffer, type CancellationTracking } from '../api/cancellation';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import ApiState from '../components/ApiState';
import LivePaymentStatus from '../components/LivePaymentStatus';
import VoucherButton from '../components/VoucherButton';
import { Button, Card, Icon, InfoRow, Notice, Row, Skeleton, StatePanel, Txt } from '../components/Primitives';
import { cancellationPollDelay, cancellationTrackModel, refundCopy } from '../components/cancellationTrackModel';
import { formatPrice, formatStayRange, nightsBetween, stayWords } from '../components/format';
import { localizedRoomName } from '../components/roomNameModel';
import type { Money } from '../types';

type Loaded = { attempt: number; offer: CancellationOffer | null; booking: BookingHistoryItem | null; error: unknown };
const QUOTE_CODES = ['cancellation_penalty_changed', 'cancellation_quote_expired_or_changed', 'cancellation_quote_invalid'];
const clock = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const isZero = (money: Money) => Number(money.amount) === 0;

/*
 * Cancelling a booking inside the app. The traveler sees the exact fee and refund for cancelling
 * now (held for a few minutes), agrees once, and follows the cancellation with the hotel and the
 * refund live (to the card, or through Tabby for a Tabby payment). When the booking cannot be
 * cancelled automatically, the page says why and opens Mkhadda care in the app.
 */
export default function CancelBookingScreen() {
  const { reference: param } = useLocalSearchParams<{ reference?: string }>();
  const reference = typeof param === 'string' && validReference(param) ? param : '';
  const { status, sessionRevision } = useAuth();
  return <CancelContents key={`${reference}:${status}:${sessionRevision}`} reference={reference} signedIn={status === 'signedIn'} loading={status === 'loading'}/>;
}

function CancelContents({ reference, signedIn, loading }: { reference: string; signedIn: boolean; loading: boolean }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tracking, setTracking] = useState<CancellationTracking | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<'changed' | 'failed' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // When live tracking started (set as tracking begins), so polling can slow down over time.
  const trackStart = useRef(0);

  // The booking and the current cancellation terms, read together.
  useFocusEffect(useCallback(() => {
    if (!signedIn || !reference) return;
    const controller = new AbortController();
    Promise.all([api.cancellation.offer(reference, controller.signal), api.getBookings(controller.signal).catch(() => [] as BookingHistoryItem[])])
      .then(([offer, bookings]) => {
        if (controller.signal.aborted) return;
        setLoaded({ attempt, offer, booking: bookings.find(item => item.reference === reference) ?? null, error: null });
        if (offer.mode === 'tracking') { trackStart.current = Date.now(); setTracking(offer.tracking); }
      }).catch(error => { if (!controller.signal.aborted) setLoaded({ attempt, offer: null, booking: null, error }); });
    return () => controller.abort();
  }, [signedIn, reference, attempt]));

  const current = loaded?.attempt === attempt ? loaded : null;
  const offer = current?.offer ?? null;
  const booking = current?.booking ?? loaded?.booking ?? null;

  // The hotel is still reading its terms: ask again shortly.
  const checkingDelay = offer?.mode === 'checking' ? offer.retryAfterMs : null;
  useEffect(() => {
    if (checkingDelay === null) return;
    const timer = setTimeout(() => setAttempt(value => value + 1), checkingDelay);
    return () => clearTimeout(timer);
  }, [checkingDelay]);

  // The quoted fee and refund are held until expiresAt; the countdown says how long.
  const expiresAt = offer?.mode === 'automatic' ? offer.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null || tracking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, tracking]);

  // Live tracking: the hotel's confirmation, then the refund.
  useEffect(() => {
    if (!tracking) return;
    const delay = cancellationPollDelay(tracking, Date.now() - trackStart.current);
    if (delay === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (AppState.currentState !== 'active' && AppState.currentState !== undefined) return;
      api.cancellation.status(reference, controller.signal).then(next => { if (!controller.signal.aborted) setTracking(next); }).catch(() => undefined);
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tracking, reference]);

  const confirm = async () => {
    if (offer?.mode !== 'automatic' || confirming) return;
    setConfirming(true); setNotice(null);
    try {
      const next = await api.cancellation.confirm(reference, offer.quoteToken);
      trackStart.current = Date.now();
      setTracking(next);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      setNotice(QUOTE_CODES.includes(code) ? 'changed' : 'failed');
      setAgreed(false);
      setAttempt(value => value + 1);
    } finally { setConfirming(false); }
  };
  const refundTo = offer && offer.mode !== 'checking' ? offer.refundTo : 'card';
  const refund = refundCopy(refundTo, language);
  // Help about this booking opens its conversation with the team, already linked to the booking.
  const care = (topic: 'cancellation' | 'refund') => router.push({ pathname: '/care/[reference]', params: { reference, topic } });

  const nights = booking?.checkin && booking.checkout ? nightsBetween(booking.checkin, booking.checkout) : null;
  const summary = booking && <Card testID="cancel-booking-summary" style={styles.card}>
    <Txt kind="bodyStrong" numberOfLines={2} style={{ fontFamily: fonts.bold }}>{bookingHotelName(booking, language) || (ar ? 'حجزك' : 'Your booking')}</Txt>
    {booking.checkin && booking.checkout && <InfoRow icon="calendar"><Txt kind="small" tone="primary">
      {[formatStayRange(booking.checkin, booking.checkout, language), nights ? stayWords(language).nights(nights) : ''].filter(Boolean).join(' · ')}</Txt></InfoRow>}
    {booking.roomName && <InfoRow icon="bed"><Txt kind="small" tone="primary">{localizedRoomName(booking.roomName, language)}</Txt></InfoRow>}
    {/* The long reference shrinks (middle ellipsis) so the amount always stays whole on narrow phones. */}
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: space.md }}>
      <Txt selectable kind="caption" numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={(ar ? 'مرجع الحجز: ' : 'Booking reference: ') + reference}
        style={{ writingDirection: 'ltr', flex: 1, minWidth: 0 }}>{reference}</Txt>
      {booking.price && <Txt kind="label" tone="primary" style={{ writingDirection: 'ltr', flexShrink: 0 }}>{formatPrice(booking.price)}</Txt>}
    </Row>
  </Card>;

  const title = <Txt kind="heading" accessibilityRole="header">{tracking ? (ar ? 'حالة الإلغاء' : 'Cancellation status') : (ar ? 'إلغاء الحجز' : 'Cancel booking')}</Txt>;
  let body: React.ReactNode;
  if (!reference) body = <StatePanel icon="alertCircle" title={ar ? 'لم نجد هذا الحجز' : 'Booking not found'} />;
  else if (loading) body = <StatePanel title={ar ? 'جارٍ التحقق من الحساب' : 'Checking your account'} busy/>;
  else if (!signedIn) body = <StatePanel icon="account" title={ar ? 'سجّل الدخول لإدارة حجزك' : 'Sign in to manage your booking'}
    body={ar ? 'نتحقق من ملكية الحجز قبل عرض شروط الإلغاء.' : 'We confirm the booking is yours before showing its cancellation terms.'}>
    <Button title={ar ? 'تسجيل الدخول' : 'Sign in'} onPress={() => router.navigate({ pathname: '/account', params: { returnTo: '/bookings' } })}/></StatePanel>;
  else if (tracking) {
    const refundLive = tracking.state === 'cancelled' && (tracking.refundStatus === 'pending' || tracking.refundStatus === 'not_processed');
    body = <LivePaymentStatus testID="cancel-live-status" key={tracking.state + tracking.refundStatus} reference={tracking.cancellationReference || reference}
      referenceLabel={ar ? 'مرجع الإلغاء' : 'Cancellation reference'} live={tracking.pending || refundLive}
      describe={elapsed => cancellationTrackModel(tracking, language, elapsed, refundTo)}
      doneText={tracking.refundStatus === 'not_due' ? (ar ? 'اكتمل الإلغاء وفق شروط الحجز' : 'Cancelled under the booking terms') : (ar ? 'اكتملت كل الخطوات: الإلغاء مع الفندق ورد المبلغ' : 'All steps complete: hotel cancellation and refund')}>
      {(tracking.refund || tracking.fee) && <View style={styles.amounts}>
        {tracking.refund && <Row style={styles.amountRow}><Txt kind="small" tone="primary">{refundTo === 'tabby' ? refund.label : ar ? 'المبلغ المسترد' : 'Refund'}</Txt>
          <Txt testID="cancel-refund" kind="subheading" style={{ writingDirection: 'ltr', color: color.success }}>{formatPrice(tracking.refund)}</Txt></Row>}
        {tracking.fee && <Row style={styles.amountRow}><Txt kind="small" tone="primary">{ar ? 'رسوم الإلغاء' : 'Cancellation fee'}</Txt>
          <Txt kind="label" tone="primary" style={{ writingDirection: 'ltr' }}>{isZero(tracking.fee) ? (ar ? 'مجاني' : 'Free') : formatPrice(tracking.fee)}</Txt></Row>}
      </View>}
      {tracking.state === 'cancelled' && booking && <VoucherButton kind="cancellation" booking={booking}/>}
      <Button variant={tracking.pending || refundLive ? 'secondary' : 'primary'} icon="trips" title={ar ? 'العودة إلى رحلاتي' : 'Back to My trips'} onPress={() => router.navigate('/bookings')}/>
      {(tracking.state === 'cancel_failed' || tracking.refundStatus === 'review') && <Button testID="cancel-track-care" variant="quiet" icon="chat"
        title={ar ? 'تحدّث مع فريق مخدة' : 'Talk to the Mkhadda team'} onPress={() => care(tracking.state === 'cancel_failed' ? 'cancellation' : 'refund')}/>}
    </LivePaymentStatus>;
  } else if (current?.error) body = <ApiState error={current.error} retry={() => setAttempt(value => value + 1)}/>;
  else if (!offer || offer.mode === 'checking') body = <Card style={styles.card} accessibilityLabel={ar ? 'نقرأ شروط الإلغاء' : 'Reading the cancellation terms'}>
    <Row style={{ gap: space.sm }}><Icon name="hourglass" size={18} color={color.interactive}/>
      <Txt kind="small" tone="primary" accessibilityLiveRegion="polite" style={{ flex: 1 }}>{ar ? 'نقرأ شروط الإلغاء الحالية من الفندق…' : 'Reading the hotel’s current cancellation terms…'}</Txt></Row>
    <Skeleton height={56} rounded={radius.md}/><Skeleton width="70%" height={16}/><Skeleton height={48} rounded={radius.md}/>
  </Card>;
  else if (offer.mode === 'automatic') {
    const remaining = offer.expiresAt - now, expired = remaining <= 0;
    const free = isZero(offer.fee), nothingBack = isZero(offer.refund);
    const tone = free ? 'success' : nothingBack ? 'danger' : 'warning';
    const headline = free ? (ar ? 'إلغاء مجاني الآن' : 'Free cancellation right now')
      : nothingBack ? (ar ? 'لا يُسترد أي مبلغ عند الإلغاء الآن' : 'No refund if you cancel now')
        : (ar ? 'يُخصم رسم إلغاء ويُسترد الباقي' : 'A cancellation fee applies; the rest is refunded');
    body = <>
      {notice === 'changed' && <Notice tone="warning" live title={ar ? 'تغيّرت شروط الإلغاء' : 'The cancellation terms changed'}
        body={ar ? 'حدّثنا الأرقام أدناه حسب الشروط الحالية للفندق. راجعها قبل التأكيد.' : 'We updated the amounts below to the hotel’s current terms. Review them before confirming.'}/>}
      {notice === 'failed' && <Notice testID="cancel-failed" tone="danger" live title={ar ? 'لم يتم الإلغاء' : 'Not cancelled'}
        body={ar ? 'لم يكتمل الطلب وحجزك ما زال قائماً كما هو. حاول مجدداً، أو اكتب لفريقنا وسيتابع الإلغاء معك.' : 'The request did not complete and your booking stands as it is. Try again, or message our team and they will follow it up with you.'}
        action={{ label: ar ? 'اكتب لفريق مخدة' : 'Message the Mkhadda team', onPress: () => care('cancellation') }}/>}
      <Card testID="cancel-decision" style={styles.card}>
        <Notice tone={tone} title={headline}/>
        <View style={styles.amounts}>
          <Row style={styles.amountRow}><Txt kind="small" tone="primary">{ar ? 'رسوم الإلغاء' : 'Cancellation fee'}</Txt>
            <Txt testID="cancel-quote-fee" kind="label" tone="primary" style={{ writingDirection: 'ltr' }}>{free ? (ar ? 'مجاني' : 'Free') : formatPrice(offer.fee)}</Txt></Row>
          <Row style={styles.amountRow}><Txt kind="small" tone="primary" style={{ flex: 1 }}>{refund.label}</Txt>
            <Txt testID="cancel-quote-refund" kind="subheading" style={{ writingDirection: 'ltr', color: nothingBack ? color.danger : color.success }}>{formatPrice(offer.refund)}</Txt></Row>
        </View>
        {!nothingBack && <InfoRow icon={refundTo === 'tabby' ? 'wallet' : 'clock'}><Txt testID="cancel-refund-note" kind="small" tone="primary">{refund.note}</Txt></InfoRow>}
        {!!offer.policy && <InfoRow icon="info"><Txt kind="caption">{offer.policy}</Txt></InfoRow>}
        <Row testID="cancel-quote-timer" style={[styles.timer, expired && { backgroundColor: color.warningBg }]}>
          <Icon name={expired ? 'alert' : 'lock'} size={15} color={expired ? color.warning : color.textSecondary}/>
          <Txt kind="caption" tone={expired ? 'warning' : 'secondary'} style={{ flex: 1 }} accessibilityLiveRegion={expired ? 'polite' : undefined}>
            {expired ? (ar ? 'انتهت مدة حجز هذه الأرقام. حدّث الشروط لعرض الأرقام الحالية.' : 'These amounts are no longer held. Refresh to see the current ones.')
              : (ar ? `هذه الأرقام محجوزة لك لمدة ${clock(remaining)}` : `These amounts are held for you for ${clock(remaining)}`)}</Txt>
        </Row>
        {expired ? <Button testID="cancel-refresh" variant="secondary" icon="refresh" title={ar ? 'تحديث الشروط' : 'Refresh terms'} onPress={() => { setAgreed(false); setAttempt(value => value + 1); }}/> : <>
          <Pressable testID="cancel-agree" accessibilityRole="checkbox" aria-checked={agreed} accessibilityState={{ checked: agreed }} onPress={() => setAgreed(value => !value)}
            style={[styles.agree, agreed && { backgroundColor: color.bgSelected }]}>
            <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
              <View style={[styles.box, agreed && styles.boxOn]}>{agreed && <Icon name="check" size={13} strokeWidth={3} color={color.onInteractive}/>}</View>
              <Txt kind="small" tone="primary" style={{ flex: 1 }}>{ar ? 'أفهم أن الإلغاء نهائي ولا يمكن التراجع عنه بعد التأكيد.' : 'I understand the cancellation is final once confirmed.'}</Txt>
            </Row>
          </Pressable>
          <Button testID="cancel-confirm" variant="danger" icon="close" busy={confirming} disabled={!agreed || confirming}
            title={ar ? 'تأكيد إلغاء الحجز' : 'Confirm cancellation'} onPress={() => void confirm()}/>
        </>}
        <Button variant="quiet" title={ar ? 'الإبقاء على الحجز' : 'Keep my booking'} onPress={() => router.back()}/>
      </Card>
    </>;
  } else if (offer.mode === 'support') {
    // Support: this booking cannot be cancelled automatically from the app.
    body = <Card testID="cancel-support" style={styles.card}>
      <Notice tone="info" title={ar ? 'يتم إلغاء هذا الحجز عبر فريق الدعم' : 'This booking is cancelled through our support team'}
        body={offer.upsells ? (ar ? 'يتضمن الحجز خدمات إضافية تحتاج إلغاءً يدوياً.' : 'The booking includes extras that need a manual cancellation.')
          : (ar ? 'لا يمكن إلغاؤه من التطبيق مباشرة الآن. اكتب لفريقنا من هنا وسيتابع الإلغاء والاسترداد معك.' : 'It cannot be cancelled in the app right now. Message our team here and they will handle the cancellation and refund with you.')}/>
      {offer.penalty && <Row style={styles.amountRow}><Txt kind="small" tone="primary">{ar ? 'رسوم الإلغاء الحالية لدى الفندق' : 'Hotel’s current cancellation fee'}</Txt>
        <Txt kind="label" tone="primary" style={{ writingDirection: 'ltr' }}>{isZero(offer.penalty) ? (ar ? 'مجاني' : 'Free') : formatPrice(offer.penalty)}</Txt></Row>}
      {!!offer.policy && <InfoRow icon="info"><Txt kind="caption">{offer.policy}</Txt></InfoRow>}
      <Button testID="cancel-support-contact" icon="chat" title={ar ? 'اطلب الإلغاء من فريق مخدة' : 'Ask the Mkhadda team to cancel'} onPress={() => care('cancellation')}/>
    </Card>;
  }

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView contentContainerStyle={[ui.page, { gap: space.md }]}>
      {title}
      {summary}
      {body}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg },
  amounts: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: color.bgSubtle },
  amountRow: { justifyContent: 'space-between', alignItems: 'baseline', gap: space.md },
  timer: { gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.sm, backgroundColor: color.bgSubtle },
  agree: { padding: space.md, borderRadius: radius.md, backgroundColor: color.bgField },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSurface, marginTop: 2 },
  boxOn: { backgroundColor: color.interactive, borderColor: color.interactive },
});
