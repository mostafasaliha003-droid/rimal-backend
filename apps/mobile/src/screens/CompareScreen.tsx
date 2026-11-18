import React, { useEffect, useState } from 'react';
import { AppState as NativeAppState, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { api, authSession } from '../api';
import { memberRateAccessDenied } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, tokens, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import ApiState from '../components/ApiState';
import { Button, MoneyText, Photo, Row, StatePanel, Txt } from '../components/Primitives';

const copy = {
  en: { title: 'Your shortlist, side by side', intro: 'Compare the same dates, guests and currency before choosing a property.',
    scope: 'These are captured search prices, not reserved rooms. Property charges and current room terms must be checked on the hotel page.',
    price: 'From · total for this stay', classification: 'Property star rating', missingStars: 'Star rating not supplied',
    address: 'Location supplied by the property', missingAddress: 'Address not supplied', remove: 'Remove from comparison',
    empty: 'Choose at least two stays', emptyBody: 'Add up to three hotels from the same search. Your shortlist stays in memory during this session.',
    search: 'Back to stays', clear: 'Clear shortlist', expired: 'The display period for this captured price has ended. Open the hotel to load a fresh offer.',
    swipe: 'Swipe across to compare all selected hotels.', view: 'Open hotel and room options', count: 'Selected stays',
    nights: 'nights', rooms: 'rooms', guests: 'guests' },
  ar: { title: 'قارن إقاماتك جنباً إلى جنب', intro: 'قارن الفنادق لنفس التواريخ والضيوف والعملة قبل الاختيار.',
    scope: 'هذه أسعار محفوظة من نتيجة البحث، وليست غرفاً محجوزة. راجع رسوم الفندق وشروط الغرفة الحالية في صفحة الفندق.',
    price: 'ابتداءً من · إجمالي هذه الإقامة', classification: 'تصنيف نجوم المنشأة', missingStars: 'لم يُقدّم تصنيف النجوم',
    address: 'الموقع كما ورد من المنشأة', missingAddress: 'لم يُقدّم عنوان', remove: 'إزالة من المقارنة',
    empty: 'اختر إقامتين على الأقل', emptyBody: 'أضف حتى ثلاثة فنادق من نفس البحث. تبقى قائمة المقارنة في ذاكرة التطبيق خلال هذه الجلسة.',
    search: 'العودة إلى الإقامات', clear: 'مسح قائمة المقارنة', expired: 'انتهت مهلة عرض هذا السعر المحفوظ في المقارنة. افتح الفندق لتحميل عرض جديد.',
    swipe: 'مرّر أفقياً لمقارنة كل الفنادق المختارة.', view: 'عرض الفندق وخيارات الغرف', count: 'الإقامات المختارة',
    nights: 'ليالٍ', rooms: 'غرف', guests: 'ضيوف' },
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
  const state = useAppState(), { language, rtl } = useLanguage(), router = useRouter();
  const L = copy[language], { width } = useWindowDimensions();
  const contextKey = state.comparisonContextKey;
  // Read the live context rather than a retained screen's selection snapshot.
  const items = state.getComparisonItems(contextKey), criteria = state.criteria;
  const columnWidth = Math.max(236, Math.min(280, (Math.min(width, tokens.layout.maxWidth) - 64) / Math.max(2, items.length)));
  const nights = criteria ? Math.round((Date.parse(`${criteria.checkout}T00:00:00Z`) - Date.parse(`${criteria.checkin}T00:00:00Z`)) / 86400000) : 0;
  const rooms = criteria?.guests.length || 0;
  const guests = criteria?.guests.reduce((n, room) => n + room.adults + room.children.length, 0) || 0;
  const staySummary = language === 'ar' ? `الليالي: ${nights} · الغرف: ${rooms} · الضيوف: ${guests}`
    : `${nights} ${nights === 1 ? 'night' : 'nights'} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`;
  const back = () => router.replace('/results');
  const open = (hid: number) => {
    if (!state.getComparisonItems(contextKey).some(item => item.hid === hid)) return;
    router.push({ pathname: '/hotel/[hid]', params: { hid: String(hid) } });
  };
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
      <View style={ui.page}>
        <View style={{ gap: 8 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{L.count} · {items.length}/3</Txt>
          <Txt kind="title" accessibilityRole="header">{L.title}</Txt><Txt style={{ color: colors.muted }}>{L.intro}</Txt></View>
        {items.length > 0 && criteria && <View style={[ui.card, { padding: 16, gap: 8 }]}>
          <Txt kind="heading">{state.destinationName}</Txt>
          <Txt kind="small" style={{ writingDirection: 'ltr' }}>{criteria.checkin} → {criteria.checkout}</Txt>
          <Txt kind="small">{staySummary} · {criteria.currency}</Txt>
        </View>}
        {items.length < 2 ? <><StatePanel title={L.empty} body={L.emptyBody}/><Button title={L.search} onPress={back}/></>
          : <><Txt kind="small">{L.scope}</Txt>{width < 840 && <Txt kind="label" style={{ color: colors.blueStrong }}>{L.swipe}</Txt>}</>}
      </View>
      {items.length >= 2 && <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 16, flexGrow: 1, justifyContent: 'center', flexDirection: rtl ? 'row-reverse' : 'row' }}>
        {items.map(item => <View key={item.hid} style={[ui.card, { width: columnWidth, padding: 0, overflow: 'hidden', gap: 0 }]}>
          <Photo uri={item.imageUrl} alternatives={item.images} label={item.name} height={150}/>
          <View style={{ padding: 18, gap: 16, flex: 1 }}>
            <Txt kind="heading" accessibilityRole="header">{item.name}</Txt>
            <View style={{ gap: 6 }}><Txt kind="small">{L.price}</Txt><MoneyText money={item.price}/>
              {item.priceExpired && <Txt kind="small" style={{ color: colors.goldInk }}>{L.expired}</Txt>}</View>
            <View style={ui.rule}/><View style={{ gap: 6 }}><Txt kind="label">{L.classification}</Txt><Txt>{item.stars ? `${'★'.repeat(item.stars)} · ${item.stars}` : L.missingStars}</Txt></View>
            <View style={ui.rule}/><View style={{ gap: 6 }}><Txt kind="label">{L.address}</Txt><Txt kind="small">{item.address || L.missingAddress}</Txt></View>
            <View style={{ flex: 1 }}/><Button title={L.view} onPress={() => open(item.hid)}/>
            <Button variant="quiet" title={`${L.remove}: ${item.name}`} onPress={() => state.removeComparison(item.hid, contextKey)}/>
          </View>
        </View>)}
      </ScrollView>}
      {items.length > 0 && <View style={ui.page}><Row style={{ flexWrap: 'wrap' }}><Button variant="secondary" title={L.search} onPress={back}/><Button variant="quiet" title={L.clear} onPress={state.clearComparison}/></Row></View>}
    </ScrollView>
  </SafeAreaView>;
}
