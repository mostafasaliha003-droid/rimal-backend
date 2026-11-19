import React, { useEffect, useState } from 'react';
import { AppState as NativeAppState, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { api, authSession } from '../api';
import { memberRateAccessDenied } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import ApiState from '../components/ApiState';
import { Button, MoneyText, Photo, Row, StatePanel, Txt } from '../components/Primitives';

import { COMPARISON_PRICE_LIFETIME_MS, type ComparisonHotel } from '../components/discoverySessionModel';
import { compareStayPrices } from '../components/offerChangeSummary';
import { padStayPriceDifference } from '../components/offerChangesCopy';
import StayEstimate from '../components/StayEstimate';
import { displayTravelDate } from '../components/searchJourneyModel';

const copy = {
  en: { title: 'Compare hotels', price: 'Stay total from', classification: 'Hotel stars', missing: 'Not provided',
    address: 'Location', remove: 'Remove', search: 'Back to results', clear: 'Clear shortlist',
    empty: 'Choose two hotels to compare', emptyBody: 'Select Compare on the hotels you like in search results.',
    view: 'View rooms', switch: 'Switch hotel', equal: 'Same starting price for this stay',
    expired: 'Price expired. Open rooms for a fresh price.', scope: 'Starting prices from your search. Check room terms and charges payable at the property before booking.' },
  ar: { title: 'مقارنة الفنادق', price: 'سعر الإقامة يبدأ من', classification: 'تصنيف الفندق', missing: 'غير مذكور',
    address: 'الموقع', remove: 'إزالة', search: 'العودة إلى النتائج', clear: 'مسح المقارنة',
    empty: 'اختر فندقين للمقارنة', emptyBody: 'اضغط «قارن» على الفنادق التي أعجبتك في نتائج البحث.',
    view: 'عرض الغرف', switch: 'تبديل الفندق', equal: 'سعر البداية متساوٍ لهذه الإقامة',
    expired: 'انتهت صلاحية السعر. افتح الغرف لمعرفة السعر الحالي.', scope: 'هذه أسعار البداية وقت البحث. راجع شروط الغرفة وأي رسوم تُدفع في الفندق قبل الحجز.' },
};

export default function CompareScreen() {
  const { status, sessionRevision } = useAuth();
  const { comparisonContextKey } = useAppState();
  const focused = useIsFocused();
  const [active, setActive] = useState(NativeAppState.currentState !== 'background' && NativeAppState.currentState !== 'inactive');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', value => setActive(value === 'active'));
    return () => subscription.remove();
  }, []);
  if (!focused || !active) return null;
  return <VerifiedComparison key={`${status}:${sessionRevision}:${comparisonContextKey}:${attempt}`}
    contextKey={comparisonContextKey} sessionRevision={sessionRevision} retry={() => setAttempt(value => value + 1)}/>;
}

function VerifiedComparison({ contextKey, sessionRevision, retry }: { contextKey: string; sessionRevision: number; retry: () => void }) {
  const { t } = useLanguage();
  const { status } = useAuth();
  const { clearComparison, getComparisonItems } = useAppState();
  const [access, setAccess] = useState<{ approved: boolean; error?: unknown }>({ approved: false });
  useEffect(() => {
    if (status === 'loading') return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && authSession.getRevision() === sessionRevision && authSession.getSnapshot().status === status;
    api.verifyPrivateRateAccess(controller.signal).then(() => {
      if (current()) setAccess({ approved: true });
    }).catch(error => {
      if (!current()) return;
      if (memberRateAccessDenied(error) && getComparisonItems(contextKey).length) clearComparison();
      setAccess({ approved: false, error });
    });
    return () => controller.abort();
  }, [contextKey, sessionRevision, status, clearComparison, getComparisonItems]);
  if (access.approved) return <CompareContents/>;
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    <ScrollView contentContainerStyle={ui.page}>
      {access.error ? <ApiState error={access.error} retry={retry}/> : <StatePanel title={t('loading')} busy/>}
    </ScrollView>
  </SafeAreaView>;
}
function CompareContents() {
  const state = useAppState(), { language } = useLanguage(), router = useRouter();
  const L = copy[language], { width, fontScale } = useWindowDimensions();
  const contextKey = state.comparisonContextKey;
  const items = state.getComparisonItems(contextKey), criteria = state.criteria;
  const [slots, setSlots] = useState<number[]>([]);
  const [, updatePrices] = useState(0);
  const nextExpiry = Math.min(...items.filter(item => item.price).map(item => item.capturedAt + COMPARISON_PRICE_LIFETIME_MS));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => updatePrices(value => value + 1), Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  const selected = slots.flatMap(id => items.filter(item => item.hid === id));
  const ordered = [...selected, ...items.filter(item => !slots.includes(item.hid))];
  const columns = width / Math.max(fontScale, 1) >= 680 ? items : ordered.slice(0, 2);
  const alternate = items.find(item => !columns.some(column => column.hid === item.hid));
  const pair = columns.length === 2 ? compareStayPrices(columns[0].price, columns[1].price) : null;
  let difference = '';
  if (pair?.difference && (pair.status === 'increase' || pair.status === 'decrease')) {
    const lower = columns[pair.status === 'increase' ? 0 : 1].name;
    const money = padStayPriceDifference(pair.difference, language);
    const amount = `\u2066${money.currency} ${money.amount}\u2069`;
    difference = language === 'ar' ? `سعر البداية في ${lower} أقلّ بمقدار ${amount} لهذه الإقامة.`
      : `${lower} starts ${amount} lower for this stay.`;
  }
  const rooms = criteria?.guests.length || 0;
  const guests = criteria?.guests.reduce((count, room) => count + room.adults + room.children.length, 0) || 0;
  const occupancy = language === 'ar' ? `الغرف ${rooms} · الضيوف ${guests}`
    : `${rooms} ${rooms === 1 ? 'room' : 'rooms'} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`;
  const back = () => router.replace('/results');
  const open = (hid: number) => {
    if (state.getComparisonItems(contextKey).some(item => item.hid === hid)) {
      router.push({ pathname: '/hotel/[hid]', params: { hid: String(hid) } });
    }
  };
  function row(render: (item: ComparisonHotel) => React.ReactNode) {
    return <Row style={styles.row}>{columns.map(item =>
      <View key={item.hid} style={styles.cell}>{render(item)}</View>)}</Row>;
  }
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView contentContainerStyle={ui.page}>
      <View style={styles.heading}>
        <Txt kind="title" accessibilityRole="header">{L.title}</Txt>
        {criteria && <Txt kind="small">{state.destinationName} · {displayTravelDate(criteria.checkin, language)} – {displayTravelDate(criteria.checkout, language)}</Txt>}
        {criteria && <Txt kind="small">{occupancy} · {criteria.currency}</Txt>}
      </View>
      {items.length < 2
        ? <><StatePanel title={L.empty} body={L.emptyBody}/><Button title={L.search} onPress={back}/></>
        : <View testID="hotel-comparison-grid" style={styles.table}>
          {row(item => <View style={styles.property}>
            <Photo uri={item.imageUrl} alternatives={item.images} label={item.name} height={105} thumbnail/>
            <Txt kind="label" accessibilityRole="header" style={styles.name}>{item.name}</Txt>
            {alternate && <Button compact variant="quiet" title={L.switch} label={`${L.switch} · ${item.name} → ${alternate.name}`}
              onPress={() => setSlots(columns.map(column => column.hid === item.hid ? alternate.hid : column.hid))}/>}
          </View>)}
          <View style={styles.band}><Txt kind="label">{L.price}</Txt>
            {row(item => item.priceExpired ? <Txt kind="small" style={{color: colors.goldInk}}>{L.expired}</Txt> : <><MoneyText money={item.price}/><StayEstimate money={item.price}/></>)}
          </View>
          {pair?.status === 'unchanged' && <Txt kind="label" style={styles.fact}>{L.equal}</Txt>}
          {!!difference && <Txt kind="small" style={styles.delta}>{difference}</Txt>}
          <View style={styles.fact}><Txt kind="label">{L.classification}</Txt>
            {row(item => <Txt kind="small" accessibilityLabel={item.stars ? `${item.stars} / 5` : L.missing}
              style={item.stars ? styles.stars : undefined}>{item.stars ? '★'.repeat(item.stars) : L.missing}</Txt>)}</View>
          <View style={styles.fact}><Txt kind="label">{L.address}</Txt>
            {row(item => <Txt kind="small">{item.address || L.missing}</Txt>)}</View>
          <View style={styles.fact}>{row(item => <View style={styles.actions}>
            <Button compact title={L.view} label={`${L.view} · ${item.name}`} onPress={() => open(item.hid)}/>
            <Button compact variant="quiet" title={L.remove} label={`${L.remove} · ${item.name}`} onPress={() => state.removeComparison(item.hid, contextKey)}/>
          </View>)}</View>
        </View>}
      {items.length >= 2 && <Txt kind="small">{L.scope}</Txt>}
      {items.length > 0 && <Row style={{ flexWrap: 'wrap' }}>
        {items.length >= 2 && <Button variant="secondary" title={L.search} onPress={back}/>}
        <Button variant="quiet" title={L.clear} onPress={state.clearComparison}/></Row>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  heading: { gap: 3 },
  table: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, overflow: 'hidden' },
  row: { gap: 10, alignItems: 'stretch' },
  cell: { flex: 1, minWidth: 0 },
  property: { gap: 6, flex: 1 },
  name: { fontSize: 16, lineHeight: 23, paddingHorizontal: 9, paddingBottom: 8 },
  band: { padding: 12, gap: 6, backgroundColor: colors.pistachioMist },
  fact: { padding: 12, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  stars: { color: colors.goldInk, letterSpacing: 1 },
  delta: { paddingHorizontal: 12, paddingBottom: 10, color: colors.leafInk, backgroundColor: colors.pistachioMist },
  actions: { gap: 3 },
});
