import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreventRemove, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { APP_ENV, authSession, bookingWebsiteUrl, websiteUrl } from '../api';
import { NATIVE_CHECKOUT_ENABLED, paymentReturnUrl } from '../api/config';
import type { CheckoutGuestData, CheckoutStatus } from '../api/checkout';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import type { GuestRoom, RoomOffer } from '../types';
import { color, colors, fonts, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useAppState } from '../components/AppState';
import { useCheckoutSession } from '../components/useCheckoutSession';
import type { CheckoutQuoteView, CheckoutSelection } from '../components/checkoutSessionModel';
import { createTravelerDraft, validateTravelerDraft, type TravelerError } from '../components/checkoutTravelerModel';
import { Badge, Button, Field, Icon, MoneyText, Notice, Row, StatePanel, Txt } from '../components/Primitives';
import Taxes from '../components/Taxes';
import Cancellation from '../components/Cancellation';
import { useChargeCurrency, useChargeMoney } from '../components/ChargeCurrency';
import { MealBadge } from '../components/RateHighlights';
import { checkoutCopy, checkoutStatusCopy } from './checkoutCopy';
import { localizedRoomName } from '../components/roomNameModel';
import VoucherButton from '../components/VoucherButton';
import CountryPicker, { countryName, countryNameSecondary } from '../components/CountryPicker';

const nativeCreationPolicy = () => NATIVE_CHECKOUT_ENABLED && Platform.OS !== 'web';
// Traveler details typed but not yet submitted, kept in memory only (never stored on the device),
// so an accidental back gesture does not erase them. Cleared after submission or a finished booking.
type TravelerDraft = NonNullable<ReturnType<typeof createTravelerDraft>>;
const travelerDrafts = new Map<string, TravelerDraft>();
// Details typed before a nationality change, carried to the re-priced offer for the same guests.
const carriedTraveler = new Map<'latest', { occupancy: string; draft: TravelerDraft }>();
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
  const getCheckoutReview = state.getCheckoutReview;
  const getReview = useCallback(() => {
    const selection = getCheckoutReview();
    return selection && { ...selection, review: { ...selection.review, paymentCurrency: payCurrencyRef.current } };
  }, [getCheckoutReview]);
  const session = useCheckoutSession({ getReview, canCreate: nativeCreationPolicy });
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
  // RateHawk prices each rate for the guest's nationality. A different nationality needs a new
  // search, so the guest picks the room again at that nationality's price; typed details are kept.
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
  const policy = async (path: '/privacy'|'/terms') => {
    try { await WebBrowser.openBrowserAsync(websiteUrl(path), { toolbarColor: colors.navy }); } catch { /* The screen remains usable. */ }
  };
  return <CheckoutContents session={session} readSelection={state.getCheckoutReview} identityKey={`${status}:${sessionRevision}`}
    signedIn={status === 'signedIn'} creationEnabled={nativeCreationPolicy()} onFreshOffer={freshOffer}
    onSignIn={() => router.navigate({ pathname: '/account', params: { returnTo: '/checkout' } })} onSupport={() => router.push('/support')} onWebsite={openWebsite}
    onPayment={openPayment} onClearCompleted={clearCompleted} onPrivacy={() => void policy('/privacy')} onTerms={() => void policy('/terms')}
    onTravelerDirty={setDirty} onNationalityChange={changeNationality}/>;
}

export interface CheckoutContentsProps {
  session: CheckoutController; readSelection: () => CheckoutSelection | null; identityKey: string;
  signedIn: boolean; creationEnabled: boolean; onFreshOffer: () => void; onSignIn: () => void; onSupport: () => void;
  onWebsite: () => Promise<boolean>; onPayment: () => Promise<boolean>; onClearCompleted: () => Promise<boolean>;
  onPrivacy: () => void; onTerms: () => void; onTravelerDirty?: (dirty: boolean) => void;
  onNationalityChange?: (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => void;
}

// An ordinary presentation seam for an isolated fixture entry. The shipped
// route always supplies the real guarded controller above; no URL/storage flag
// can enable payment creation or inject this controller into the application.
export function CheckoutContents(props: CheckoutContentsProps) {
  const charge = useChargeMoney();
  const { session, signedIn, creationEnabled } = props;
  const { language } = useLanguage(), copy = checkoutCopy(language);
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
  const perform = async (kind: 'website'|'payment'|'clear', action: () => Promise<boolean>) => {
    if (opening) return; setOpening(true); setActionError(null);
    try { if (!await action()) setActionError(kind); } catch { setActionError(kind); }
    finally { setOpening(false); }
  };
  // Presentation copies deliberately omit every hash/context/capability.
  const offer: RoomOffer | null = selected ? { id: 'display-only', bookHash: '', images: [],
    name: selected.review.offer.name, meal: selected.review.offer.meal, noChildMeal: selected.review.offer.noChildMeal,
    price: selected.review.offer.price, taxes: selected.review.offer.taxes, cancellation: selected.review.offer.cancellation } : null;
  const existing = session.hasRecovery || session.attempt !== null;
  return <SafeAreaView edges={['top','bottom']} style={ui.screen}>
    <BrandHeader back/>
    <KeyboardAvoidingView style={{ flex: 1 }} enabled={Platform.OS !== 'web'} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} contentContainerStyle={ui.page}>
        <View style={{ gap: 6 }}><Txt kind="title" accessibilityRole="header">{copy.title}</Txt><Txt>{copy.intro}</Txt></View>
        {existing ? <>
          <Notice tone="info" icon="shield" title={copy.recovery} body={copy.recoveryBody}/>
          {session.phase === 'unknown' && <StatePanel icon="hourglass" tone="warning" title={copy.unknown} body={copy.unknownBody}/>}
          {session.attempt ? <View style={ui.card} accessibilityLiveRegion="polite">
            {session.error && <Badge tone="warning" icon="history" label={copy.lastKnown}/>}
            <CheckoutProgress status={session.attempt.status}/>
            <Txt kind="heading" accessibilityRole="header">{checkoutStatusCopy(language,session.attempt.status)[0]}</Txt>
            <Txt>{checkoutStatusCopy(language,session.attempt.status)[1]}</Txt>
            <Txt kind="label">{copy.reference}</Txt><Txt selectable style={{ writingDirection: 'ltr' }}>{session.attempt.reference}</Txt>
            {session.attempt.confirmed && session.attempt.supplierReference && <><Txt kind="label">{copy.supplierReference}</Txt><Txt selectable style={{ writingDirection: 'ltr' }}>{session.attempt.supplierReference}</Txt></>}
            {session.attempt.confirmed && session.attempt.voucherDelivery && <Txt>{session.attempt.voucherDelivery === 'sent' ? copy.voucherSent : session.attempt.voucherDelivery === 'review' ? copy.voucherReview : copy.voucherPending}</Txt>}
            {/* The confirmed booking is saved under the checkout reference; the server checks ownership and confirmation again. */}
            {session.attempt.confirmed && <VoucherButton booking={{ reference: session.attempt.reference, hotelName: null, roomName: null, checkin: null, checkout: null,
              recordedStatus: 'active', supplierStatus: 'CONFIRMED', statusKind: 'confirmed', price: null }}/>}
          </View> : <StatePanel title={copy.checking} body={copy.unknownBody} busy={busy}/>}
          {session.error && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.statusError}</Txt>}
          {session.attempt?.status === 'awaiting_payment' && creationEnabled && <Button title={copy.openPayment} busy={opening} disabled={busy} onPress={() => void perform('payment',props.onPayment)}/>}
          {actionError === 'payment' && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.paymentLinkError}</Txt>}
          <Button title={copy.refresh} busy={busy} variant="secondary" disabled={opening} onPress={() => void (session.attempt ? session.refreshStatus() : session.recover())}/>
          <Button title={copy.support} variant="quiet" onPress={props.onSupport}/>
          {session.canClearCompleted && <Button title={copy.clear} variant="secondary" disabled={opening || busy} onPress={() => void perform('clear',props.onClearCompleted)}/>}
          {actionError === 'clear' && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.clearError}</Txt>}
        </> : !selected || !offer ? <><StatePanel title={copy.missing} body={copy.missingBody}/><Button title={copy.fresh} onPress={props.onFreshOffer}/></> : <>
          <View style={[ui.card, { padding: 16, gap: 9 }]}>
            <Txt kind="heading" accessibilityRole="header">{selected.review.hotelName}</Txt><Txt>{localizedRoomName(offer.name, language)}</Txt>
            <MealBadge offer={offer}/>
            <Txt kind="small" style={{ writingDirection: 'ltr' }}>{selected.review.criteria.checkin} → {selected.review.criteria.checkout}</Txt>
            <Txt kind="small">{selected.review.criteria.guests.map((room,i)=>`${copy.room(i+1)}: ${room.adults + room.children.length}`).join(' · ')}</Txt>
            <Txt kind="label">{copy.offer}</Txt><MoneyText large money={charge(offer.price)}/>
            {session.quote && <><View style={ui.rule}/><Txt kind="label" style={{ color: colors.blueStrong }}>{copy.charge}</Txt><MoneyText large money={{ amount: session.quote.amount, currency: session.quote.currency }}/><Txt kind="small">{copy.sameCurrency}</Txt></>}
            <Txt kind="small">{copy.notReserved}</Txt>
            <View style={ui.rule}/>
            <Taxes taxes={offer.taxes}/>
          </View>
          {!creationEnabled && <View style={[ui.card, { backgroundColor: colors.softGold }]}><Txt kind="heading" accessibilityRole="header">{copy.gateOff}</Txt><Txt>{copy.gateOffBody}</Txt></View>}
          {!signedIn ? <><StatePanel title={copy.signIn} body={copy.signInBody}/><Button title={copy.signIn} variant="secondary" onPress={props.onSignIn}/></> : <>
            {session.availability && !session.availability.enabled && <View style={{ gap: 8 }}><Txt kind="label">{copy.unavailable}</Txt><Txt kind="small">{copy.unavailableBody}</Txt></View>}
            {session.availability?.enabled && session.availability.mode === 'sandbox' && <Txt kind="caption">{copy.sandbox}</Txt>}
            {!session.quote && !session.error && session.availability?.enabled !== false && <StatePanel busy title={copy.quoteBusy}/>}
            {session.error && <View style={{ gap: 8 }}><Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.quoteError}</Txt>
              <Button title={language === 'ar' ? 'أعد المحاولة' : 'Try again'} variant="secondary" busy={busy} disabled={opening}
                onPress={() => void (session.availability?.enabled ? session.requestQuote() : session.loadAvailability())}/></View>}
          </>}
          {creationEnabled && session.canCollectTravelers && session.quote && <CheckoutTravelerForm key={`${props.identityKey}:${selected.selectionId}`}
            draftKey={`${props.identityKey}:${selected.selectionId}`} onDirty={props.onTravelerDirty}
            occupancy={selected.review.criteria.guests} quote={session.quote} canSubmit={session.canSubmit}
            residency={selected.review.criteria.residency} onNationalityChange={props.onNationalityChange}
            onSubmit={(data,consent)=>{ submitted.current = true; return session.submit(data,consent); }} onPrivacy={props.onPrivacy} onTerms={props.onTerms}/>}
          <View style={ui.card}><Cancellation offer={offer}/></View>
          {/* In-app checkout keeps the whole booking in the app; the website is only the fallback when it is off. */}
          {!creationEnabled && <View style={[ui.card, { backgroundColor: colors.softBlue }]}><Txt kind="heading" accessibilityRole="header">{copy.website}</Txt><Txt>{copy.websiteBody}</Txt>
            {actionError === 'website' && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.websiteError}</Txt>}
            <Button title={copy.website} busy={opening} disabled={busy || signedIn && !session.recoveryChecked} onPress={() => void perform('website',props.onWebsite)}/>
          </View>}
          <Button title={copy.fresh} variant="quiet" disabled={busy || opening} onPress={props.onFreshOffer}/>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function CheckoutTravelerForm({ occupancy, quote, canSubmit, onSubmit, onPrivacy, onTerms, draftKey, onDirty, residency, onNationalityChange }: {
  occupancy: GuestRoom[]; quote: CheckoutQuoteView; canSubmit: boolean; draftKey?: string; onDirty?: (dirty: boolean) => void;
  residency?: string; onNationalityChange?: (residency: string, draft: TravelerDraft, occupancy: GuestRoom[]) => void;
  onSubmit: (data: CheckoutGuestData, consent: boolean) => Promise<void>; onPrivacy: () => void; onTerms: () => void;
}) {
  const { language, t } = useLanguage(), copy = checkoutCopy(language), ar = language === 'ar';
  const [draft,storeDraft] = useState(() => (draftKey && travelerDrafts.get(draftKey)) || takeCarriedTraveler(occupancy) || createTravelerDraft(occupancy));
  useEffect(() => { if (draftKey && travelerDrafts.has(draftKey)) onDirty?.(true); }, [draftKey, onDirty]);
  // Required: the guest chooses it here. It starts empty so it is never assumed.
  const [nationality,setNationality] = useState('');
  const [nationalityMissing,setNationalityMissing] = useState(false);
  const [picker,showPicker] = useState(false);
  const repricing = Boolean(residency && nationality && nationality !== residency);
  const setDraft = (next: NonNullable<typeof draft>) => { storeDraft(next); if (draftKey) travelerDrafts.set(draftKey, next); carriedTraveler.set('latest', { occupancy: JSON.stringify(occupancy), draft: next }); onDirty?.(true); };
  const [errors,setErrors] = useState<Record<string,TravelerError>>({});
  const [step,setStep] = useState<'details'|'review'>('details');
  const [consent,setConsent] = useState({ quote, accepted: false });
  const accepted = consent.quote === quote && consent.accepted;
  if (!draft) return <StatePanel title={copy.invalidOccupancy}/>;
  const error = (key: string) => { const code=errors[key]; return !code ? undefined : code === 'required' ? copy.errorRequired : code === 'name' ? copy.errorName : code === 'email' ? copy.errorEmail : code === 'phone' ? copy.errorPhone : code === 'requests' ? copy.errorRequests : copy.invalidOccupancy; };
  const contact = (key: keyof typeof draft.guest, value: string) => { setDraft({ ...draft,guest:{...draft.guest,[key]:value} }); setErrors(current=>{const next={...current};delete next[key];return next;}); };
  const traveler = (r: number,p: number,key: 'firstName'|'lastName',value: string) => { setDraft({ ...draft, rooms:draft.rooms.map((room,ri)=>ri===r?{guests:room.guests.map((person,pi)=>pi===p?{...person,[key]:value}:person)}:room) }); setErrors(current=>{const next={...current};delete next[`traveler-${r}-${p}-${key}`];return next;}); };
  const review = () => { const checked=validateTravelerDraft(draft,occupancy);setErrors(checked.errors);const missing=Boolean(residency&&!nationality);setNationalityMissing(missing);if(checked.data&&!missing){Keyboard.dismiss();setConsent({quote,accepted:false});setStep('review');} };
  const submit = () => { const checked=validateTravelerDraft(draft,occupancy);setErrors(checked.errors);if(checked.data&&accepted&&canSubmit)void onSubmit(checked.data,true).then(()=>{if(draftKey)travelerDrafts.delete(draftKey);carriedTraveler.delete('latest');onDirty?.(false);}); };
  const prepared=step==='review'?validateTravelerDraft(draft,occupancy).data:null;
  return <View style={[ui.card, { gap: 18 }]}>
    <Txt kind="heading" accessibilityRole="header">{step==='details'?copy.details:copy.review}</Txt>
    <Txt kind="small">{step==='details'?copy.detailsBody:copy.formNote}</Txt>
    {Object.keys(errors).length>0&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{errors.occupancy?copy.invalidOccupancy:copy.fieldsError}</Txt>}
    {step==='details'?<>
      <Txt kind="label">{copy.lead}</Txt>
      <Field label={copy.firstName} value={draft.guest.firstName} maxLength={100} autoCorrect={false} autoCapitalize="words" autoComplete="given-name" error={error('firstName')} onChangeText={v=>contact('firstName',v)}/>
      <Field label={copy.lastName} value={draft.guest.lastName} maxLength={100} autoCorrect={false} autoCapitalize="words" autoComplete="family-name" error={error('lastName')} onChangeText={v=>contact('lastName',v)}/>
      <Field label={copy.email} value={draft.guest.email} maxLength={254} ltr autoCorrect={false} autoCapitalize="none" autoComplete="email" keyboardType="email-address" error={error('email')} onChangeText={v=>contact('email',v)}/>
      <Field label={copy.phone} value={draft.guest.phone} maxLength={40} ltr autoComplete="tel" keyboardType="phone-pad" accessibilityHint={copy.phoneHint} error={error('phone')} onChangeText={v=>contact('phone',v)}/>
      {residency && <View style={{gap:6}}>
        <Txt kind="label">{t('residency')}</Txt>
        <Pressable testID="checkout-nationality" accessibilityRole="button" accessibilityLabel={`${t('residency')}: ${nationality ? countryName(nationality, language) : t('residencyChoose')}`} onPress={()=>{Keyboard.dismiss();showPicker(true);}}
          style={{minHeight:52,borderWidth:1,borderColor:nationalityMissing?color.danger:repricing?color.warning:colors.border,borderRadius:14,paddingHorizontal:14,justifyContent:'center',backgroundColor:colors.surface}}>
          <Row style={{justifyContent:'space-between'}}><View style={{flex:1}}>{nationality ? <><Txt kind="label">{countryName(nationality, language)}</Txt><Txt kind="caption">{countryNameSecondary(nationality, language)}</Txt></> : <Txt tone="secondary">{t('residencyChoose')}</Txt>}</View><Icon name="chevronDown" size={18}/></Row>
        </Pressable>
        {nationalityMissing && <Txt kind="small" accessibilityRole="alert" style={{color:colors.red}}>{t('residencyError')}</Txt>}
        <Txt kind="small">{t('residencyNote')}</Txt>
        {repricing && <Notice tone="warning" title={ar ? 'نعيد فحص السعر لهذه الجنسية' : 'Check the price for this nationality'}
          body={ar ? `السعر الحالي محسوب لجنسية ${countryName(residency, language)}. قد يختلف السعر أو التوفر لجنسية ${countryName(nationality, language)}، فاختر الغرفة مجدداً بالسعر الصحيح. ستبقى البيانات التي كتبتها.` : `This price is for ${countryName(residency, language)} nationals. The price or availability may differ for ${countryName(nationality, language)}, so choose the room again at the right price. Your details are kept.`}/>}
        {repricing && <Button title={ar ? 'اعرض الأسعار لهذه الجنسية' : 'Show prices for this nationality'} onPress={()=>onNationalityChange?.(nationality, draft, occupancy)}/>}
        <CountryPicker visible={picker} value={nationality} title={t('residency')} onClose={()=>showPicker(false)} onChange={code=>{setNationality(code);setNationalityMissing(false);onDirty?.(true);}}/>
      </View>}
      {draft.rooms.map((room,r)=><View key={r} style={{gap:14}}><Txt kind="heading">{copy.room(r+1)}</Txt>{room.guests.map((person,p)=><View key={p} style={{gap:10}}><Txt kind="label">{copy.traveler(p+1,person.is_child,person.age)}</Txt>{r===0&&p===0?<Txt kind="small">{copy.leadUsed}</Txt>:<>
        <Field label={`${copy.firstName} · ${copy.room(r+1)} · ${copy.traveler(p+1,person.is_child,person.age)}`} value={person.firstName} maxLength={100} autoCorrect={false} autoCapitalize="words" error={error(`traveler-${r}-${p}-firstName`)} onChangeText={v=>traveler(r,p,'firstName',v)}/>
        <Field label={`${copy.lastName} · ${copy.room(r+1)} · ${copy.traveler(p+1,person.is_child,person.age)}`} value={person.lastName} maxLength={100} autoCorrect={false} autoCapitalize="words" error={error(`traveler-${r}-${p}-lastName`)} onChangeText={v=>traveler(r,p,'lastName',v)}/>
      </>}</View>)}</View>)}
      <Field label={copy.requests} value={draft.guest.specialRequests} multiline numberOfLines={3} maxLength={1000} style={{minHeight:100,textAlignVertical:'top'}} accessibilityHint={copy.requestsHint} error={error('specialRequests')} onChangeText={v=>contact('specialRequests',v)}/>
      <Txt kind="small">{copy.requestsHint}</Txt><Button title={copy.reviewDetails} disabled={repricing} onPress={review}/>
    </>:prepared?<>
      <Txt kind="label">{copy.charge}</Txt><MoneyText large money={{amount:quote.amount,currency:quote.currency}}/>
      <Txt>{prepared.guest.firstName} {prepared.guest.lastName}</Txt>{residency && <Txt>{t('residency')}: {countryName(residency, language)} · {countryNameSecondary(residency, language)}</Txt>}<Txt style={{writingDirection:'ltr'}}>{prepared.guest.email}</Txt><Txt style={{writingDirection:'ltr'}}>{prepared.guest.phone}</Txt>
      {prepared.rooms.map((room,r)=><View key={r} style={{gap:6}}><Txt kind="label">{copy.room(r+1)}</Txt>{room.guests.map((p,i)=><Txt key={i}>{copy.traveler(i+1,p.is_child,p.age)}: {p.firstName} {p.lastName}</Txt>)}</View>)}
      {prepared.guest.specialRequests&&<Txt>{copy.requests}: {prepared.guest.specialRequests}</Txt>}
      <Button title={copy.edit} variant="quiet" onPress={()=>{setConsent({quote,accepted:false});setStep('details');}}/>
      <Pressable accessibilityRole="checkbox" aria-checked={accepted} accessibilityState={{checked:accepted}} onPress={()=>setConsent({quote,accepted:!accepted})} style={{minHeight:48,borderWidth:1,borderColor:accepted?colors.blueStrong:colors.border,borderRadius:14,padding:14,backgroundColor:accepted?colors.softBlue:colors.background}}>
        <Row style={{alignItems:'flex-start'}}><View accessible={false} style={{width:22,height:22,borderRadius:5,borderWidth:2,borderColor:colors.blueStrong,backgroundColor:accepted?colors.blueStrong:colors.surface,marginTop:2}}/><Txt style={{flex:1,fontFamily:fonts.medium}}>{copy.consent}</Txt></Row>
      </Pressable>
      {!accepted&&<Txt kind="small">{copy.consentRequired}</Txt>}
      <Row style={{flexWrap:'wrap'}}><Button compact title={copy.privacy} variant="quiet" onPress={onPrivacy}/><Button compact title={copy.terms} variant="quiet" onPress={onTerms}/></Row>
      <Button title={copy.create} disabled={!accepted||!canSubmit} onPress={submit}/>
    </>:null}
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
