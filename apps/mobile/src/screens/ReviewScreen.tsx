import React, { useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, APP_ENV, bookingWebsiteUrl } from '../api';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useReviewSession } from '../components/useReviewSession';
import ApiState from '../components/ApiState';
import { Button, Icon, MoneyText, Photo, Row, StatePanel, Txt } from '../components/Primitives';
import Taxes from '../components/Taxes';
import { taxTermsKey } from '../components/offerReviewModel';
import { MealBadge } from '../components/RateHighlights';
import { rateCopy, roomPaymentLabel } from '../components/roomRateFacts';
import Cancellation from '../components/Cancellation';
import OfferChanges, { ExactReviewMoney } from '../components/OfferChanges';
import { useAppState } from '../components/AppState';
import { NATIVE_CHECKOUT_ENABLED } from '../api/config';

type ReviewSession = ReturnType<typeof useReviewSession>;

export default function ReviewScreen() {
  const session = useReviewSession();
  return <ReviewContents key={session.draft?.id || 'missing'} session={session}/>;
}

function ReviewContents({ session }: { session: ReviewSession }) {
  const { draft, status, currentOffer, error, changesAccepted, canRecheck, canContinue, recheck, acceptChanges, clear, getHandoff } = session;
  const { t, language } = useLanguage();
  const rateLabels = rateCopy(language);
  const state = useAppState();
  const router = useRouter();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const changeHeading = useRef<React.ComponentRef<typeof View>>(null);
  const panelTop = useRef(0);
  const [opening, setOpening] = useState(false);
  const [handoffError, setHandoffError] = useState(false);
  const [handoffExpired, setHandoffExpired] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const checkoutLabel = language === 'ar' ? 'عرض خيارات الحجز والدفع' : 'View booking and payment options';
  const offer = currentOffer || draft?.offer;
  const checked = Boolean(currentOffer && (status === 'ready' || status === 'changed'));
  const expired = status === 'expired' || handoffExpired;
  const showChanges = checked && status === 'changed' && !expired;
  const showRoomFees = Boolean(showChanges && draft && offer && taxTermsKey(draft.offer.taxes) === taxTermsKey(offer.taxes));
  const Price = showChanges ? ExactReviewMoney : MoneyText;
  const reviewChanges = () => {
    const heading = changeHeading.current;
    if (!heading) return;
    if (Platform.OS === 'web') heading.focus();
    else AccessibilityInfo.sendAccessibilityEvent(heading, 'focus');
    scroll.current?.scrollTo({ y: Math.max(0, panelTop.current - 8), animated: false });
  };
  const recheckOffer = () => {
    setHandoffError(false);
    setHandoffExpired(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
    void recheck();
  };
  const returnToOffers = () => {
    clear();
    if (draft) router.replace({ pathname: '/hotel/[hid]', params: { hid: String(draft.hid) } });
    else router.replace('/');
  };
  const openWebsite = async () => {
    if (opening) return;
    const handoff = getHandoff();
    if (!handoff) { setHandoffExpired(true); return; }
    setOpening(true);
    setHandoffError(false);
    try {
      await WebBrowser.openBrowserAsync(bookingWebsiteUrl(handoff.hid, handoff.criteria, language), { toolbarColor: colors.navy });
    } catch { setHandoffError(true); }
    finally { setOpening(false); }
  };
  const openCheckout = () => {
    if (!state.setCheckoutReviewAuthority(session.getCheckoutReview)) { setHandoffExpired(true); return; }
    router.push('/checkout');
  };
  const membershipError = error instanceof ApiError && error.kind === 'membership';
  const nights = draft ? Math.round((Date.parse(`${draft.criteria.checkout}T00:00:00Z`) - Date.parse(`${draft.criteria.checkin}T00:00:00Z`)) / 86400000) : 0;
  const rooms = draft?.criteria.guests.length || 0;
  const dateLabel = (iso: string) => {
    const date = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB',
      { day: 'numeric', month: 'short', year: 'numeric', calendar: 'gregory', timeZone: 'UTC' }) : iso;
  };
  const staySummary = language === 'ar' ? `الليالي: ${nights} · الغرف: ${rooms}`
    : `${nights} ${nights === 1 ? 'night' : 'nights'} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={ui.page}>
      <Txt accessibilityRole="header" kind="title">{t('reviewTitle')}</Txt>
      {!draft || !offer ? <><StatePanel title={t('reviewMissingTitle')} body={t('reviewMissingBody')}/><Button title={t('search')} onPress={() => router.replace('/')}/></> : <>
        <View style={ui.card} testID="review-stay-summary">
          <Row style={{ alignItems: 'center', gap: 12 }}>
            {offer.images.length > 0 && <View style={{ width: 68, borderRadius: 12, overflow: 'hidden' }}>
              <Photo alternatives={offer.images} room label={offer.name} height={70} thumbnail/>
            </View>}
            <View style={{ flex: 1, gap: 3 }}>
              <Txt accessibilityRole="header" kind="heading">{draft.hotelName}</Txt>
              <Txt style={{ fontFamily: fonts.medium }}>{offer.name}</Txt>
            </View>
          </Row>
          <View style={ui.rule}/>
          <Row style={{ gap: 8 }}><Icon name="calendar" size={18}/><Txt kind="small" style={{ flex: 1 }}>{dateLabel(draft.criteria.checkin)} – {dateLabel(draft.criteria.checkout)}</Txt></Row>
          <Row style={{ gap: 8 }}><Icon name="bed" size={18}/><Txt kind="small" style={{ flex: 1 }}>{staySummary}</Txt></Row>
          <MealBadge offer={offer}/>
          {(offer.bedding || draft.offer.bedding) && <Row style={{ gap: 8 }}><Icon name="bed" size={18}/><Txt testID="review-bedding" kind="small" style={{ flex: 1 }}>{rateLabels.bedding} · {offer.bedding || rateLabels.unknown}</Txt></Row>}
          <Row style={{ gap: 8 }}><Icon name="info" size={18}/><Txt testID="review-payment-channel" kind="small" style={{ flex: 1 }}>{rateLabels.payment} · {roomPaymentLabel(offer, language)}</Txt></Row>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} aria-expanded={detailsOpen}
            onPress={() => setDetailsOpen(open => !open)} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" style={{ flex: 1 }}>{language === 'ar' ? 'تفاصيل الإقامة والنزلاء' : 'Stay and guest details'}</Txt>
              <Txt accessible={false}>{detailsOpen ? '−' : '+'}</Txt>
            </Row>
          </Pressable>
          {detailsOpen && <View style={{ gap: 6 }}>
            {draft.hotelAddress && <Txt kind="small">{draft.hotelAddress}</Txt>}
            {draft.criteria.guests.map((room, index) => <View key={index}>
              <Txt kind="label">{t('room')} {index + 1}</Txt>
              <Txt kind="small">{room.adults} {t('adults')} · {room.children.length} {t('children')}</Txt>
              {room.children.length > 0 && <Txt kind="small">{t('childAge')}: {room.children.join(' · ')} {t('years')}</Txt>}
            </View>)}
            <Txt kind="small">{t('residency')}: {draft.criteria.residency.toUpperCase()}</Txt>
          </View>}
        </View>
        {showChanges ? <View onLayout={event => { panelTop.current = event.nativeEvent.layout.y; }}
          style={[ui.card, { backgroundColor: colors.softGold, borderColor: '#E6CFAC' }]}>
          <View ref={changeHeading} accessible accessibilityRole="header" accessibilityLabel={t('reviewChangedTitle')}
            accessibilityLiveRegion="polite" tabIndex={-1} collapsable={false}>
            <Txt kind="heading">{t('reviewChangedTitle')}</Txt>
          </View>
          <OfferChanges key={session.confirmationRevision} before={draft.offer} after={offer}/>
          {changesAccepted
            ? <Txt accessibilityLiveRegion="polite" style={{ color: colors.success, fontFamily: fonts.bold }}>{t('reviewChangesAccepted')}</Txt>
            : <Button title={t('reviewAcceptChanges')} disabled={opening} onPress={acceptChanges}/>}
          <Button compact variant="quiet" title={t('reviewRefreshOffers')} onPress={returnToOffers}/>
        </View> : <View style={[ui.card, { padding: 16, gap: 7, borderColor: colors.blueStrong }]}>
          <Txt kind="label">{t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice')}</Txt><MoneyText large money={offer.price}/>
          {checked && !expired && <Row style={{ gap: 6 }}><Icon name="check" size={17} color={colors.success}/><Txt accessibilityLiveRegion="polite" kind="small" style={{ color: colors.success, flex: 1 }}>{t('reviewChecked')}</Txt></Row>}
          <View style={ui.rule}/>
          <Taxes taxes={offer.taxes} mode={expired ? 'historical' : 'current'}/>
        </View>}
        {expired && <StatePanel title={t('reviewExpiredTitle')} body={t('reviewExpiredBody')}/>}
        {status === 'pending' && <Txt accessibilityLiveRegion="polite" kind="small">{t('reviewChecking')}</Txt>}
        {status === 'error' && (membershipError ? <ApiState error={error} retry={recheckOffer}/> : <View accessibilityLiveRegion="polite"><StatePanel title={t('reviewErrorTitle')} body={t(error instanceof ApiError && error.status === 429 ? 'rateLimited' : 'reviewErrorBody')}/></View>)}
        <View style={ui.card}>{showRoomFees && <Taxes taxes={offer.taxes}/>}<Cancellation offer={offer} mode={expired ? 'historical' : 'current'}/></View>
        {!expired && !checked && status !== 'pending' && <Txt kind="small">{t('reviewBeforeRecheck')}</Txt>}
        {!NATIVE_CHECKOUT_ENABLED && <View style={[ui.card, { backgroundColor: colors.softBlue }]}><Txt kind="heading" accessibilityRole="header">{t('websiteTitle')}</Txt><Txt>{t('websiteBody')}</Txt><Txt style={{ fontFamily: fonts.medium }}>{t('reviewWebsiteReselect')}</Txt>{APP_ENV !== 'production' && <Txt kind="small" style={{ color: colors.goldInk }}>{t('websiteEnvironment')}</Txt>}{handoffError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('websiteError')}</Txt>}<Button variant="secondary" title={checkoutLabel} disabled={!canContinue || expired || opening} onPress={openCheckout}/></View>}
        {checked && !expired && <Button compact variant="secondary" title={t('reviewCheckAgain')} disabled={!canRecheck || opening} onPress={recheckOffer}/>}
        {(!checked || showChanges || expired) && <Txt kind="small">{t('reviewNoReservation')}</Txt>}
        {!showChanges && <Button variant="quiet" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>}
      </>}
    </ScrollView>
    {draft && offer && <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={[ui.page, { paddingVertical: 9, paddingBottom: 9, gap: 0 }]}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <View style={{ flexGrow: 1, flexBasis: 120, flexShrink: 1, gap: 1 }}><Txt kind="small">{t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice')}</Txt><Price money={offer.price}/></View>
          <View style={{ flexGrow: 1, flexBasis: 156, flexShrink: 1 }}>{expired ? <Button variant="secondary" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>
            : showChanges && !changesAccepted ? <Button title={t('reviewSeeChanges')} variant="secondary" disabled={opening} onPress={reviewChanges}/>
              : canContinue ? <Button label={NATIVE_CHECKOUT_ENABLED ? checkoutLabel : t('websiteCta')} title={NATIVE_CHECKOUT_ENABLED ? (language === 'ar' ? 'متابعة الحجز' : 'Continue booking') : t('websiteCta')} busy={opening} onPress={() => NATIVE_CHECKOUT_ENABLED ? openCheckout() : void openWebsite()}/>
                : <Button title={t(status === 'pending' ? 'reviewChecking' : checked ? 'reviewCheckAgain' : 'reviewCheckPrice')} busy={status === 'pending'} disabled={!canRecheck || opening} onPress={recheckOffer}/>}</View>
        </Row>
      </View>
    </View>}
  </SafeAreaView>;
}
