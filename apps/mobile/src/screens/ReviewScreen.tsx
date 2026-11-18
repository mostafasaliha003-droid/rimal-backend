import React, { useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, APP_ENV, bookingWebsiteUrl } from '../api';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { useReviewSession } from '../components/useReviewSession';
import ApiState from '../components/ApiState';
import { Button, MoneyText, Photo, Row, StatePanel, Txt } from '../components/Primitives';
import Taxes from '../components/Taxes';
import { roomMealLabel } from '../components/roomChoiceModel';
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
  const state = useAppState();
  const router = useRouter();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const changeHeading = useRef<React.ComponentRef<typeof View>>(null);
  const panelTop = useRef(0);
  const [opening, setOpening] = useState(false);
  const [handoffError, setHandoffError] = useState(false);
  const [handoffExpired, setHandoffExpired] = useState(false);
  const checkoutLabel = language === 'ar' ? 'عرض خيارات الحجز والدفع' : 'View booking and payment options';
  const offer = currentOffer || draft?.offer;
  const checked = Boolean(currentOffer && (status === 'ready' || status === 'changed'));
  const expired = status === 'expired' || handoffExpired;
  const showChanges = checked && status === 'changed' && !expired;
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
  const staySummary = language === 'ar' ? `الليالي: ${nights} · الغرف: ${rooms}`
    : `${nights} ${nights === 1 ? 'night' : 'nights'} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/><EnvironmentBanner/>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={ui.page}>
      <View style={{ gap: 8 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('reviewNoReservation')}</Txt><Txt accessibilityRole="header" kind="title">{t('reviewTitle')}</Txt><Txt style={{ color: colors.muted }}>{t('reviewBody')}</Txt></View>
      {!draft || !offer ? <><StatePanel title={t('reviewMissingTitle')} body={t('reviewMissingBody')}/><Button title={t('search')} onPress={() => router.replace('/')}/></> : <>
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
          <Txt kind="small">{staySummary} · {t('reviewNoReservation')}</Txt>
        </View>}
        {expired && <StatePanel title={t('reviewExpiredTitle')} body={t('reviewExpiredBody')}/>}
        {status === 'pending' && <View accessibilityLiveRegion="polite"><StatePanel title={t('reviewChecking')} body={t('reviewNoReservation')} busy/></View>}
        {status === 'error' && (membershipError ? <ApiState error={error} retry={recheckOffer}/> : <View accessibilityLiveRegion="polite"><StatePanel title={t('reviewErrorTitle')} body={t(error instanceof ApiError && error.status === 429 ? 'rateLimited' : 'reviewErrorBody')}/></View>)}
        {checked && !expired && !showChanges && <View style={[ui.card, { backgroundColor: colors.softBlue, borderColor: '#B8DCE1' }]} accessibilityLiveRegion="polite"><Txt kind="heading" accessibilityRole="header">{t('reviewChecked')}</Txt><Txt kind="small">{t('reviewCheckedBody')}</Txt></View>}
        <View style={[ui.card, { padding: 0, overflow: 'hidden', gap: 0 }]}>
          <Photo uri={draft.hotelImage} label={draft.hotelName} height={160}/>
          <View style={{ padding: 20, gap: 8 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('reviewStay')}</Txt><Txt kind="heading" accessibilityRole="header">{draft.hotelName}</Txt>{draft.hotelAddress && <Txt kind="small">{draft.hotelAddress}</Txt>}</View>
        </View>
        <View style={ui.card}>
          <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 5 }}><Txt kind="label">{t('checkin')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{draft.criteria.checkin}</Txt></View><View style={{ flex: 1, gap: 5 }}><Txt kind="label">{t('checkout')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{draft.criteria.checkout}</Txt></View></Row>
          <View style={ui.rule}/><Txt kind="small">{staySummary}</Txt>
          {draft.criteria.guests.map((room, index) => <View key={index} style={{ gap: 4 }}><Txt kind="label">{t('room')} {index + 1}</Txt><Txt kind="small">{room.adults} {t('adults')} · {room.children.length} {t('children')}</Txt>{room.children.length > 0 && <Txt kind="small">{t('childAge')}: {room.children.join(' · ')} {t('years')}</Txt>}</View>)}
          <Txt kind="small">{t('residency')}: {draft.criteria.residency.toUpperCase()}</Txt>
        </View>
        <View style={[ui.card, { padding: 0, overflow: 'hidden', gap: 0 }]}>
          <Photo uri={offer.images[0] || draft.offer.images[0]} room label={offer.name} height={180}/>
          <View style={{ padding: 20, gap: 18 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('reviewRoom')}</Txt><Txt kind="heading" accessibilityRole="header">{offer.name}</Txt><Txt kind="small">{t('meal')}: {roomMealLabel(offer.meal, t('roomOnly'), t('noMeal'), language)}</Txt>
            <View style={{ gap: 6 }}><Txt kind="label">{t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice')}</Txt><Price large money={offer.price}/></View>
            <Taxes taxes={offer.taxes}/><Cancellation offer={offer} mode={expired ? 'historical' : 'current'}/>
          </View>
        </View>
        {!expired && !checked && status !== 'pending' && <Txt kind="small">{t('reviewBeforeRecheck')}</Txt>}
        <View style={[ui.card, { backgroundColor: colors.softBlue }]}><Txt kind="heading" accessibilityRole="header">{t('websiteTitle')}</Txt><Txt>{t('websiteBody')}</Txt><Txt style={{ fontFamily: fonts.medium }}>{t('reviewWebsiteReselect')}</Txt>{APP_ENV !== 'production' && <Txt kind="small" style={{ color: colors.goldInk }}>{t('websiteEnvironment')}</Txt>}{handoffError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('websiteError')}</Txt>}<Button variant="secondary" title={checkoutLabel} disabled={!canContinue || expired || opening} onPress={openCheckout}/></View>
        {!showChanges && <Button variant="quiet" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>}
      </>}
    </ScrollView>
    {draft && offer && <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={[ui.page, { paddingTop: 12, paddingBottom: 14, gap: 10 }]}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <View style={{ flexShrink: 1, gap: 3 }}><Txt kind="small">{t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice')}</Txt><Price money={offer.price}/></View>
          <View style={{ flex: 1, minWidth: 170 }}>{expired ? <Button variant="secondary" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>
            : showChanges && !changesAccepted ? <Button title={t('reviewSeeChanges')} variant="secondary" disabled={opening} onPress={reviewChanges}/>
              : canContinue ? <Button title={NATIVE_CHECKOUT_ENABLED ? checkoutLabel : t('websiteCta')} busy={opening} onPress={() => NATIVE_CHECKOUT_ENABLED ? openCheckout() : void openWebsite()}/>
                : <Button title={t(status === 'pending' ? 'reviewChecking' : checked ? 'reviewCheckAgain' : 'reviewCheckPrice')} busy={status === 'pending'} disabled={!canRecheck || opening} onPress={recheckOffer}/>}</View>
        </Row>
        {checked && !expired && <Button compact variant="quiet" title={t('reviewCheckAgain')} disabled={!canRecheck || opening} onPress={recheckOffer}/>}<Txt kind="small">{t('reviewNoReservation')}</Txt>
      </View>
    </View>}
  </SafeAreaView>;
}
