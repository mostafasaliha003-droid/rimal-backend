import React, { useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, APP_ENV, bookingWebsiteUrl } from '../api';
import { useLanguage } from '../i18n';
import type { RoomOffer, SearchCriteria } from '../types';
import { color, elevation, layout, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useReviewSession } from '../components/useReviewSession';
import ApiState from '../components/ApiState';
import { Badge, Button, Card, Divider, Icon, Notice, Photo, Row, StatePanel, Txt, type IconName } from '../components/Primitives';
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
import { formatDay, formatMoney, formatWeekday, nightsBetween, occupancy, roomLines, stayWords } from '../components/format';
import { useLayout } from '../components/motion';
import { localizedRoomName } from '../components/roomNameModel';

type ReviewSession = ReturnType<typeof useReviewSession>;

/** What the traveler pays now, what is due at the hotel, and which supplied taxes are already inside the price. */
function priceParts(offer: RoomOffer, display: DisplayMoney) {
  const taxes = presentTaxes(offer.taxes);
  const atProperty = taxes.excludedGroups.map(group => group.complete && group.subtotal ? formatMoney(group.subtotal) : null);
  return { payNow: formatMoney(offer.price && display(offer.price)), atProperty: atProperty.filter((value): value is string => Boolean(value)),
    atPropertyIncomplete: atProperty.some(value => !value) || taxes.unassignedExcluded.length > 0 || (taxes.hasExcluded && taxes.hasUnknown),
    included: taxes.rows.filter(row => row.inclusion === 'included').length, notSupplied: taxes.dataState === 'notSupplied' };
}

function Answer({ icon, tone, label, value, detail, testID }: { icon: IconName; tone: string; label: string; value: string; detail?: string; testID?: string }) {
  return <Row testID={testID} style={{ gap: space.md, alignItems: 'flex-start' }}>
    <View style={[styles.answerIcon, { backgroundColor: tone === color.success ? color.successBg : tone === color.danger ? color.dangerBg : color.bgSelected }]}>
      <Icon name={icon} size={18} color={tone}/></View>
    <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
      <Txt kind="caption">{label}</Txt>
      <Txt kind="bodyStrong" style={{ color: tone === color.textBrand ? color.textPrimary : tone }}>{value}</Txt>
      {!!detail && <Txt kind="small" tone="primary">{detail}</Txt>}
    </View>
  </Row>;
}

function Section({ title, icon, children, testID }: { title: string; icon: IconName; children: React.ReactNode; testID?: string }) {
  return <View testID={testID} style={{ gap: space.sm }}>
    <Row style={{ gap: space.sm }}><Icon name={icon} size={18} color={color.interactiveStrong}/><Txt kind="label" accessibilityRole="header">{title}</Txt></Row>
    <View style={{ gap: space.xs }}>{children}</View>
  </View>;
}

function Line({ label, value, strong = false, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' }}>
    <Txt kind={strong ? 'label' : 'small'} tone="primary" style={{ flexShrink: 1 }}>{label}</Txt>
    <Txt testID={testID} kind={strong ? 'priceLarge' : 'bodyStrong'} style={{ writingDirection: 'ltr' }}>{value}</Txt>
  </Row>;
}

export default function ReviewScreen() {
  const session = useReviewSession();
  return <ReviewContents key={session.draft?.id || 'missing'} session={session}/>;
}

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
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
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
  const payIn = ar ? `عملة الدفع: ${currencyName(payCode, 'ar')} (${payCode})` : `Payment currency: ${currencyName(payCode, 'en')} (${payCode})`;
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
  const stayScope = criteria && count ? [nights ? words.nights(nights) : '', words.rooms(count.rooms), words.guests(count.guests)].filter(Boolean).join(' · ') : '';
  const priceLabel = t(checked && !expired ? 'reviewCurrentPrice' : 'reviewPreviousPrice');
  const totalLine = money?.payNow ? money.payNow + (money.atProperty.length ? (ar ? ` + ${money.atProperty.join(' + ')} في الفندق` : ` + ${money.atProperty.join(' + ')} at the hotel`) : '') : t('priceUnknown');
  const cancelTone = decision?.kind === 'free' ? color.success : decision?.nonRefundable ? color.danger : color.textBrand;

  const footerAction = !draft || !offer ? null : expired ? <Button variant="secondary" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>
    : showChanges && !changesAccepted ? <Button testID="review-see-changes" icon="alert" title={t('reviewSeeChanges')} disabled={opening} onPress={reviewChanges}/>
      : canContinue ? <Button testID="review-continue" iconEnd="forward" label={NATIVE_CHECKOUT_ENABLED ? checkoutLabel : t('websiteCta')}
        title={NATIVE_CHECKOUT_ENABLED ? (ar ? 'متابعة الحجز' : 'Continue booking') : (ar ? 'المتابعة إلى الحجز' : 'Continue to booking')} busy={opening}
        onPress={() => NATIVE_CHECKOUT_ENABLED ? openCheckout() : void openWebsite()}/>
        : <Button testID="review-check-price" icon="refresh" title={t(status === 'pending' ? 'reviewChecking' : checked ? 'reviewCheckAgain' : 'reviewCheckPrice')}
          busy={status === 'pending'} disabled={!canRecheck || opening} onPress={recheckOffer}/>;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={[styles.page, { paddingHorizontal: gutter, maxWidth: desktop ? 1040 : layout.maxReading }]}>
      <View style={{ gap: space.xs }}>
        <Txt accessibilityRole="header" kind="title">{ar ? 'راجع حجزك' : 'Review your booking'}</Txt>
        <Txt kind="small">{ar ? 'المبلغ وما يشمله وشروط الإلغاء في مكان واحد قبل أن تتابع.' : 'The total, what is included and the cancellation terms, together, before you continue.'}</Txt>
      </View>
      {!draft || !offer || !criteria || !money || !decision ? <><StatePanel icon="bed" title={t('reviewMissingTitle')} body={t('reviewMissingBody')}/>
        <Button title={t('search')} onPress={() => router.replace('/')}/></> : <View style={desktop ? [styles.columns, { flexDirection: ar ? 'row-reverse' : 'row' }] : { gap: space.lg }}>
        <View style={{ gap: space.lg, flex: desktop ? 1.4 : undefined, minWidth: 0 }}>
          {showChanges && <View onLayout={event => { panelTop.current = event.nativeEvent.layout.y; }}
            style={[styles.changes, elevation.card]}>
            <View ref={changeHeading} accessible accessibilityRole="header" accessibilityLabel={t('reviewChangedTitle')}
              accessibilityLiveRegion="polite" tabIndex={-1} collapsable={false}>
              <Row style={{ gap: space.sm }}><Icon name="alert" size={20} color={color.warning}/><Txt kind="heading">{t('reviewChangedTitle')}</Txt></Row>
            </View>
            <Txt kind="small" tone="primary">{t('reviewChangedBody')}</Txt>
            <OfferChanges key={session.confirmationRevision} before={draft.offer} after={offer}/>
            {changesAccepted
              ? <Notice tone="success" live title={t('reviewChangesAccepted')}/>
              : <Button testID="review-accept-changes" title={t('reviewAcceptChanges')} disabled={opening} onPress={acceptChanges}/>}
            <Button compact variant="quiet" title={t('reviewRefreshOffers')} onPress={returnToOffers}/>
          </View>}

          <Card testID="review-answers" elevated style={styles.answers}>
            <Txt kind="subheading" accessibilityRole="header">{ar ? 'حجزك باختصار' : 'Your booking at a glance'}</Txt>
            <Answer testID="review-answer-total" icon="wallet" tone={color.textBrand} label={ar ? 'كم ستدفع بالمجموع' : 'What you will pay in total'} value={totalLine}
              detail={[stayScope, money.atPropertyIncomplete ? (ar ? 'بعض الرسوم في الفندق غير محددة المبلغ.' : 'Some hotel charges have no stated amount.') : ''].filter(Boolean).join(' · ')}/>
            <Answer testID="review-answer-included" icon="checkCircle" tone={color.textBrand} label={ar ? 'ماذا يشمل حجزك' : 'What your booking includes'}
              value={[localizedRoomName(offer.name, language), mealDescription(offer, language)].join(' · ')} detail={offer.bedding ? `${rateLabels.bedding}: ${offer.bedding}` : undefined}/>
            <Answer testID="review-answer-cancellation" icon={decision.kind === 'free' ? 'checkCircle' : decision.nonRefundable ? 'alertCircle' : 'clock'} tone={cancelTone}
              label={ar ? 'حتى متى يمكنك الإلغاء وبأي تكلفة' : 'Until when you can cancel, and the cost'} value={decision.headline} detail={decision.detail || undefined}/>
            {!checked && !expired && status !== 'pending' && <Notice tone="info" body={t('reviewBeforeRecheck')}/>}
            {status === 'pending' && <Notice tone="info" live title={t('reviewChecking')}/>}
            {checked && !expired && !showChanges && <Notice tone="success" live title={t('reviewChecked')}/>}
          </Card>

          <Card testID="review-stay-summary" style={{ gap: space.lg }}>
            <Row style={{ alignItems: 'center', gap: space.md }}>
              {(offer.images.length > 0 || draft.hotelImage) && <View style={styles.thumb}>
                <Photo uri={offer.images[0] || draft.hotelImage} alternatives={offer.images} room label={localizedRoomName(offer.name, language)} height={72} thumbnail/>
              </View>}
              <View style={{ flex: 1, gap: space.xxs, minWidth: 0 }}>
                <Txt accessibilityRole="header" kind="subheading">{draft.hotelName}</Txt>
                {draft.hotelAddress && <Txt kind="caption" numberOfLines={2}>{draft.hotelAddress}</Txt>}
              </View>
            </Row>
            <Divider/>
            <Section title={ar ? 'إقامتك' : 'Your stay'} icon="calendar">
              <View style={styles.dates}>
                <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
                {(['checkin', 'checkout'] as const).map(field => <View key={field} style={{ flex: 1, minWidth: 0 }}>
                  <Txt kind="caption">{t(field)}</Txt>
                  <Txt kind="bodyStrong">{formatDay(criteria[field], language, { year: 'always' })}</Txt>
                  <Txt kind="caption">{formatWeekday(criteria[field], language)}</Txt>
                </View>)}
                </Row>
                {nights && <Badge tone="info" icon="moon" label={words.nights(nights)}/>}
              </View>
            </Section>
            <Section testID="review-guests" title={ar ? 'الضيوف والغرف' : 'Guests and rooms'} icon="users">
              {roomLines(criteria.guests, language).map(line => <Txt key={line} kind="small" tone="primary">{line}</Txt>)}
            </Section>
            <Section title={ar ? 'ما يشمله الحجز' : 'What is included'} icon="checkCircle">
              <Txt kind="bodyStrong">{localizedRoomName(offer.name, language)}</Txt>
              <Row style={{ gap: space.xs }}><Icon name="coffee" size={16} color={color.textSecondary}/><Txt kind="small" tone="primary">{mealDescription(offer, language)}</Txt></Row>
              {(offer.bedding || draft.offer.bedding) && <Row style={{ gap: space.xs }}><Icon name="bed" size={16} color={color.textSecondary}/>
                <Txt testID="review-bedding" kind="small" tone="primary">{rateLabels.bedding}: {offer.bedding || rateLabels.unknown}</Txt></Row>}
              <Row style={{ gap: space.xs }}><Icon name="card" size={16} color={color.textSecondary}/>
                <Txt testID="review-payment-channel" kind="small" tone="primary">{rateLabels.payment}: {roomPaymentLabel(offer, language)}</Txt></Row>
            </Section>
            <Section testID="review-cancellation" title={ar ? 'الإلغاء' : 'Cancellation'} icon="clock">
              <Txt kind="label" style={{ color: cancelTone }}>{decision.headline}</Txt>
              {!!decision.detail && <Txt kind="small" tone="primary">{decision.detail}</Txt>}
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: scheduleOpen }} aria-expanded={scheduleOpen}
                onPress={() => setScheduleOpen(value => !value)} style={styles.disclosure}>
                <Row style={{ justifyContent: 'space-between' }}><Txt kind="label" tone="link" style={{ flex: 1 }}>{ar ? 'جدول الإلغاء كاملاً وتوقيت المورّد' : 'Full cancellation schedule and supplier time'}</Txt>
                  <Icon name="chevronDown" size={18} color={color.interactiveStrong}/></Row>
              </Pressable>
              {scheduleOpen && <Cancellation offer={offer} mode={expired ? 'historical' : 'current'} defaultExpanded/>}
            </Section>
          </Card>
        </View>

        <View style={{ gap: space.lg, flex: desktop ? 1 : undefined, minWidth: 0 }}>
          <Card testID="review-price-breakdown" elevated style={{ gap: space.md }}>
            <Row style={{ gap: space.sm }}><Icon name="receipt" size={18} color={color.interactiveStrong}/><Txt kind="label" accessibilityRole="header">{ar ? 'تفصيل المبلغ' : 'Price breakdown'}</Txt></Row>
            <Line label={`${ar ? 'سعر الإقامة' : 'Stay price'} · ${stayScope}`} value={money.payNow || t('priceUnknown')}/>
            {money.included > 0 && <Row style={{ gap: space.xs }}><Icon name="check" size={16} color={color.success}/>
              <Txt kind="small" tone="success">{ar ? 'الضرائب المذكورة من المورّد مشمولة في هذا السعر' : 'Taxes listed by the supplier are included in this price'}</Txt></Row>}
            {money.atProperty.map(value => <Line key={value} label={ar ? 'يُدفع في الفندق (غير مشمول)' : 'Due at the hotel (not included)'} value={value}/>)}
            {money.notSupplied && <Txt kind="caption">{ar ? 'لم يذكر المورّد ضرائب أو رسوماً لهذا العرض.' : 'The supplier listed no taxes or fees for this rate.'}</Txt>}
            <Divider/>
            <Line testID="review-total" strong label={priceLabel} value={money.payNow || t('priceUnknown')}/>
            {money.atProperty.length > 0 && <Txt kind="small" tone="primary" align="end">{ar ? `+ ${money.atProperty.join(' + ')} تُدفع في الفندق` : `+ ${money.atProperty.join(' + ')} paid at the hotel`}</Txt>}
            <Txt testID="review-payment-currency" kind="caption" align="end">{payIn}</Txt>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: feesOpen }} aria-expanded={feesOpen}
              onPress={() => setFeesOpen(value => !value)} style={styles.disclosure}>
              <Row style={{ justifyContent: 'space-between' }}><Txt kind="label" tone="link" style={{ flex: 1 }}>{ar ? 'كل الضرائب والرسوم' : 'All taxes and fees'}</Txt>
                <Icon name="chevronDown" size={18} color={color.interactiveStrong}/></Row>
            </Pressable>
            {(feesOpen || showRoomFees) && <Taxes taxes={offer.taxes} mode={expired ? 'historical' : 'current'} defaultExpanded/>}
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
          {checked && !expired && <Button compact variant="secondary" icon="refresh" title={t('reviewCheckAgain')} disabled={!canRecheck || opening} onPress={recheckOffer}/>}
          {(!checked || showChanges || expired) && <Row style={{ gap: space.xs }}><Icon name="lock" size={14} color={color.textSecondary}/><Txt kind="caption" style={{ flex: 1 }}>{t('reviewNoReservation')}</Txt></Row>}
          {!showChanges && <Button variant="quiet" icon="back" title={t('reviewRefreshOffers')} disabled={opening} onPress={returnToOffers}/>}
        </View>
      </View>}
    </ScrollView>
    {draft && offer && money && <View style={[styles.footer, elevation.raised]}>
      <Row style={[styles.footerInner, { maxWidth: desktop ? 1040 : layout.maxReading }]}>
        <View style={{ flexGrow: 1, flexBasis: 140, flexShrink: 1, gap: 0 }}>
          <Txt kind="caption">{priceLabel}</Txt>
          <Txt testID="review-footer-total" kind="subheading" style={{ writingDirection: 'ltr' }}>{money.payNow || t('priceUnknown')}</Txt>
          {money.atProperty.length > 0 && <Txt kind="caption" numberOfLines={1}>{ar ? `+ ${money.atProperty.join(' + ')} في الفندق` : `+ ${money.atProperty.join(' + ')} at the hotel`}</Txt>}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 170, flexShrink: 1 }}>{footerAction}</View>
      </Row>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { width: '100%', alignSelf: 'center', paddingTop: space.lg, paddingBottom: space.xxxl, gap: space.lg },
  columns: { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' },
  changes: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: color.warningBorder, backgroundColor: color.warningBg },
  answers: { gap: space.md, borderColor: color.infoBorder },
  answerIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden' },
  dates: { gap: space.sm, backgroundColor: color.bgMuted, borderRadius: radius.md, padding: space.md },
  disclosure: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs },
  footer: { backgroundColor: color.bgSurface, borderTopWidth: 1, borderTopColor: color.border },
  footerInner: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.md, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
});
