import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
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
import Cancellation from '../components/Cancellation';

type ReviewSession = ReturnType<typeof useReviewSession>;

export default function ReviewScreen() {
  const session = useReviewSession();
  return <ReviewContents key={session.draft?.id || 'missing'} session={session}/>;
}

function ReviewContents({ session }: { session: ReviewSession }) {
  const { draft, status, currentOffer, error, changesAccepted, canRecheck, canContinue, recheck, acceptChanges, clear, getHandoff } = session;
  const { t, language } = useLanguage();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [handoffError, setHandoffError] = useState(false);
  const [handoffExpired, setHandoffExpired] = useState(false);
  const offer = currentOffer || draft?.offer;
  const checked = Boolean(currentOffer && (status === 'ready' || status === 'changed'));
  const expired = status === 'expired' || handoffExpired;
  const recheckOffer = () => { setHandoffError(false); setHandoffExpired(false); void recheck(); };
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
  const membershipError = error instanceof ApiError && error.kind === 'membership';
  const nights = draft ? Math.round((Date.parse(`${draft.criteria.checkout}T00:00:00Z`) - Date.parse(`${draft.criteria.checkin}T00:00:00Z`)) / 86400000) : 0;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/><EnvironmentBanner/>
    <ScrollView contentContainerStyle={ui.page}>
      <View style={{ gap: 8 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('reviewNoReservation')}</Txt><Txt accessibilityRole="header" kind="title">{t('reviewTitle')}</Txt><Txt style={{ color: colors.muted }}>{t('reviewBody')}</Txt></View>
      {!draft || !offer ? <><StatePanel title={t('reviewMissingTitle')} body={t('reviewMissingBody')}/><Button title={t('search')} onPress={() => router.replace('/')}/></> : <>
        {expired && <StatePanel title={t('reviewExpiredTitle')} body={t('reviewExpiredBody')}/>}
        {status === 'pending' && <View accessibilityLiveRegion="polite"><StatePanel title={t('reviewChecking')} body={t('reviewNoReservation')} busy/></View>}
        {status === 'error' && (membershipError ? <ApiState error={error} retry={recheckOffer}/> : <View accessibilityLiveRegion="polite"><StatePanel title={t('reviewErrorTitle')} body={t(error instanceof ApiError && error.status === 429 ? 'rateLimited' : 'reviewErrorBody')}/></View>)}
        {checked && !expired && <View style={[ui.card, { backgroundColor: colors.softBlue, borderColor: '#B8DCE1' }]} accessibilityLiveRegion="polite"><Txt kind="heading" accessibilityRole="header">{t('reviewChecked')}</Txt><Txt kind="small">{t('reviewCheckedBody')}</Txt></View>}
        <View style={[ui.card, { padding: 0, overflow: 'hidden', gap: 0 }]}>
          <Photo uri={draft.hotelImage} label={draft.hotelName} height={160}/>
          <View style={{ padding: 20, gap: 8 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('reviewStay')}</Txt><Txt kind="heading" accessibilityRole="header">{draft.hotelName}</Txt>{draft.hotelAddress && <Txt kind="small">{draft.hotelAddress}</Txt>}</View>
        </View>
        <View style={ui.card}>
          <Row style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 5 }}><Txt kind="label">{t('checkin')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{draft.criteria.checkin}</Txt></View><View style={{ flex: 1, gap: 5 }}><Txt kind="label">{t('checkout')}</Txt><Txt style={{ writingDirection: 'ltr' }}>{draft.criteria.checkout}</Txt></View></Row>
          <View style={ui.rule}/><Txt kind="small">{nights} {t('nights')} · {draft.criteria.guests.length} {t('rooms')}</Txt>
          {draft.criteria.guests.map((room, index) => <View key={index} style={{ gap: 4 }}><Txt kind="label">{t('room')} {index + 1}</Txt><Txt kind="small">{room.adults} {t('adults')} · {room.children.length} {t('children')}</Txt>{room.children.length > 0 && <Txt kind="small">{t('childAge')}: {room.children.join(' · ')} {t('years')}</Txt>}</View>)}
          <Txt kind="small">{t('residency')}: {draft.criteria.residency.toUpperCase()}</Txt>
        </View>
        <View style={[ui.card, { padding: 0, overflow: 'hidden', gap: 0 }]}>
          <Photo uri={offer.images[0] || draft.offer.images[0]} room label={offer.name} height={180}/>
          <View style={{ padding: 20, gap: 18 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('reviewRoom')}</Txt><Txt kind="heading" accessibilityRole="header">{offer.name}</Txt><Txt kind="small">{t('meal')}: {offer.meal ? offer.meal === 'nomeal' ? t('roomOnly') : offer.meal.replace(/[-_]/g, ' ') : t('noMeal')}</Txt>
            {status === 'changed' && checked && !expired && <View style={{ gap: 7, padding: 16, borderRadius: 16, backgroundColor: colors.softGold }}><Txt kind="label">{t('reviewPreviousPrice')}</Txt><MoneyText money={draft.offer.price}/></View>}
            <View style={{ gap: 6 }}><Txt kind="label">{t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice')}</Txt><MoneyText large money={offer.price}/></View>
            <Taxes taxes={offer.taxes}/><Cancellation offer={offer}/>
          </View>
        </View>
        {status === 'changed' && checked && !expired && <View style={[ui.card, { backgroundColor: colors.softGold, borderColor: '#E6CFAC' }]} accessibilityLiveRegion="polite"><Txt kind="heading" accessibilityRole="header">{t('reviewChangedTitle')}</Txt><Txt>{t('reviewChangedBody')}</Txt>{changesAccepted ? <Txt style={{ color: colors.success, fontFamily: fonts.bold }}>{t('reviewChangesAccepted')}</Txt> : <Button title={t('reviewAcceptChanges')} variant="secondary" disabled={opening} onPress={acceptChanges}/>}</View>}
        {!expired && <View style={{ gap: 12 }}>{!checked && status !== 'pending' && <Txt kind="small">{t('reviewBeforeRecheck')}</Txt>}<Button title={t(status === 'pending' ? 'reviewChecking' : checked ? 'reviewCheckAgain' : 'reviewCheckPrice')} busy={status === 'pending'} disabled={!canRecheck || opening} onPress={recheckOffer}/></View>}
        <View style={[ui.card, { backgroundColor: colors.softBlue }]}><Txt kind="heading" accessibilityRole="header">{t('websiteTitle')}</Txt><Txt>{t('websiteBody')}</Txt><Txt style={{ fontFamily: fonts.medium }}>{t('reviewWebsiteReselect')}</Txt>{APP_ENV !== 'production' && <Txt kind="small" style={{ color: colors.goldInk }}>{t('websiteEnvironment')}</Txt>}{handoffError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('websiteError')}</Txt>}<Button title={t('websiteCta')} disabled={!canContinue || expired} busy={opening} onPress={() => void openWebsite()}/></View>
        <Button variant="quiet" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
