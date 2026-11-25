import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreventRemove, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, APP_ENV, authSession, bookingWebsiteUrl, websiteUrl } from '../api';
import { NATIVE_CHECKOUT_ENABLED, paymentReturnUrl } from '../api/config';
import type { CheckoutGuestData, CheckoutPaymentMethod, CheckoutStatus } from '../api/checkout';
import { paymentChoiceCopy, tabbyInstallment, tabbyMessage, tabbyName, tabbyOutcome, type TabbyRejection } from '../components/tabbyModel';
import { TabbyMark, TabbySchedule } from '../components/TabbyPromo';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import type { GuestRoom, Money, RoomOffer } from '../types';
import { color, colors, fonts, localizedFont, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useAppState } from '../components/AppState';
import { useCheckoutSession } from '../components/useCheckoutSession';
import type { CheckoutQuoteView, CheckoutSelection } from '../components/checkoutSessionModel';
import { carryFamilyName, createTravelerDraft, validateTravelerDraft, type TravelerError } from '../components/checkoutTravelerModel';
import { ActionBar, Badge, Button, Card, DisclosureMark, Divider, Field, Icon, InfoRow, Notice, Row, Sheet, StatePanel, TextLink, Txt } from '../components/Primitives';
import Taxes from '../components/Taxes';
import Cancellation from '../components/Cancellation';
import { useChargeCurrency, useChargeMoney } from '../components/ChargeCurrency';
import { mealDescription, rateCopy, roomRateFacts } from '../components/roomRateFacts';
import { useCancellationClock } from '../components/useCancellationClock';
import { formatPrice, formatStayRange, guestLine, nightsBetween, stayWords } from '../components/format';
import { useLayout } from '../components/motion';
import LivePaymentStatus from '../components/LivePaymentStatus';
import { LIVE_STATUSES, livePollDelay } from '../components/livePaymentModel';
import { checkoutCopy } from './checkoutCopy';
import { localizedRoomName } from '../components/roomNameModel';
import VoucherButton from '../components/VoucherButton';
import StayReceipt, { type StayReceiptData } from '../components/StayReceipt';
import type { BookingHistoryItem } from '../api/bookings';
import { matchOfferForNationality, samePrice } from '../components/nationalityRepriceModel';
import { contextExpiry, REVIEW_CHECK_LIFETIME_MS } from '../components/offerReviewModel';
import CountryPicker, { countryName } from '../components/CountryPicker';

const nativeCreationPolicy = () => NATIVE_CHECKOUT_ENABLED && Platform.OS !== 'web';
// Traveler details typed but not yet submitted, kept in memory only (never stored on the device),
// so an accidental back gesture does not erase them. Cleared after submission or a finished booking.
type TravelerDraft = NonNullable<ReturnType<typeof createTravelerDraft>>;
const travelerDrafts = new Map<string, TravelerDraft>();
// Details typed before a nationality change, carried to the re-priced offer for the same guests.
const carriedTraveler = new Map<'latest', { occupancy: string; draft: TravelerDraft }>();
// The nationality the guest chose, so the re-priced form opens with it already selected.
const chosenNationality = new Map<'latest', string>();
export type NationalityCheck = { status: 'checking' | 'same' | 'changed' | 'unavailable' | 'error'; residency: string; from?: Money | null; to?: Money | null };
function takeCarriedTraveler(occupancy: GuestRoom[]): TravelerDraft | null {
  const carried = carriedTraveler.get('latest'); carriedTraveler.delete('latest');
  return carried && carried.occupancy === JSON.stringify(occupancy) ? carried.draft : null;
}
export type CheckoutController = ReturnType<typeof useCheckoutSession>;

export default function CheckoutScreen() {
  const state = useAppState(), router = useRouter(), { language } = useLanguage();
  const { status, sessionRevision } = useAuth();
  const payCurrency = useChargeCurrency().selected;
  // The locked price and the Ziina payment use the currency the guest chose, read at
  // call time so the session keeps one stable getter.
  const payCurrencyRef = useRef(payCurrency);
  useEffect(() => { payCurrencyRef.current = payCurrency; }, [payCurrency]);
  // Card and wallets (Ziina) or Tabby pay-in-4. Tabby always charges AED, so choosing it locks the price in AED.
  const [method, setMethod] = useState<CheckoutPaymentMethod>('card');
  const methodRef = useRef<CheckoutPaymentMethod>('card');
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);
  const getCheckoutReview = state.getCheckoutReview;
  const getReview = useCallback(() => {
    const selection = getCheckoutReview();
    return selection && { ...selection, review: { ...selection.review, paymentCurrency: methodRef.current === 'tabby' ? 'AED' : payCurrencyRef.current,
      paymentMethod: methodRef.current, paymentLanguage: languageRef.current === 'en' ? 'en' as const : 'ar' as const } };
  }, [getCheckoutReview]);
  const session = useCheckoutSession({ getReview, canCreate: nativeCreationPolicy });
  const tabbyOffered = session.availability?.tabby === true;
  const effectiveMethod: CheckoutPaymentMethod = tabbyOffered ? method : 'card';
  const sessionSync = session.sync;
  // A different method or currency drops the old price lock; a new one is requested at once.
  useEffect(() => { methodRef.current = effectiveMethod; sessionSync(); }, [effectiveMethod, payCurrency, sessionSync]);
  // Ask before leaving while traveler details are typed but no booking was created yet
  // (an Android back gesture used to drop the form without warning).
  const [dirty, setDirty] = useState(false);
  const started = session.attempt !== null || session.hasRecovery;
  const allowLeave = usePreventRemove(dirty && !started, ({ repeat }) => {
    const ar = language === 'ar';
    Alert.alert(ar ? 'هل تريد ترك الحجز؟' : 'Leave this booking?',
      ar ? 'سنحتفظ ببيانات الضيوف التي أدخلتها إن عدت إلى هذا الحجز، لكن السعر المثبّت قد تنتهي صلاحيته.' : 'The traveler details you entered stay here if you come back to this booking, but the locked price may expire.',
      [{ text: ar ? 'متابعة الحجز' : 'Keep booking', style: 'cancel' },
        { text: ar ? 'مغادرة' : 'Leave', style: 'destructive', onPress: () => { setDirty(false); repeat(); } }]);
  });
  const freshOffer = () => {
    setDirty(false); allowLeave();
    const draft = state.getReviewDraft();
    if (draft) router.replace({ pathname: '/hotel/[hid]', params: { hid: String(draft.hid) } });
    else router.replace('/');
  };
  const openWebsite = async () => {
    const current = state.getCheckoutReview();
    const currentAuth = authSession.getSnapshot().status;
    if (!current || currentAuth === 'loading' || currentAuth === 'signedIn' && !session.canOpenWebsite()) return false;
    try { await WebBrowser.openBrowserAsync(bookingWebsiteUrl(current.review.hid, current.review.criteria, language, APP_ENV, payCurrency), { toolbarColor: colors.navy }); return true; }
    catch { return false; }
  };
  const openPayment = async () => {
    // Reconcile first. Browser return/dismissal is never payment evidence.
    await session.recover();
    const url = session.getPaymentHandoff();
    if (!url) return false;
    // Ziina returns app-started payments to this app address, which closes the
    // browser. The return is not evidence either way: the status check decides.
    try { await WebBrowser.openAuthSessionAsync(url, paymentReturnUrl(APP_ENV), { toolbarColor: colors.navy }); }
    catch { return false; }
    await session.refreshStatus(); return true;
  };
  // RateHawk prices each rate for the guest's nationality, and a rate is booked with the nationality
  // it was searched for. A different nationality is searched again in the background; the same
  // room at the same price continues silently, a different price is shown before payment.
  const [nationalityCheck, setNationalityCheck] = useState<NationalityCheck | null>(null);
  const repriceNationality = async (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => {
    const current = state.getCheckoutReview(); if (!current) { setNationalityCheck({ status: 'error', residency }); return; }
    carriedTraveler.set('latest', { occupancy: JSON.stringify(occupancy), draft }); chosenNationality.set('latest', residency);
    setNationalityCheck({ status: 'checking', residency });
    const { hid, hotelName, offer } = current.review, criteria = { ...current.review.criteria, residency };
    try {
      const hotel = await api.getHotel(hid, criteria, language);
      const match = matchOfferForNationality(offer, hotel.offers);
      if (!match) { setNationalityCheck({ status: 'unavailable', residency }); return; }
      const checked = await api.prebook(hid, match);
      state.setSearch({ ...(state.criteria || current.review.criteria), residency }, state.destinationName);
      if (!state.setReviewDraft({ hid, hotelName, criteria, offer: match, language })) throw new Error('review_draft_rejected');
      const expiresAt = Math.min(Date.now() + REVIEW_CHECK_LIFETIME_MS, (contextExpiry(checked.prebookContext) ?? Infinity) - 60_000);
      const selection: CheckoutSelection = Object.freeze({ selectionId: `nationality:${residency}:${Date.now()}`, expiresAt, termsAccepted: true,
        review: Object.freeze({ hid, hotelName, criteria, offer: checked.offer, prebookContext: checked.prebookContext }) });
      if (!state.setCheckoutReviewAuthority(() => selection.expiresAt > Date.now() ? selection : null)) throw new Error('checkout_review_rejected');
      const same = !checked.priceChanged && samePrice(offer.price, checked.offer.price);
      setNationalityCheck({ status: same ? 'same' : 'changed', residency, from: offer.price, to: checked.offer.price });
    } catch { setNationalityCheck({ status: 'error', residency }); }
  };
  // No equivalent rate for that nationality: the guest chooses again from the hotel's rooms.
  const changeNationality = (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => {
    const current = state.getCheckoutReview(); if (!current) return;
    carriedTraveler.set('latest', { occupancy: JSON.stringify(occupancy), draft });
    setDirty(false); allowLeave();
    state.setSearch({ ...(state.criteria || current.review.criteria), residency }, state.destinationName);
    router.replace({ pathname: '/hotel/[hid]', params: { hid: String(current.review.hid) } });
  };
  const clearCompleted = async () => {
    if (!await session.clearCompleted()) return false;
    setDirty(false); allowLeave(); travelerDrafts.clear();
    state.clearCheckoutReview(); state.clearReviewDraft(); router.replace('/'); return true;
  };
  // Nothing was charged: the same room stays chosen and the guest pays another way.
  const retryPayment = async (next: CheckoutPaymentMethod) => {
    // The new method is in place before the attempt is cleared, so the next price lock is for it.
    const previous = methodRef.current;
    methodRef.current = tabbyOffered ? next : 'card'; setMethod(next);
    if (await session.clearCompleted({ keepSelection: true })) return true;
    methodRef.current = previous; setMethod(previous); return false;
  };
  const policy = async (path: '/privacy'|'/terms') => {
    try { await WebBrowser.openBrowserAsync(websiteUrl(path), { toolbarColor: colors.navy }); } catch { /* The screen remains usable. */ }
  };
  return <CheckoutContents session={session} readSelection={state.getCheckoutReview} identityKey={`${status}:${sessionRevision}`}
    signedIn={status === 'signedIn'} creationEnabled={nativeCreationPolicy()} onFreshOffer={freshOffer}
    onSignIn={() => router.navigate({ pathname: '/account', params: { returnTo: '/checkout' } })} onSupport={() => router.push('/support')} onTrips={() => router.navigate('/bookings')} onWebsite={openWebsite}
    onPayment={openPayment} onClearCompleted={clearCompleted} onPrivacy={() => void policy('/privacy')} onTerms={() => void policy('/terms')}
    onTravelerDirty={setDirty} onNationalityChange={repriceNationality} onChooseRoomForNationality={changeNationality}
    nationalityCheck={nationalityCheck} paymentMethod={effectiveMethod} onPaymentMethod={setMethod} onRetryPayment={retryPayment}/>;
}

export interface CheckoutContentsProps {
  session: CheckoutController; readSelection: () => CheckoutSelection | null; identityKey: string;
  signedIn: boolean; creationEnabled: boolean; onFreshOffer: () => void; onSignIn: () => void; onSupport: () => void; onTrips?: () => void;
  onWebsite: () => Promise<boolean>; onPayment: () => Promise<boolean>; onClearCompleted: () => Promise<boolean>;
  onPrivacy: () => void; onTerms: () => void; onTravelerDirty?: (dirty: boolean) => void;
  onNationalityChange?: (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => void;
  onChooseRoomForNationality?: (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => void;
  nationalityCheck?: NationalityCheck | null;
  paymentMethod?: CheckoutPaymentMethod; onPaymentMethod?: (method: CheckoutPaymentMethod) => void;
  onRetryPayment?: (method: CheckoutPaymentMethod) => Promise<boolean>;
}

const scrollBehaviour = { keyboardShouldPersistTaps: 'handled' as const, keyboardDismissMode: Platform.OS === 'web' ? 'none' as const : 'on-drag' as const };

/*
 * The booking summary in a few lines: hotel, dates and guests; room and meals; the
 * cancellation deadline; the amount. The full cancellation schedule and every tax line
 * stay one tap away in sheets, so the guest form starts on the first screen.
 */
function CheckoutSummary({ selection, offer, amount, showAmount = true }: { selection: CheckoutSelection; offer: RoomOffer; amount: Money | null; showAmount?: boolean }) {
  const { language } = useLanguage(), ar = language === 'ar';
  const charge = useChargeMoney();
  const copy = checkoutCopy(language);
  const [sheet, setSheet] = useState<'cancellation' | 'fees' | null>(null);
  const cancellations = useMemo(() => [offer.cancellation], [offer.cancellation]);
  const now = useCancellationClock(cancellations);
  const facts = roomRateFacts(offer, language, now, charge);
  const { criteria } = selection.review;
  const nights = nightsBetween(criteria.checkin, criteria.checkout), words = stayWords(language);
  const stay = [formatStayRange(criteria.checkin, criteria.checkout, language), nights ? words.nights(nights) : '', guestLine(criteria.guests, language)].filter(Boolean).join(' · ');
  const roomName = localizedRoomName(offer.name, language);
  const free = facts.decision.kind === 'free';
  const cancelTone = free ? color.success : facts.decision.nonRefundable ? color.danger : color.textPrimary;
  const fees = facts.fees === rateCopy(language).included ? null : facts.fees;
  return <Card testID="checkout-summary" style={styles.card}>
    <View style={{ gap: 1 }}>
      <Txt kind="bodyStrong" accessibilityRole="header" numberOfLines={2} style={{ fontFamily: fonts.bold }}>{selection.review.hotelName}</Txt>
      <Txt kind="caption">{stay}</Txt>
    </View>
    <InfoRow icon="bed">
      <Txt kind="label" tone="primary">{roomName}<Txt kind="small" tone="secondary"> · {facts.meal}</Txt></Txt>
      {/* The supplier's own name is the booking identity the hotel sees; it is labelled, not repeated. */}
      {roomName !== offer.name && <Txt kind="caption" numberOfLines={2}>{ar ? 'الاسم لدى الفندق: ' : 'Hotel’s name: '}<Txt kind="caption" style={{ writingDirection: 'ltr' }}>{offer.name}</Txt></Txt>}
    </InfoRow>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}><InfoRow icon={free ? 'checkCircle' : facts.decision.nonRefundable ? 'alertCircle' : 'clock'} tone={cancelTone} testID="checkout-cancellation">
        <Txt kind="small" style={{ color: cancelTone, fontFamily: fonts.medium }}>{facts.decision.headline}</Txt>
      </InfoRow></View>
      <TextLink testID="checkout-cancellation-details" title={ar ? 'الجدول' : 'Schedule'} label={ar ? 'جدول الإلغاء' : 'Cancellation schedule'} onPress={() => setSheet('cancellation')}/>
    </Row>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}><InfoRow icon="hotel"><Txt kind="small" tone="primary">{fees ? (ar ? `يُدفع في الفندق (غير مشمول): ${fees}` : `Due at the hotel (not included): ${fees}`) : (ar ? 'الضرائب والرسوم مشمولة' : 'Taxes and fees included')}</Txt></InfoRow></View>
      <TextLink testID="checkout-fees-details" title={ar ? 'التفاصيل' : 'Details'} label={ar ? 'الضرائب والرسوم' : 'Taxes and fees'} onPress={() => setSheet('fees')}/>
    </Row>
    {showAmount && <><Divider/><Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }}>
      <Txt kind="label" tone="primary" style={{ flexShrink: 1 }}>{copy.charge}</Txt>
      <Txt testID="checkout-amount" kind="subheading" style={{ writingDirection: 'ltr' }}>{formatPrice(amount) || copy.offer}</Txt>
    </Row></>}
    <Sheet visible={sheet === 'cancellation'} testID="checkout-cancellation-sheet" title={ar ? 'الإلغاء' : 'Cancellation'} subtitle={roomName} onClose={() => setSheet(null)}>
      <Cancellation offer={offer} defaultExpanded/>
    </Sheet>
    <Sheet visible={sheet === 'fees'} testID="checkout-fees-sheet" title={ar ? 'الضرائب والرسوم' : 'Taxes and fees'} subtitle={roomName} onClose={() => setSheet(null)}>
      <Taxes taxes={offer.taxes} defaultExpanded/>
    </Sheet>
  </Card>;
}

// An ordinary presentation seam for an isolated fixture entry. The shipped
// route always supplies the real guarded controller above; no URL/storage flag
// can enable payment creation or inject this controller into the application.
export function CheckoutContents(props: CheckoutContentsProps) {
  const charge = useChargeMoney();
  const { session, signedIn, creationEnabled } = props;
  const { language } = useLanguage(), copy = checkoutCopy(language), ar = language === 'ar';
  const selected = props.readSelection();
  const [opening, setOpening] = useState(false), [actionError, setActionError] = useState<'website'|'payment'|'clear'|null>(null);
  const busy = ['quoting','submitting','recovering'].includes(session.phase);
  // The review page already rechecked price and availability, so the payment amount is locked
  // here without a separate button. It is requested again if it lapses; an error stops the loop.
  const requestQuote = session.requestQuote;
  const autoQuote = signedIn && session.canQuote && !session.quote && session.phase !== 'quoting' && !session.error && session.availability?.enabled === true;
  useEffect(() => { if (autoQuote) void requestQuote(); }, [autoQuote, requestQuote]);
  // A booking submitted in this visit goes straight to Ziina. A recovered one waits for the
  // guest's tap, so reopening the app never pushes them into a payment page.
  const submitted = useRef(false), paymentOpened = useRef('');
  const waitingReference = session.attempt?.status === 'awaiting_payment' ? session.attempt.reference : '';
  const onPayment = props.onPayment;
  useEffect(() => {
    if (!submitted.current || !waitingReference || paymentOpened.current === waitingReference || !creationEnabled) return;
    paymentOpened.current = waitingReference;
    void onPayment();
  }, [waitingReference, creationEnabled, onPayment]);
  // After payment the page keeps asking the server for news (quickly at first, then less often) while the
  // app is in front, so payment verification and the hotel's confirmation appear without a tap.
  const attemptStatus = session.attempt?.status ?? null, attemptReference = session.attempt?.reference ?? '';
  const recovering = session.phase === 'recovering', refreshStatus = session.refreshStatus;
  const pollStart = useRef<{ reference: string; at: number } | null>(null);
  useEffect(() => {
    if (!attemptStatus || !attemptReference || recovering) return;
    if (pollStart.current?.reference !== attemptReference) pollStart.current = { reference: attemptReference, at: Date.now() };
    const delay = livePollDelay(attemptStatus, Date.now() - pollStart.current.at);
    if (delay === null) return;
    const timer = setTimeout(() => { if (AppState.currentState === 'active') void refreshStatus(); }, delay);
    return () => clearTimeout(timer);
  }, [attemptStatus, attemptReference, recovering, refreshStatus]);
  const perform = async (kind: 'website'|'payment'|'clear', action: () => Promise<boolean>) => {
    if (opening) return; setOpening(true); setActionError(null);
    try { if (!await action()) setActionError(kind); } catch { setActionError(kind); }
    finally { setOpening(false); }
  };
  // Presentation copies deliberately omit every hash/context/capability.
  const offer: RoomOffer | null = selected ? { id: 'display-only', bookHash: '', images: [],
    name: selected.review.offer.name, meal: selected.review.offer.meal, noChildMeal: selected.review.offer.noChildMeal, bedding: selected.review.offer.bedding,
    price: selected.review.offer.price, taxes: selected.review.offer.taxes, cancellation: selected.review.offer.cancellation } : null;
  const existing = session.hasRecovery || session.attempt !== null;
  // Once confirmed, the receipt is read from the account's booking record for this exact reference,
  // never from whatever stay is selected on this device. Guests are added only when that selection
  // is visibly the same stay (hotel and dates).
  const confirmedReference = session.attempt?.confirmed ? session.attempt.reference : '';
  const [record, setRecord] = useState<{ reference: string; item: BookingHistoryItem | null } | null>(null);
  useEffect(() => {
    if (!confirmedReference) return;
    const controller = new AbortController();
    api.getBookings(controller.signal).then(rows => {
      if (!controller.signal.aborted) setRecord({ reference: confirmedReference, item: rows.find(row => row.reference === confirmedReference) ?? null });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [confirmedReference]);
  const booked = record?.reference === confirmedReference ? record.item : null;
  const sameStay = Boolean(booked && selected && booked.hotelName === selected.review.hotelName
    && booked.checkin === selected.review.criteria.checkin && booked.checkout === selected.review.criteria.checkout);
  const bookedNights = booked?.checkin && booked.checkout ? nightsBetween(booked.checkin, booked.checkout) : null;
  const receipt: StayReceiptData | null = booked ? {
    hotelName: booked.hotelName,
    stay: booked.checkin && booked.checkout ? [formatStayRange(booked.checkin, booked.checkout, language), bookedNights ? stayWords(language).nights(bookedNights) : ''].filter(Boolean).join(' · ') : null,
    guests: sameStay && selected ? guestLine(selected.review.criteria.guests, language) : null,
    room: booked.roomName ? [localizedRoomName(booked.roomName, language), sameStay && selected ? mealDescription(selected.review.offer, language) : ''].filter(Boolean).join(' · ') : null,
    paid: booked.price ? formatPrice(booked.price) : null,
  } : null;
  const amount: Money | null = session.quote ? { amount: session.quote.amount, currency: session.quote.currency } : offer ? charge(offer.price) : null;
  const title = <Txt kind="heading" accessibilityRole="header">{copy.title}</Txt>;
  const sandbox = session.availability?.enabled && session.availability.mode === 'sandbox' ? copy.sandbox : undefined;
  const [heldQuote, setHeldQuote] = useState<CheckoutQuoteView | null>(null);
  if (session.quote && session.quote !== heldQuote) setHeldQuote(session.quote);
  const requoting = !session.quote && session.phase === 'quoting' && heldQuote !== null && !existing;
  const formQuote = session.quote ?? (requoting ? heldQuote : null);
  const showForm = Boolean(!existing && selected && offer && creationEnabled && signedIn && (session.canCollectTravelers || requoting) && formQuote);
  const tabbyOffered = session.availability?.tabby === true;
  const failedOutcome = session.attempt?.status === 'payment_failed' ? tabbyOutcome(session.attempt.paymentError) : null;
  const canRetry = Boolean(session.attempt?.status === 'payment_failed' && !session.attempt.paymentVerified && selected && props.onRetryPayment && creationEnabled);
  const fresh = <Button compact title={copy.fresh} variant="quiet" disabled={busy || opening} onPress={props.onFreshOffer}/>;

  return <SafeAreaView edges={['top','bottom']} style={ui.screen}>
    <BrandHeader back/>
    <KeyboardAvoidingView style={{ flex: 1 }} enabled={Platform.OS !== 'web'} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {showForm && selected && offer && formQuote ? <CheckoutTravelerForm key={`${props.identityKey}:${selected.selectionId}`}
        draftKey={`${props.identityKey}:${selected.selectionId}`} onDirty={props.onTravelerDirty}
        occupancy={selected.review.criteria.guests} quote={formQuote} canSubmit={session.canSubmit} submitting={session.phase === 'submitting'}
        requoting={requoting} paymentMethod={props.paymentMethod ?? 'card'} onPaymentMethod={props.onPaymentMethod} tabbyOffered={tabbyOffered}
        residency={selected.review.criteria.residency} onNationalityChange={props.onNationalityChange}
        onChooseRoomForNationality={props.onChooseRoomForNationality} nationalityCheck={props.nationalityCheck} note={sandbox}
        header={<>{title}<CheckoutSummary selection={selected} offer={offer} amount={amount} showAmount={false}/></>} footer={fresh}
        onSubmit={(data,consent)=>{ submitted.current = true; return session.submit(data,consent); }} onPrivacy={props.onPrivacy} onTerms={props.onTerms}/>
        : <ScrollView {...scrollBehaviour} contentContainerStyle={[ui.page, styles.page]}>
          {title}
          {existing ? <>
            {session.phase === 'unknown' && <StatePanel icon="hourglass" tone="warning" title={copy.unknown} body={copy.unknownBody}/>}
            {session.attempt ? <LivePaymentStatus testID="checkout-live-status" key={session.attempt.reference} status={session.attempt.status}
              reference={session.attempt.reference} live={LIVE_STATUSES.includes(session.attempt.status)}>
              {session.error && <Badge tone="warning" icon="history" label={copy.lastKnown}/>}
              {session.attempt.confirmed && session.attempt.supplierReference && <Row style={{ justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
                <Txt kind="caption">{copy.supplierReference}</Txt><Txt kind="label" selectable style={{ writingDirection: 'ltr' }}>{session.attempt.supplierReference}</Txt></Row>}
              {session.attempt.confirmed && session.attempt.voucherDelivery && session.attempt.voucherDelivery !== 'sent' && <Txt kind="small" tone="primary">{session.attempt.voucherDelivery === 'review' ? copy.voucherReview : copy.voucherPending}</Txt>}
              {/* The confirmed booking is saved under the checkout reference; the server checks ownership and confirmation again. */}
              {session.attempt.confirmed && receipt && <StayReceipt testID="checkout-receipt" data={receipt}/>}
              {session.attempt.confirmed && props.onTrips && <Button testID="checkout-view-trip" icon="trips" title={ar ? 'عرض الحجز في رحلاتي' : 'View in My trips'} onPress={props.onTrips}/>}
              {session.attempt.confirmed && <VoucherButton booking={{ reference: session.attempt.reference, hotelName: null, roomName: null, checkin: null, checkout: null,
                recordedStatus: 'active', supplierStatus: 'CONFIRMED', statusKind: 'confirmed', price: null }}/>}
              {session.attempt.status === 'awaiting_payment' && creationEnabled && <Button icon="lock" title={copy.openPayment} busy={opening} disabled={busy} onPress={() => void perform('payment',props.onPayment)}/>}
              {actionError === 'payment' && <Txt kind="small" accessibilityRole="alert" tone="danger">{copy.paymentLinkError}</Txt>}
              {failedOutcome && <Notice testID="checkout-tabby-outcome" tone="warning" live title={tabbyMessage(failedOutcome, language).title} body={tabbyMessage(failedOutcome, language).body}/>}
              {canRetry && <View style={{ gap: space.sm }}>
                <Button testID="checkout-retry-card" icon="card" title={ar ? 'الدفع ببطاقة أو محفظة' : 'Pay by card or wallet'} busy={opening} disabled={busy}
                  onPress={() => void perform('clear', () => props.onRetryPayment!('card'))}/>
                {tabbyOffered && (!failedOutcome || ['expired', 'closed', 'unavailable'].includes(failedOutcome)) && <Button testID="checkout-retry-tabby" variant="secondary"
                  title={ar ? 'المحاولة مع تابي مجدداً' : 'Try Tabby again'} disabled={busy || opening} onPress={() => void perform('clear', () => props.onRetryPayment!('tabby'))}/>}
              </View>}
            </LivePaymentStatus> : <StatePanel title={copy.checking} body={copy.unknownBody} busy={busy}/>}
            {session.error && <Txt kind="small" accessibilityRole="alert" tone="danger">{copy.statusError}</Txt>}
            {session.canClearCompleted && <Button title={copy.clear} variant="secondary" disabled={opening || busy} onPress={() => void perform('clear',props.onClearCompleted)}/>}
            {actionError === 'clear' && <Txt kind="small" accessibilityRole="alert" tone="danger">{copy.clearError}</Txt>}
            <Row style={{ justifyContent: 'center', gap: space.lg, flexWrap: 'wrap' }}>
              <TextLink icon="refresh" title={copy.refresh} onPress={() => void (session.attempt ? session.refreshStatus() : session.recover())}/>
              <TextLink icon="support" title={copy.support} onPress={props.onSupport}/>
            </Row>
          </> : !selected || !offer ? <><StatePanel title={copy.missing} body={copy.missingBody}/><Button title={copy.fresh} onPress={props.onFreshOffer}/></> : <>
            <CheckoutSummary selection={selected} offer={offer} amount={amount}/>
            {!creationEnabled && <Notice tone="info" title={copy.gateOff} body={copy.websiteBody}>
              {actionError === 'website' && <Txt kind="small" accessibilityRole="alert" tone="danger">{copy.websiteError}</Txt>}
              <Button title={copy.website} busy={opening} disabled={busy || signedIn && !session.recoveryChecked} onPress={() => void perform('website',props.onWebsite)}/>
            </Notice>}
            {!signedIn ? <><StatePanel title={copy.signIn} body={copy.signInBody}/><Button title={copy.signIn} variant="secondary" onPress={props.onSignIn}/></>
              : creationEnabled && <>
                {session.availability && !session.availability.enabled && <Notice tone="warning" title={copy.unavailable} body={copy.unavailableBody}/>}
                {!session.quote && !session.error && session.availability?.enabled !== false && <StatePanel busy title={copy.quoteBusy}/>}
                {session.error && <Notice tone="danger" live title={copy.quoteError}
                  action={{ label: ar ? 'أعد المحاولة' : 'Try again', busy, onPress: () => void (session.availability?.enabled ? session.requestQuote() : session.loadAvailability()) }}/>}
              </>}
            {fresh}
          </>}
        </ScrollView>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

/*
 * One page: lead guest, nationality, other travelers, optional requests and the
 * acknowledgement, with the amount and "Confirm and pay" fixed at the bottom. Pressing it
 * checks every field; the first problem is scrolled into view. No separate review step.
 */
export function CheckoutTravelerForm({ occupancy, quote, canSubmit, submitting = false, onSubmit, onPrivacy, onTerms, draftKey, onDirty, residency, onNationalityChange, onChooseRoomForNationality, nationalityCheck, header, footer, note,
  requoting = false, paymentMethod = 'card', onPaymentMethod, tabbyOffered = false }: {
  occupancy: GuestRoom[]; quote: CheckoutQuoteView; canSubmit: boolean; submitting?: boolean; draftKey?: string; onDirty?: (dirty: boolean) => void;
  residency?: string; onNationalityChange?: (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => void;
  onChooseRoomForNationality?: (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => void; nationalityCheck?: NationalityCheck | null;
  onSubmit: (data: CheckoutGuestData, consent: boolean) => Promise<void>; onPrivacy: () => void; onTerms: () => void;
  header?: React.ReactNode; footer?: React.ReactNode; note?: string;
  requoting?: boolean; paymentMethod?: CheckoutPaymentMethod; onPaymentMethod?: (method: CheckoutPaymentMethod) => void; tabbyOffered?: boolean;
}) {
  const { language, t } = useLanguage(), copy = checkoutCopy(language), ar = language === 'ar';
  const { narrow, fontScale } = useLayout();
  const [draft,storeDraft] = useState(() => (draftKey && travelerDrafts.get(draftKey)) || takeCarriedTraveler(occupancy) || createTravelerDraft(occupancy));
  useEffect(() => { if (draftKey && travelerDrafts.has(draftKey)) onDirty?.(true); }, [draftKey, onDirty]);
  // Chosen in the search (required there), so it is filled in; changing it here re-prices the room.
  const [nationality,setNationality] = useState(() => residency || chosenNationality.get('latest') || '');
  const [nationalityMissing,setNationalityMissing] = useState(false);
  const [picker,showPicker] = useState(false);
  const [requestsOpen,setRequestsOpen] = useState(() => Boolean(draft?.guest.specialRequests));
  // Each additional room folds to one line of names once it is filled in; a room with a problem always opens.
  const [collapsed,setCollapsed] = useState<Record<number, boolean>>({});
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const formTop = useRef(0), consentTop = useRef(0);
  const checking = nationalityCheck?.status === 'checking';
  const repricing = Boolean(residency && nationality && nationality !== residency);
  const money = (value?: Money | null) => formatPrice(value) || '';
  const setDraft = (next: NonNullable<typeof draft>) => { storeDraft(next); if (draftKey) travelerDrafts.set(draftKey, next); carriedTraveler.set('latest', { occupancy: JSON.stringify(occupancy), draft: next }); onDirty?.(true); };
  const [errors,setErrors] = useState<Record<string,TravelerError>>({});
  const [consent,setConsent] = useState({ quote, accepted: false });
  const [consentMissing,setConsentMissing] = useState(false);
  const accepted = consent.quote === quote && consent.accepted;
  const tabby = paymentMethod === 'tabby' && tabbyOffered;
  const contactEmail = draft?.guest.email.trim() ?? '', contactPhone = draft?.guest.phone.trim() ?? '';
  const contactReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) && /^\+[1-9]\d{6,19}$/.test(contactPhone);
  const eligibilityKey = tabby && !requoting && quote.currency === 'AED' && contactReady ? JSON.stringify([quote.amount, contactEmail.toLowerCase(), contactPhone]) : '';
  const [eligibility, setEligibility] = useState<{ key: string; available: boolean; reason?: TabbyRejection } | null>(null);
  useEffect(() => {
    if (!eligibilityKey) return;
    const [amount, email, phone] = JSON.parse(eligibilityKey) as [string, string, string];
    const controller = new AbortController();
    // Tabby's pre-scoring: a refusal is shown before the guest pays; a failed check never blocks.
    const timer = setTimeout(() => {
      api.checkout.tabbyEligibility({ amount, email, phone, language }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setEligibility({ key: eligibilityKey, available: result.available, reason: result.reason }); })
        .catch(() => { if (!controller.signal.aborted) setEligibility({ key: eligibilityKey, available: true }); });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [eligibilityKey, language]);
  const tabbyCheck = eligibility && eligibility.key === eligibilityKey ? eligibility : null;
  const tabbyChecking = Boolean(eligibilityKey && !tabbyCheck);
  const tabbyRefusal: TabbyRejection | null = eligibilityKey && tabbyCheck && !tabbyCheck.available ? tabbyCheck.reason ?? 'not_available' : null;
  const installment = tabbyInstallment(quote.amount, quote.currency);
  const choice = paymentChoiceCopy(language);
  if (!draft) return <ScrollView contentContainerStyle={[ui.page, styles.page]}>{header}<StatePanel title={copy.invalidOccupancy}/>{footer}</ScrollView>;
  const side = !narrow && fontScale <= 1.3;
  const error = (key: string) => { const code=errors[key]; return !code || code === 'required' ? undefined : code === 'name' ? copy.errorName : code === 'email' ? copy.errorEmail : code === 'phone' ? copy.errorPhone : code === 'requests' ? copy.errorRequests : copy.invalidOccupancy; };
  const missing = (key: string) => errors[key] === 'required';
  // The lead guest's family name is carried to the other travelers (only empty or still-carried fields).
  const contact = (key: keyof typeof draft.guest, value: string) => {
    const updated = { ...draft, guest: { ...draft.guest, [key]: value } };
    const carried = key === 'lastName' ? carryFamilyName(updated, draft.guest.lastName, value) : updated;
    setDraft(carried);
    // A traveler field the carried name just filled no longer needs its 'required' mark.
    setErrors(current => { const next = { ...current }; delete next[key];
      carried.rooms.forEach((room, r) => room.guests.forEach((person, p) => {
        if (person.lastName && person.lastName !== draft.rooms[r].guests[p].lastName) delete next[`traveler-${r}-${p}-lastName`];
      }));
      return next; });
  };
  const traveler = (r: number,p: number,key: 'firstName'|'lastName',value: string) => { setDraft({ ...draft, rooms:draft.rooms.map((room,ri)=>ri===r?{guests:room.guests.map((person,pi)=>pi===p?{...person,[key]:value}:person)}:room) }); setErrors(current=>{const next={...current};delete next[`traveler-${r}-${p}-${key}`];return next;}); };
  const submit = () => {
    const checked = validateTravelerDraft(draft, occupancy);
    setErrors(checked.errors);
    const missing = Boolean(residency && !nationality);
    setNationalityMissing(missing);
    setConsentMissing(!accepted);
    if (!checked.data || missing) { Keyboard.dismiss(); scroller.current?.scrollTo({ y: Math.max(0, formTop.current - space.sm), animated: true }); return; }
    if (!accepted) { Keyboard.dismiss(); scroller.current?.scrollTo({ y: Math.max(0, consentTop.current - space.xxl), animated: true }); return; }
    if (!canSubmit || repricing || checking || tabby && (tabbyChecking || tabbyRefusal)) return;
    Keyboard.dismiss();
    void onSubmit(checked.data, true).then(()=>{ if (draftKey) travelerDrafts.delete(draftKey); carriedTraveler.delete('latest'); onDirty?.(false); });
  };
  const pair = (first: React.ReactNode, last: React.ReactNode) => side
    ? <Row style={{ gap: space.sm, alignItems: 'flex-start' }}><View style={{ flex: 1, minWidth: 0 }}>{first}</View><View style={{ flex: 1, minWidth: 0 }}>{last}</View></Row>
    : <>{first}{last}</>;
  const others = draft.rooms.map((room, r) => ({ r, guests: room.guests.map((person, p) => ({ person, p })).filter(({ p }) => !(r === 0 && p === 0)) })).filter(room => room.guests.length > 0);
  const fieldErrors = Object.keys(errors).length > 0;
  return <>
    <ScrollView ref={scroller} {...scrollBehaviour} contentContainerStyle={[ui.page, styles.page]}>
      {header}
      <Card testID="checkout-traveler-form" style={styles.card} onLayout={event => { formTop.current = event.nativeEvent.layout.y; }}>
        <View style={{ gap: 1 }}>
          <Txt kind="subheading" accessibilityRole="header">{copy.details}</Txt>
          <Txt kind="caption">{copy.detailsBody}</Txt>
        </View>
        {fieldErrors && <Notice tone="danger" live title={errors.occupancy ? copy.invalidOccupancy : copy.fieldsError}/>}
        {pair(<Field label={copy.firstName} value={draft.guest.firstName} maxLength={50} autoCorrect={false} autoCapitalize="words" autoComplete="given-name" error={error('firstName')} invalid={missing('firstName')} onChangeText={v=>contact('firstName',v)}/>,
          <Field label={copy.lastName} value={draft.guest.lastName} maxLength={50} autoCorrect={false} autoCapitalize="words" autoComplete="family-name" error={error('lastName')} invalid={missing('lastName')} onChangeText={v=>contact('lastName',v)}/>)}
        <Field label={copy.email} value={draft.guest.email} maxLength={254} ltr autoCorrect={false} autoCapitalize="none" autoComplete="email" keyboardType="email-address" error={error('email')} invalid={missing('email')} onChangeText={v=>contact('email',v)}/>
        <Field label={copy.phone} value={draft.guest.phone} maxLength={40} ltr autoComplete="tel" keyboardType="phone-pad" placeholder="+971" accessibilityHint={copy.phoneHint} error={error('phone')} invalid={missing('phone')} onChangeText={v=>contact('phone',v)}/>
        {residency && <View style={{gap:space.xs}}>
          {nationality ? <Row testID="checkout-nationality-fact" style={[styles.nationalityFact, repricing && !checking && { borderColor: color.warning, borderWidth: 1.5 }]}>
            <Icon name="globe" size={16} color={color.textSecondary}/>
            <Txt kind="small" tone="primary" numberOfLines={1} style={{ flex: 1 }}>{t('residency')}: <Txt kind="label" tone="primary">{countryName(nationality, language)}</Txt></Txt>
            <TextLink testID="checkout-nationality" title={ar ? 'تغيير' : 'Change'} label={`${t('residency')}: ${countryName(nationality, language)} · ${ar ? 'تغيير' : 'Change'}`}
              onPress={()=>{Keyboard.dismiss();showPicker(true);}}/>
          </Row> : <>
            <Txt kind="label">{t('residency')}</Txt>
            <Pressable testID="checkout-nationality" accessibilityRole="button" accessibilityLabel={`${t('residency')}: ${t('residencyChoose')}`} onPress={()=>{Keyboard.dismiss();showPicker(true);}}
              style={[styles.select, { borderColor: nationalityMissing ? color.danger : 'transparent' }]}>
              <Row style={{justifyContent:'space-between'}}><Txt tone="secondary">{t('residencyChoose')}</Txt><Icon name="chevronDown" size={18}/></Row>
            </Pressable>
            {nationalityMissing && <Txt kind="small" accessibilityRole="alert" tone="danger">{t('residencyError')}</Txt>}
          </>}
          {checking && <Row style={{ gap: space.xs }}><ActivityIndicator size="small" color={color.interactive}/>
            <Txt kind="small" accessibilityLiveRegion="polite">{ar ? `نتحقق من السعر لجنسية ${countryName(nationalityCheck.residency, language)}…` : `Checking the price for ${countryName(nationalityCheck.residency, language)} nationals…`}</Txt></Row>}
          {!checking && nationalityCheck?.status === 'changed' && nationalityCheck.residency === residency && <Notice tone="warning"
            title={ar ? 'تغيّر السعر لهذه الجنسية' : 'The price changed for this nationality'}
            body={ar ? `السعر لجنسية ${countryName(residency, language)}: ${money(nationalityCheck.to)} بدل ${money(nationalityCheck.from)}. المبلغ المعروض للدفع محدّث.` : `Price for ${countryName(residency, language)} nationals: ${money(nationalityCheck.to)} instead of ${money(nationalityCheck.from)}. The payment amount shown is updated.`}/>}
          {!checking && repricing && nationalityCheck?.residency === nationality && nationalityCheck.status === 'unavailable' && <Notice tone="warning"
            title={ar ? 'هذه الغرفة غير متاحة لهذه الجنسية' : 'This room is not offered for this nationality'}
            body={ar ? 'اختر غرفة أخرى بالأسعار المتاحة لهذه الجنسية؛ ستبقى البيانات التي كتبتها.' : 'Choose another room at the prices for this nationality; your details are kept.'}
            action={{ label: ar ? 'اختر غرفة' : 'Choose a room', onPress: () => onChooseRoomForNationality?.(nationality, draft, occupancy) }}/>}
          {!checking && repricing && nationalityCheck?.residency === nationality && nationalityCheck.status === 'error' && <Notice tone="danger"
            title={ar ? 'تعذّر التحقق من السعر لهذه الجنسية' : 'Could not check the price for this nationality'}
            action={{ label: ar ? 'أعد المحاولة' : 'Try again', onPress: () => onNationalityChange?.(nationality, draft, occupancy) }}/>}
          <CountryPicker visible={picker} value={nationality} title={t('residency')} onClose={()=>showPicker(false)} onChange={code=>{setNationality(code);setNationalityMissing(false);onDirty?.(true);if(residency&&code!==residency)onNationalityChange?.(code,draft,occupancy);}}/>
        </View>}
        {others.map(({ r, guests }) => {
          const roomError = guests.some(({ p }) => errors[`traveler-${r}-${p}-firstName`] || errors[`traveler-${r}-${p}-lastName`]);
          const open = !collapsed[r] || roomError;
          const names = guests.map(({ person }) => [person.firstName.trim(), person.lastName.trim()].filter(Boolean).join(' ')).filter(Boolean).join(ar ? '، ' : ', ');
          const heading = draft.rooms.length > 1 ? copy.room(r + 1) : copy.otherTravelers;
          return <View key={r} style={styles.group}>
            <Pressable testID={`checkout-room-${r + 1}`} accessibilityRole="button" accessibilityLabel={open ? heading : `${heading} · ${names || copy.namesMissing}`}
              aria-expanded={open} accessibilityState={{ expanded: open }} onPress={() => setCollapsed(current => ({ ...current, [r]: open }))} style={styles.groupHeader}>
              <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt kind="label" accessibilityRole="header">{heading}</Txt>
                  {!open && <Txt kind="caption" numberOfLines={1}>{names || copy.namesMissing}</Txt>}
                </View>
                <DisclosureMark open={open}/>
              </Row>
            </Pressable>
            {open && guests.map(({ person, p }) => <View key={p} style={{ gap: space.xs }}>
              <Txt kind="small" tone="primary" style={{ fontFamily: fonts.medium }}>{copy.traveler(p+1,person.is_child,person.age)}</Txt>
              {pair(<Field label={copy.firstName} a11yLabel={`${copy.firstName} · ${copy.room(r+1)} · ${copy.traveler(p+1,person.is_child,person.age)}`} value={person.firstName} maxLength={50} autoCorrect={false} autoCapitalize="words" error={error(`traveler-${r}-${p}-firstName`)} invalid={missing(`traveler-${r}-${p}-firstName`)} onChangeText={v=>traveler(r,p,'firstName',v)}/>,
                <Field label={copy.lastName} a11yLabel={`${copy.lastName} · ${copy.room(r+1)} · ${copy.traveler(p+1,person.is_child,person.age)}`} value={person.lastName} maxLength={50} autoCorrect={false} autoCapitalize="words" error={error(`traveler-${r}-${p}-lastName`)} invalid={missing(`traveler-${r}-${p}-lastName`)} onChangeText={v=>traveler(r,p,'lastName',v)}/>)}
            </View>)}
          </View>;
        })}
        <View style={styles.group}>
          {requestsOpen ? <>
            <Field label={copy.requests} value={draft.guest.specialRequests} multiline numberOfLines={3} maxLength={1000} style={{minHeight:88,textAlignVertical:'top'}} accessibilityHint={copy.requestsHint} error={error('specialRequests')} invalid={missing('specialRequests')} onChangeText={v=>contact('specialRequests',v)}/>
            <Txt kind="caption">{copy.requestsHint}</Txt>
          </> : <TextLink testID="checkout-add-requests" icon="plus" title={copy.addRequests} onPress={() => setRequestsOpen(true)}/>}
        </View>
      </Card>
      {tabbyOffered && onPaymentMethod && <Card testID="checkout-payment-methods" style={styles.card}>
        <Txt kind="subheading" accessibilityRole="header">{choice.heading}</Txt>
        <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
          <PaymentOption testID="checkout-method-card" selected={!tabby} onPress={() => onPaymentMethod('card')} icon="card"
            tag={choice.card.tag} title={choice.card.title} body={choice.card.body}/>
          <PaymentOption testID="checkout-method-tabby" selected={tabby} onPress={() => onPaymentMethod('tabby')} mark={<TabbyMark/>}
            tag={choice.tabby.tag} tagTone="mint" title={tabbyName(language)}
            body={tabby && installment ? (ar ? `4 دفعات متساوية بالدرهم، بلا فوائد ولا رسوم` : `4 equal payments in AED, no interest, no fees`)
              : (ar ? 'قسّمها على 4 دفعات بلا فوائد ولا رسوم، بالدرهم الإماراتي.' : 'Split it into 4 payments, no interest and no fees, in UAE dirhams.')}>
            {tabby && installment ? <TabbySchedule amount={Number(installment).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/> : null}
            {tabby && <Txt kind="caption">{choice.tabby.plans}</Txt>}
            <Row testID="checkout-tabby-approval" style={styles.approval}>
              <Icon name="info" size={16} color={color.textSecondary}/>
              <Txt kind="caption" style={{ flex: 1 }}><Txt kind="caption" style={{ fontFamily: localizedFont(language, fonts.bold), color: color.textPrimary }}>{choice.approval.title}: </Txt>{choice.approval.body}</Txt>
            </Row>
          </PaymentOption>
        </View>
        {tabby && <InfoRow icon="info"><Txt kind="caption">{ar ? 'تُكمل الدفع في صفحة تابي ثم تعود إلى التطبيق تلقائياً. السعر بالدرهم الإماراتي هو نفسه لكل طرق الدفع.' : 'You finish on Tabby’s page and come straight back to the app. The AED price is the same for every payment method.'}</Txt></InfoRow>}
        {tabby && tabbyChecking && <Row style={{ gap: space.xs }}><ActivityIndicator size="small" color={color.interactive}/>
          <Txt kind="small" accessibilityLiveRegion="polite">{ar ? 'نتحقق من إمكانية الدفع مع تابي…' : 'Checking Tabby for you…'}</Txt></Row>}
        {tabby && tabbyRefusal && <Notice testID="checkout-tabby-refused" tone="warning" live title={tabbyMessage(tabbyRefusal, language).title} body={tabbyMessage(tabbyRefusal, language).body}
          action={{ label: ar ? 'الدفع ببطاقة أو محفظة' : 'Pay by card or wallet', onPress: () => onPaymentMethod('card') }}/>}
      </Card>}
      <View onLayout={event => { consentTop.current = event.nativeEvent.layout.y; }} style={{ gap: space.xs }}>
        <Pressable testID="checkout-consent" accessibilityRole="checkbox" aria-checked={accepted} accessibilityState={{checked:accepted}}
          onPress={()=>{ setConsent({quote,accepted:!accepted}); setConsentMissing(false); }}
          style={[styles.consent, consentMissing && !accepted && { borderColor: color.danger }]}>
          <Row style={{alignItems:'flex-start', gap: space.sm}}>
            <View accessible={false} style={[styles.checkbox, accepted && styles.checkboxOn]}>{accepted && <Icon name="check" size={14} strokeWidth={3} color={color.textOnDark}/>}</View>
            <Txt kind="small" tone="primary" style={{flex:1}}>{copy.consent}</Txt>
          </Row>
        </Pressable>
        {consentMissing && !accepted && <Txt kind="small" accessibilityRole="alert" tone="danger">{copy.consentRequired}</Txt>}
        <Row style={{flexWrap:'wrap', gap: space.lg}}><TextLink title={copy.privacy} onPress={onPrivacy}/><TextLink title={copy.terms} onPress={onTerms}/></Row>
      </View>
      {footer}
    </ScrollView>
    <ActionBar testID="checkout-pay-bar" caption={copy.charge} amount={requoting ? '…' : formatPrice({ amount: quote.amount, currency: quote.currency })} amountTestID="checkout-pay-amount" note={note}>
      <Button testID="checkout-pay" icon="lock" title={tabby ? (ar ? 'المتابعة مع تابي' : 'Continue with Tabby') : copy.create} busy={submitting || requoting}
        disabled={!canSubmit || repricing || checking || requoting || tabby && Boolean(tabbyChecking || tabbyRefusal)} onPress={submit}/>
    </ActionBar>
  </>;
}

/** One payment choice: a radio row with its mark, name and one line of detail. */
/** One payment choice: a radio row with a playful tag, its mark, name and one line of detail; details below. */
function PaymentOption({ selected, onPress, icon, mark, tag, tagTone = 'plum', title, body, testID, children }: {
  selected: boolean; onPress: () => void; icon?: 'card'; mark?: React.ReactNode; tag?: string; tagTone?: 'plum' | 'mint';
  title: string; body: string; testID?: string; children?: React.ReactNode;
}) {
  return <View style={[styles.option, selected && styles.optionOn]}>
    <Pressable testID={testID} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${body}`} onPress={onPress} style={{ gap: space.xs }}>
      {tag && <View style={[styles.tag, tagTone === 'mint' && styles.tagMint]}><Txt kind="micro" style={{ color: tagTone === 'mint' ? '#04503C' : color.interactiveStrong }}>{tag}</Txt></View>}
      <Row style={{ gap: space.sm, alignItems: 'center' }}>
        <View accessible={false} style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot}/>}</View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt kind="label" tone="primary">{title}</Txt>
          <Txt kind="caption">{body}</Txt>
        </View>
        {mark ?? (icon ? <Icon name={icon} size={22} color={color.textSecondary}/> : null)}
      </Row>
    </Pressable>
    {children && <View style={{ gap: space.sm, marginTop: space.sm }}>{children}</View>}
  </View>;
}

type StageState = 'done' | 'active' | 'failed' | 'waiting';
/** Three server-reported stages. Payment verification and hotel confirmation stay visibly separate. */
function stages(status: CheckoutStatus): [StageState, StageState, StageState] {
  switch (status) {
    case 'preparing': case 'intent_creating': return ['active', 'waiting', 'waiting'];
    case 'preflight_failed': return ['failed', 'waiting', 'waiting'];
    case 'intent_unknown': case 'awaiting_payment': return ['done', 'active', 'waiting'];
    case 'payment_failed': return ['done', 'failed', 'waiting'];
    case 'payment_verified': case 'booking_pending': return ['done', 'done', 'active'];
    case 'booking_confirmed': return ['done', 'done', 'done'];
    case 'booking_cancelled': case 'booking_failed': return ['done', 'done', 'failed'];
    default: return ['done', 'active', 'waiting'];
  }
}
export function CheckoutProgress({ status }: { status: CheckoutStatus }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  if (status.startsWith('refund') || status === 'manual_review') return null;
  const labels = ar ? ['الطلب', 'الدفع', 'تأكيد الفندق'] : ['Request', 'Payment', 'Hotel confirmation'];
  const state = stages(status);
  const tint = (value: StageState) => value === 'done' ? color.success : value === 'failed' ? color.danger : value === 'active' ? color.warning : color.borderControl;
  return <Row testID="checkout-progress" accessibilityRole="progressbar" accessibilityLabel={labels.map((label, i) => `${label}: ${state[i]}`).join(' · ')}
    style={{ gap: space.xs, alignItems: 'flex-start' }}>
    {labels.map((label, i) => <View key={label} style={{ flex: 1, gap: space.xs, alignItems: 'center' }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: tint(state[i]),
        backgroundColor: state[i] === 'done' ? color.success : color.bgSurface }}>
        <Icon name={state[i] === 'done' ? 'check' : state[i] === 'failed' ? 'close' : state[i] === 'active' ? 'hourglass' : 'clock'} size={16}
          color={state[i] === 'done' ? color.textOnDark : tint(state[i])}/>
      </View>
      <Txt kind="caption" align="center" style={{ color: state[i] === 'waiting' ? color.textSecondary : color.textPrimary }}>{label}</Txt>
    </View>)}
  </Row>;
}

const styles = StyleSheet.create({
  page: { gap: space.md, paddingTop: space.md },
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg },
  nationalityFact: { gap: space.sm, alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 48, borderRadius: radius.md, backgroundColor: color.bgSubtle, borderColor: 'transparent', borderWidth: 1.5 },
  select: { minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, justifyContent: 'center', backgroundColor: color.bgField },
  group: { gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.border },
  groupHeader: { minHeight: 44, justifyContent: 'center' },
  consent: { borderRadius: radius.md, padding: space.md, backgroundColor: color.bgSubtle },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: color.interactiveStrong, backgroundColor: color.bgSurface, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: color.interactiveStrong },
  option: { minHeight: 64, borderRadius: radius.md, padding: space.md, backgroundColor: color.bgField, borderWidth: 1.5, borderColor: 'transparent' },
  optionOn: { backgroundColor: color.bgSurface, borderColor: color.interactiveStrong },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.interactiveStrong },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.interactiveStrong },
  tag: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color.bgSelected },
  tagMint: { backgroundColor: 'rgba(62,237,191,0.22)' },
  approval: { gap: space.xs, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.sm, backgroundColor: color.bgSubtle },
});
