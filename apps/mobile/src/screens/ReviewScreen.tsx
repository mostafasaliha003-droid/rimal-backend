import React, { useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, APP_ENV, bookingWebsiteUrl } from '../api';
import { useLanguage } from '../i18n';
import type { RoomOffer, SearchCriteria } from '../types';
import { color, elevation, fonts, layout, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useReviewSession } from '../components/useReviewSession';
import ApiState from '../components/ApiState';
import { ActionBar, Button, Card, Divider, Icon, InfoRow, Notice, Photo, Row, Sheet, StatePanel, TextLink, Txt } from '../components/Primitives';
import Taxes from '../components/Taxes';
import { taxTermsKey } from '../components/offerReviewModel';
import { mealDescription, rateCopy, roomPaymentLabel } from '../components/roomRateFacts';
import Cancellation from '../components/Cancellation';
import { useChargeCurrency, useChargeMoney } from '../components/ChargeCurrency';
import { currencyName } from '../components/currencyCatalog';
import type { DisplayMoney } from '../components/cancellationDecision';
import OfferChanges from '../components/OfferChanges';
import { useAppState } from '../components/AppState';
import { NATIVE_CHECKOUT_ENABLED } from '../api/config';
import { presentTaxes } from '../components/taxPresentationModel';
import { presentCancellation } from '../components/cancellationPresentationModel';
import { cancellationDecision } from '../components/cancellationDecision';
import { useCancellationClock } from '../components/useCancellationClock';
import { formatPrice, formatStayRange, formatWeekday, guestLine, nightsBetween, occupancy, roomLines, stayWords } from '../components/format';
import { useLayout } from '../components/motion';
import { localizedRoomName } from '../components/roomNameModel';

type ReviewSession = ReturnType<typeof useReviewSession>;

/** What the traveler pays now, what is due at the hotel, and which supplied taxes are already inside the price. */
function priceParts(offer: RoomOffer, display: DisplayMoney) {
  const taxes = presentTaxes(offer.taxes);
  const atProperty = taxes.excludedGroups.map(group => group.complete && group.subtotal ? formatPrice(group.subtotal) : null);
  return { payNow: formatPrice(offer.price && display(offer.price)), atProperty: atProperty.filter((value): value is string => Boolean(value)),
    atPropertyIncomplete: atProperty.some(value => !value) || taxes.unassignedExcluded.length > 0 || (taxes.hasExcluded && taxes.hasUnknown),
    included: taxes.rows.filter(row => row.inclusion === 'included').length, notSupplied: taxes.dataState === 'notSupplied' };
}

/** A label and its amount on one line; amounts read left-to-right inside Arabic. */
function Line({ label, value, strong = false, testID, caption }: { label: string; value: string; strong?: boolean; testID?: string; caption?: string }) {
  return <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }}>
    <View style={{ flexShrink: 1 }}>
      <Txt kind={strong ? 'label' : 'small'} tone="primary">{label}</Txt>
      {!!caption && <Txt kind="caption">{caption}</Txt>}
    </View>
    <Txt testID={testID} kind={strong ? 'subheading' : 'bodyStrong'} style={{ writingDirection: 'ltr', flexShrink: 0 }}>{value}</Txt>
  </Row>;
}

export default function ReviewScreen() {
  const session = useReviewSession();
  return <ReviewContents key={session.draft?.id || 'missing'} session={session}/>;
}

/*
 * One screen, two flat cards: what you are booking (stay, guests, room, cancellation) and
 * what you pay. Long details (the full cancellation schedule, every tax line) open in
 * sheets. The price and the next step stay in the bottom bar.
 */
function ReviewContents({ session }: { session: ReviewSession }) {
  const { draft, status, currentOffer, error, changesAccepted, canRecheck, canContinue, recheck, acceptChanges, clear, getHandoff } = session;
  const { t, language } = useLanguage();
  const ar = language === 'ar';
  const rateLabels = rateCopy(language);
  const state = useAppState();
  const router = useRouter();
  const { gutter, desktop } = useLayout();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const changeHeading = useRef<React.ComponentRef<typeof View>>(null);
  const panelTop = useRef(0);
  const [opening, setOpening] = useState(false);
  const [handoffError, setHandoffError] = useState(false);
  const [handoffExpired, setHandoffExpired] = useState(false);
  const [sheet, setSheet] = useState<'cancellation' | 'fees' | null>(null);
  const checkoutLabel = ar ? 'عرض خيارات الحجز والدفع' : 'View booking and payment options';
  const offer = currentOffer || draft?.offer;
  const checked = Boolean(currentOffer && (status === 'ready' || status === 'changed'));
  const expired = status === 'expired' || handoffExpired;
  const showChanges = checked && status === 'changed' && !expired;
  const showRoomFees = Boolean(showChanges && draft && offer && taxTermsKey(draft.offer.taxes) === taxTermsKey(offer.taxes));
  const cancellations = useMemo(() => offer ? [offer.cancellation] : [], [offer]);
  const clock = useCancellationClock(cancellations);
  const charge = useChargeMoney();
  const { code: payCode, selected: paySelected } = useChargeCurrency();
  const decision = useMemo(() => offer ? cancellationDecision(presentCancellation(offer.cancellation, clock), language, offer.price, charge) : null, [offer, clock, language, charge]);
  const money = useMemo(() => offer ? priceParts(offer, charge) : null, [offer, charge]);
  const payIn = ar ? `الدفع بـ${currencyName(payCode, 'ar')} (${payCode})` : `Paid in ${currencyName(payCode, 'en')} (${payCode})`;
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
      await WebBrowser.openBrowserAsync(bookingWebsiteUrl(handoff.hid, handoff.criteria, language, APP_ENV, paySelected), { toolbarColor: color.bgBrand });
    } catch { setHandoffError(true); }
    finally { setOpening(false); }
  };
  const openCheckout = () => {
    if (!state.setCheckoutReviewAuthority(session.getCheckoutReview)) { setHandoffExpired(true); return; }
    router.push('/checkout');
  };
  const membershipError = error instanceof ApiError && error.kind === 'membership';
  const criteria: SearchCriteria | undefined = draft?.criteria;
  const nights = criteria ? nightsBetween(criteria.checkin, criteria.checkout) : null;
  const words = stayWords(language);
  const count = criteria ? occupancy(criteria.guests) : null;
  const stayScope = criteria && count ? [nights ? words.nights(nights) : '', words.rooms(count.rooms)].filter(Boolean).join(ar ? '، ' : ', ') : '';
  const priceLabel = t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice');
  const atHotel = money?.atProperty.length ? (ar ? `+ ${money.atProperty.join(' + ')} تُدفع في الفندق` : `+ ${money.atProperty.join(' + ')} paid at the hotel`) : undefined;
  const cancelTone = decision?.kind === 'free' ? color.success : decision?.nonRefundable ? color.danger : color.textPrimary;
  const roomName = offer ? localizedRoomName(offer.name, language) : '';

  const footerAction = !draft || !offer ? null : expired ? <Button fill variant="secondary" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>
    : showChanges && !changesAccepted ? <Button fill testID="review-see-changes" icon="alert" title={t('reviewSeeChanges')} disabled={opening} onPress={reviewChanges}/>
      : canContinue ? <Button fill testID="review-continue" iconEnd="forward" label={NATIVE_CHECKOUT_ENABLED ? checkoutLabel : t('websiteCta')}
        title={NATIVE_CHECKOUT_ENABLED ? (ar ? 'متابعة تأكيد الحجز' : 'Continue to confirm booking') : (ar ? 'المتابعة إلى الحجز' : 'Continue to booking')} busy={opening}
        onPress={() => NATIVE_CHECKOUT_ENABLED ? openCheckout() : void openWebsite()}/>
        : <Button fill testID="review-check-price" title={t(status === 'pending' ? 'reviewChecking' : checked ? 'reviewCheckAgain' : 'reviewCheckPrice')}
          busy={status === 'pending'} disabled={!canRecheck || opening} onPress={recheckOffer}/>;

  // One quiet line under the title says where the offer stands; only a change gets a coloured panel.
  const statusLine = !draft || !offer || expired || showChanges ? null : status === 'pending'
    ? <Row style={{ gap: space.xs }}><ActivityIndicator size="small" color={color.interactive}/><Txt kind="small" accessibilityLiveRegion="polite">{t('reviewChecking')}</Txt></Row>
    : checked ? <Row testID="review-checked" style={{ gap: space.xs }}><Icon name="checkCircle" size={16} color={color.success}/>
      <Txt kind="small" tone="success" accessibilityLiveRegion="polite" style={{ fontFamily: fonts.medium }}>{t('reviewChecked')}</Txt></Row>
      : <Txt kind="small">{t('reviewBeforeRecheck')}</Txt>;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={[styles.page, { paddingHorizontal: gutter, maxWidth: desktop ? 1040 : layout.maxReading }]}>
      <View style={{ gap: space.xxs }}>
        <Txt accessibilityRole="header" kind="heading">{ar ? 'راجع حجزك' : 'Review your booking'}</Txt>
        {statusLine}
      </View>
      {!draft || !offer || !criteria || !money || !decision ? <><StatePanel icon="bed" title={t('reviewMissingTitle')} body={t('reviewMissingBody')}/>
        <Button title={t('search')} onPress={() => router.replace('/')}/></> : <View style={desktop ? [styles.columns, { flexDirection: ar ? 'row-reverse' : 'row' }] : { gap: space.md }}>
        <View style={{ gap: space.md, flex: desktop ? 1.4 : undefined, minWidth: 0 }}>
          {showChanges && <View onLayout={event => { panelTop.current = event.nativeEvent.layout.y; }}
            style={[styles.changes, elevation.card]}>
            <View ref={changeHeading} accessible accessibilityRole="header" accessibilityLabel={t('reviewChangedTitle')}
              accessibilityLiveRegion="polite" tabIndex={-1} collapsable={false}>
              <Row style={{ gap: space.sm }}><Icon name="alert" size={20} color={color.warning}/><Txt kind="subheading">{t('reviewChangedTitle')}</Txt></Row>
            </View>
            <Txt kind="small" tone="primary">{t('reviewChangedBody')}</Txt>
            <OfferChanges key={session.confirmationRevision} before={draft.offer} after={offer}/>
            {changesAccepted
              ? <Notice tone="success" live title={t('reviewChangesAccepted')}/>
              : <Button testID="review-accept-changes" title={t('reviewAcceptChanges')} disabled={opening} onPress={acceptChanges}/>}
            <Button compact variant="quiet" title={t('reviewRefreshOffers')} onPress={returnToOffers}/>
          </View>}

          <Card testID="review-answers" style={styles.card}>
            <Row style={{ alignItems: 'center', gap: space.md }}>
              {(offer.images.length > 0 || draft.hotelImage) && <View style={styles.thumb}>
                <Photo uri={offer.images[0] || draft.hotelImage} alternatives={offer.images} room label={roomName} height={64} thumbnail/>
              </View>}
              <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
                <Txt accessibilityRole="header" kind="subheading" numberOfLines={2}>{draft.hotelName}</Txt>
                {draft.hotelAddress && <Txt kind="caption" numberOfLines={1}>{draft.hotelAddress}</Txt>}
              </View>
            </Row>
            <Divider/>
            <View testID="review-stay-summary" style={{ gap: space.md }}>
              <InfoRow icon="calendar">
                <Txt kind="bodyStrong">{formatStayRange(criteria.checkin, criteria.checkout, language)}{nights ? ` · ${words.nights(nights)}` : ''}</Txt>
                <Txt kind="caption">{`${t('checkin')} ${formatWeekday(criteria.checkin, language)} · ${t('checkout')} ${formatWeekday(criteria.checkout, language)}`}</Txt>
              </InfoRow>
              <InfoRow icon="users" testID="review-guests">
                <Txt kind="bodyStrong">{guestLine(criteria.guests, language)}</Txt>
                {(criteria.guests.length > 1 || (count?.children ?? 0) > 0) && roomLines(criteria.guests, language).map(line => <Txt key={line} kind="caption">{line}</Txt>)}
              </InfoRow>
              <InfoRow icon="bed">
                <Txt kind="bodyStrong">{roomName}</Txt>
                {roomName !== offer.name && <Txt kind="caption" style={{ writingDirection: 'ltr' }}>{offer.name}</Txt>}
                <Txt kind="small" tone="primary">{mealDescription(offer, language)}</Txt>
                {(offer.bedding || draft.offer.bedding) && <Txt testID="review-bedding" kind="caption">{rateLabels.bedding}: {offer.bedding || rateLabels.unknown}</Txt>}
              </InfoRow>
              <InfoRow icon={decision.kind === 'free' ? 'checkCircle' : decision.nonRefundable ? 'alertCircle' : 'clock'} tone={cancelTone} testID="review-cancellation">
                <Txt kind="label" style={{ color: cancelTone }}>{decision.headline}</Txt>
                {!!decision.detail && <Txt kind="small" tone="primary">{decision.detail}</Txt>}
                <TextLink testID="review-cancellation-details" title={ar ? 'جدول الإلغاء كاملاً' : 'Full cancellation schedule'} onPress={() => setSheet('cancellation')}/>
              </InfoRow>
            </View>
          </Card>
        </View>

        <View style={{ gap: space.md, flex: desktop ? 1 : undefined, minWidth: 0 }}>
          <Card testID="review-price-breakdown" style={styles.card}>
            <Txt kind="label" accessibilityRole="header">{ar ? 'المبلغ' : 'Price'}</Txt>
            <Line testID="review-total" strong label={priceLabel} caption={stayScope} value={money.payNow || t('priceUnknown')}/>
            {money.atProperty.map(value => <Line key={value} label={ar ? 'يُدفع في الفندق (غير مشمول)' : 'Due at the hotel (not included)'} value={value}/>)}
            {money.atPropertyIncomplete && <Txt kind="caption" tone="warning">{ar ? 'بعض الرسوم في الفندق غير محددة المبلغ.' : 'Some hotel charges have no stated amount.'}</Txt>}
            {money.included > 0 && <Row style={{ gap: space.xs }}><Icon name="check" size={16} color={color.success}/>
              <Txt kind="small" tone="success" style={{ flex: 1 }}>{ar ? 'الضرائب المذكورة من المورّد مشمولة في السعر' : 'Taxes listed by the supplier are included'}</Txt></Row>}
            {money.notSupplied && <Txt kind="caption">{ar ? 'لم يذكر المورّد ضرائب أو رسوماً لهذا العرض.' : 'The supplier listed no taxes or fees for this rate.'}</Txt>}
            <Txt testID="review-payment-currency" kind="caption">{payIn} · <Txt kind="caption" testID="review-payment-channel">{rateLabels.payment}: {roomPaymentLabel(offer, language)}</Txt></Txt>
            {showRoomFees ? <Taxes taxes={offer.taxes} mode={expired ? 'historical' : 'current'} defaultExpanded/>
              : <TextLink testID="review-fees-details" title={ar ? 'كل الضرائب والرسوم' : 'All taxes and fees'} onPress={() => setSheet('fees')}/>}
          </Card>
          {expired && <StatePanel icon="clock" tone="warning" title={t('reviewExpiredTitle')} body={t('reviewExpiredBody')}/>}
          {status === 'error' && (membershipError ? <ApiState error={error} retry={recheckOffer}/> : <Notice tone="danger" live title={t('reviewErrorTitle')}
            body={t(error instanceof ApiError && error.status === 429 ? 'rateLimited' : 'reviewErrorBody')} action={{ label: t('retry'), onPress: recheckOffer }}/>)}
          {!NATIVE_CHECKOUT_ENABLED && <Notice tone="info" icon="shield" title={t('websiteTitle')}>
            <Txt kind="small" tone="primary">{t('websiteBody')}</Txt>
            <Txt kind="small" tone="primary">{t('reviewWebsiteReselect')}</Txt>
            {APP_ENV !== 'production' && <Txt kind="caption" tone="warning">{t('websiteEnvironment')}</Txt>}
            {handoffError && <Txt accessibilityRole="alert" kind="small" tone="danger">{t('websiteError')}</Txt>}
            <Button variant="secondary" title={checkoutLabel} disabled={!canContinue || expired || opening} onPress={openCheckout}/>
          </Notice>}
          <Row style={{ justifyContent: 'center', gap: space.lg, flexWrap: 'wrap' }}>
            {checked && !expired && <Button compact variant="quiet" icon="refresh" title={t('reviewCheckAgain')} disabled={!canRecheck || opening} onPress={recheckOffer}/>}
            {!showChanges && <Button compact variant="quiet" icon="back" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>}
          </Row>
        </View>
      </View>}
    </ScrollView>
    {draft && offer && money && <ActionBar stacked caption={priceLabel} amount={money.payNow || t('priceUnknown')} amountTestID="review-footer-total" note={atHotel}
      maxWidth={desktop ? 1040 : layout.maxReading}>{footerAction}</ActionBar>}
    {offer && <Sheet visible={sheet === 'cancellation'} testID="review-cancellation-sheet" title={ar ? 'الإلغاء' : 'Cancellation'} subtitle={roomName} onClose={() => setSheet(null)}>
      <Cancellation offer={offer} mode={expired ? 'historical' : 'current'} defaultExpanded/>
    </Sheet>}
    {offer && <Sheet visible={sheet === 'fees'} testID="review-fees-sheet" title={ar ? 'الضرائب والرسوم' : 'Taxes and fees'} subtitle={roomName} onClose={() => setSheet(null)}>
      <Taxes taxes={offer.taxes} mode={expired ? 'historical' : 'current'} defaultExpanded/>
    </Sheet>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { width: '100%', alignSelf: 'center', paddingTop: space.md, paddingBottom: space.xl, gap: space.md },
  columns: { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' },
  card: { gap: space.md, padding: space.md, borderRadius: radius.lg },
  changes: { gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.warningBorder, backgroundColor: color.warningBg },
  thumb: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden' },
});
