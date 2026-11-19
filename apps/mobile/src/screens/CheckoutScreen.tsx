import React, { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { authSession, bookingWebsiteUrl, websiteUrl } from '../api';
import { NATIVE_CHECKOUT_ENABLED } from '../api/config';
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
import StayEstimate from '../components/StayEstimate';
import { MealBadge } from '../components/RateHighlights';
import { checkoutCopy, checkoutStatusCopy } from './checkoutCopy';

const nativeCreationPolicy = () => NATIVE_CHECKOUT_ENABLED && Platform.OS !== 'web';
export type CheckoutController = ReturnType<typeof useCheckoutSession>;

export default function CheckoutScreen() {
  const state = useAppState(), router = useRouter(), { language } = useLanguage();
  const { status, sessionRevision } = useAuth();
  const session = useCheckoutSession({ getReview: state.getCheckoutReview, canCreate: nativeCreationPolicy });
  const freshOffer = () => {
    const draft = state.getReviewDraft();
    if (draft) router.replace({ pathname: '/hotel/[hid]', params: { hid: String(draft.hid) } });
    else router.replace('/');
  };
  const openWebsite = async () => {
    const current = state.getCheckoutReview();
    const currentAuth = authSession.getSnapshot().status;
    if (!current || currentAuth === 'loading' || currentAuth === 'signedIn' && !session.canOpenWebsite()) return false;
    try { await WebBrowser.openBrowserAsync(bookingWebsiteUrl(current.review.hid, current.review.criteria, language), { toolbarColor: colors.navy }); return true; }
    catch { return false; }
  };
  const openPayment = async () => {
    // Reconcile first. Browser return/dismissal is never payment evidence.
    await session.recover();
    const url = session.getPaymentHandoff();
    if (!url) return false;
    try { await WebBrowser.openBrowserAsync(url, { toolbarColor: colors.navy }); }
    catch { return false; }
    await session.refreshStatus(); return true;
  };
  const clearCompleted = async () => {
    if (!await session.clearCompleted()) return false;
    state.clearCheckoutReview(); state.clearReviewDraft(); router.replace('/'); return true;
  };
  const policy = async (path: '/privacy'|'/terms') => {
    try { await WebBrowser.openBrowserAsync(websiteUrl(path), { toolbarColor: colors.navy }); } catch { /* The screen remains usable. */ }
  };
  return <CheckoutContents session={session} readSelection={state.getCheckoutReview} identityKey={`${status}:${sessionRevision}`}
    signedIn={status === 'signedIn'} creationEnabled={nativeCreationPolicy()} onFreshOffer={freshOffer}
    onSignIn={() => router.navigate({ pathname: '/account', params: { returnTo: '/checkout' } })} onSupport={() => router.push('/support')} onWebsite={openWebsite}
    onPayment={openPayment} onClearCompleted={clearCompleted} onPrivacy={() => void policy('/privacy')} onTerms={() => void policy('/terms')}/>;
}

export interface CheckoutContentsProps {
  session: CheckoutController; readSelection: () => CheckoutSelection | null; identityKey: string;
  signedIn: boolean; creationEnabled: boolean; onFreshOffer: () => void; onSignIn: () => void; onSupport: () => void;
  onWebsite: () => Promise<boolean>; onPayment: () => Promise<boolean>; onClearCompleted: () => Promise<boolean>;
  onPrivacy: () => void; onTerms: () => void;
}

// An ordinary presentation seam for an isolated fixture entry. The shipped
// route always supplies the real guarded controller above; no URL/storage flag
// can enable payment creation or inject this controller into the application.
export function CheckoutContents(props: CheckoutContentsProps) {
  const { session, signedIn, creationEnabled } = props;
  const { language } = useLanguage(), copy = checkoutCopy(language);
  const selected = props.readSelection();
  const [opening, setOpening] = useState(false), [actionError, setActionError] = useState<'website'|'payment'|'clear'|null>(null);
  const busy = ['quoting','submitting','recovering'].includes(session.phase);
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
            <Txt kind="heading" accessibilityRole="header">{selected.review.hotelName}</Txt><Txt>{offer.name}</Txt>
            <MealBadge offer={offer}/>
            <Txt kind="small" style={{ writingDirection: 'ltr' }}>{selected.review.criteria.checkin} → {selected.review.criteria.checkout}</Txt>
            <Txt kind="small">{selected.review.criteria.guests.map((room,i)=>`${copy.room(i+1)}: ${room.adults + room.children.length}`).join(' · ')}</Txt>
            <Txt kind="label">{copy.offer}</Txt><MoneyText large money={offer.price}/><StayEstimate money={offer.price}/>
            {session.quote && <><View style={ui.rule}/><Txt kind="label" style={{ color: colors.blueStrong }}>{copy.charge}</Txt><MoneyText large money={{ amount: session.quote.amount, currency: session.quote.currency }}/><Txt kind="small">{copy.sameCurrency}</Txt></>}
            <Txt kind="small">{copy.notReserved}</Txt>
            <View style={ui.rule}/>
            <Taxes taxes={offer.taxes}/>
          </View>
          {!creationEnabled && <View style={[ui.card, { backgroundColor: colors.softGold }]}><Txt kind="heading" accessibilityRole="header">{copy.gateOff}</Txt><Txt>{copy.gateOffBody}</Txt></View>}
          {!signedIn ? <><StatePanel title={copy.signIn} body={copy.signInBody}/><Button title={copy.signIn} variant="secondary" onPress={props.onSignIn}/></> : <>
            {!session.recoveryChecked && <Button title={copy.refresh} variant="secondary" busy={session.phase === 'recovering'} disabled={opening} onPress={() => void session.recover()}/>}
            {session.availability && <View style={{ gap: 8 }}><Txt kind="label">{session.availability.enabled ? session.availability.mode === 'sandbox' ? copy.sandbox : copy.production : copy.unavailable}</Txt>{!session.availability.enabled && <Txt kind="small">{copy.unavailableBody}</Txt>}</View>}
            <Row style={{ flexWrap: 'wrap' }}><View style={{ flex: 1, minWidth: 160 }}><Button title={session.quote ? copy.quoteAgain : copy.quote} busy={session.phase === 'quoting'} disabled={!session.canQuote || opening} onPress={() => void session.requestQuote()}/></View><View style={{ flex: 1, minWidth: 160 }}><Button title={copy.readiness} variant="quiet" disabled={busy || opening} onPress={() => void session.loadAvailability()}/></View></Row>
            {session.error && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.quoteError}</Txt>}
          </>}
          <View style={ui.card}><Cancellation offer={offer}/></View>
          {creationEnabled && session.canCollectTravelers && session.quote && <CheckoutTravelerForm key={`${props.identityKey}:${selected.selectionId}`}
            occupancy={selected.review.criteria.guests} quote={session.quote} canSubmit={session.canSubmit}
            onSubmit={(data,consent)=>session.submit(data,consent)} onPrivacy={props.onPrivacy} onTerms={props.onTerms}/>}
          <View style={[ui.card, { backgroundColor: colors.softBlue }]}><Txt kind="heading" accessibilityRole="header">{copy.website}</Txt><Txt>{copy.websiteBody}</Txt>
            {actionError === 'website' && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{copy.websiteError}</Txt>}
            <Button title={copy.website} busy={opening} disabled={busy || signedIn && !session.recoveryChecked} onPress={() => void perform('website',props.onWebsite)}/>
          </View>
          <Button title={copy.fresh} variant="quiet" disabled={busy || opening} onPress={props.onFreshOffer}/>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function CheckoutTravelerForm({ occupancy, quote, canSubmit, onSubmit, onPrivacy, onTerms }: {
  occupancy: GuestRoom[]; quote: CheckoutQuoteView; canSubmit: boolean;
  onSubmit: (data: CheckoutGuestData, consent: boolean) => Promise<void>; onPrivacy: () => void; onTerms: () => void;
}) {
  const { language } = useLanguage(), copy = checkoutCopy(language);
  const [draft,setDraft] = useState(() => createTravelerDraft(occupancy));
  const [errors,setErrors] = useState<Record<string,TravelerError>>({});
  const [step,setStep] = useState<'details'|'review'>('details');
  const [consent,setConsent] = useState({ quote, accepted: false });
  const accepted = consent.quote === quote && consent.accepted;
  if (!draft) return <StatePanel title={copy.invalidOccupancy}/>;
  const error = (key: string) => { const code=errors[key]; return !code ? undefined : code === 'required' ? copy.errorRequired : code === 'name' ? copy.errorName : code === 'email' ? copy.errorEmail : code === 'phone' ? copy.errorPhone : code === 'requests' ? copy.errorRequests : copy.invalidOccupancy; };
  const contact = (key: keyof typeof draft.guest, value: string) => { setDraft({ ...draft,guest:{...draft.guest,[key]:value} }); setErrors(current=>{const next={...current};delete next[key];return next;}); };
  const traveler = (r: number,p: number,key: 'firstName'|'lastName',value: string) => { setDraft({ ...draft, rooms:draft.rooms.map((room,ri)=>ri===r?{guests:room.guests.map((person,pi)=>pi===p?{...person,[key]:value}:person)}:room) }); setErrors(current=>{const next={...current};delete next[`traveler-${r}-${p}-${key}`];return next;}); };
  const review = () => { const checked=validateTravelerDraft(draft,occupancy);setErrors(checked.errors);if(checked.data){Keyboard.dismiss();setConsent({quote,accepted:false});setStep('review');} };
  const submit = () => { const checked=validateTravelerDraft(draft,occupancy);setErrors(checked.errors);if(checked.data&&accepted&&canSubmit)void onSubmit(checked.data,true); };
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
      {draft.rooms.map((room,r)=><View key={r} style={{gap:14}}><Txt kind="heading">{copy.room(r+1)}</Txt>{room.guests.map((person,p)=><View key={p} style={{gap:10}}><Txt kind="label">{copy.traveler(p+1,person.is_child,person.age)}</Txt>{r===0&&p===0?<Txt kind="small">{copy.leadUsed}</Txt>:<>
        <Field label={`${copy.firstName} · ${copy.room(r+1)} · ${copy.traveler(p+1,person.is_child,person.age)}`} value={person.firstName} maxLength={100} autoCorrect={false} autoCapitalize="words" error={error(`traveler-${r}-${p}-firstName`)} onChangeText={v=>traveler(r,p,'firstName',v)}/>
        <Field label={`${copy.lastName} · ${copy.room(r+1)} · ${copy.traveler(p+1,person.is_child,person.age)}`} value={person.lastName} maxLength={100} autoCorrect={false} autoCapitalize="words" error={error(`traveler-${r}-${p}-lastName`)} onChangeText={v=>traveler(r,p,'lastName',v)}/>
      </>}</View>)}</View>)}
      <Field label={copy.requests} value={draft.guest.specialRequests} multiline numberOfLines={3} maxLength={1000} style={{minHeight:100,textAlignVertical:'top'}} accessibilityHint={copy.requestsHint} error={error('specialRequests')} onChangeText={v=>contact('specialRequests',v)}/>
      <Txt kind="small">{copy.requestsHint}</Txt><Button title={copy.reviewDetails} onPress={review}/>
    </>:prepared?<>
      <Txt kind="label">{copy.charge}</Txt><MoneyText large money={{amount:quote.amount,currency:quote.currency}}/>
      <Txt>{prepared.guest.firstName} {prepared.guest.lastName}</Txt><Txt style={{writingDirection:'ltr'}}>{prepared.guest.email}</Txt><Txt style={{writingDirection:'ltr'}}>{prepared.guest.phone}</Txt>
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
