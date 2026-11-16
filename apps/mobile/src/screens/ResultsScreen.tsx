import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../api';
import { useAuth } from '../auth';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import HotelCard from '../components/HotelCard';
import ApiState from '../components/ApiState';
import { Button, Row, StatePanel, Txt } from '../components/Primitives';
import { hotelSearchPlan } from '../components/foundationContracts';

export default function ResultsScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { criteria, destinationName, saved, savedReady, savedError } = useAppState(); const { t, language } = useLanguage(); const router = useRouter(); const { user } = useAuth();
  const [result, setResult] = useState<{ key: string; hotels: HotelSummary[]; error: unknown }>({ key: '', hotels: [], error: null }); const [refresh, recheck] = useState(0);
  const [paging, setPaging] = useState({ key: '', limit: 20 }); const [sort, setSort] = useState<'recommended'|'lowPrice'|'highPrice'>('recommended'); const [star, setStar] = useState(0); const [sheet, showSheet] = useState(false);
  const requestSavedIds = savedOnly ? saved : null;
  const requestSavedReady = !savedOnly || savedReady;
  const requestPlan = useMemo(() => requestSavedReady ? hotelSearchPlan(criteria, language, requestSavedIds) : null, [criteria, language, requestSavedIds, requestSavedReady]);
  const requestKey = JSON.stringify([requestPlan?.key, refresh, user?.email]);
  const requestEnabled = requestPlan !== null;
  const hotels = useMemo(() => requestEnabled && result.key === requestKey ? result.hotels : [], [requestEnabled, result, requestKey]);
  const error = result.key === requestKey ? result.error : null;
  const loading = requestEnabled && result.key !== requestKey;
  const limit = paging.key === requestKey ? paging.limit : 20;
  const setLimit = (limit: number) => setPaging({ key: requestKey, limit });
  useEffect(() => { if (!requestPlan) return; const controller = new AbortController();
    api.searchHotels(requestPlan.criteria, controller.signal).then(hotels => { if (!controller.signal.aborted) setResult({ key: requestKey, hotels, error: null }); }).catch(error => { if (!controller.signal.aborted) setResult({ key: requestKey, hotels: [], error }); });
    return () => controller.abort();
  }, [requestPlan, requestKey]);
  const filtered = useMemo(() => { const values = hotels.filter(hotel => !star || hotel.stars === star); if (sort !== 'recommended') { const amount = (hotel: HotelSummary) => { const price = hotel.price; return price && price.currency === criteria?.currency && Number.isFinite(Number(price.amount)) ? Number(price.amount) : null; }; values.sort((a, b) => { const left = amount(a), right = amount(b); if (left === null) return right === null ? 0 : 1; if (right === null) return -1; return sort === 'lowPrice' ? left - right : right - left; }); } return values; }, [hotels, star, sort, criteria?.currency]);
  const edit = () => router.push('/');
  const header = <View style={{ gap: 16, paddingBottom: 18 }}><Txt kind="title" accessibilityRole="header">{t(savedOnly ? 'saved' : 'results')}</Txt>{savedOnly && <Txt kind="small">{t('savedBody')}</Txt>}{criteria && <View style={[ui.card, { padding: 16, gap: 8 }]}>{!savedOnly && <Txt kind="heading">{destinationName}</Txt>}<Txt kind="small" style={{ writingDirection: 'ltr' }}>{criteria.checkin} → {criteria.checkout}</Txt><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="small">{criteria.guests.reduce((sum, room) => sum + room.adults + room.children.length, 0)} {t('guests')} · {criteria.guests.length} {t('rooms')} · {criteria.currency}</Txt><Button compact variant="quiet" title={t('searchAgain')} onPress={edit} /></Row></View>}{savedError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('savedError')}</Txt>}{!loading && !error && hotels.length > 0 && <Row style={{ justifyContent: 'space-between' }}><Txt kind="small">{filtered.length} / {hotels.length} {t('liveResults')}</Txt><Button compact variant="secondary" title={`${t('filters')}${star ? ' · 1' : ''} / ${t('sort')}`} onPress={() => showSheet(true)} /></Row>}{star > 0 && <Button compact variant="quiet" title={`${star} ${t('stars')} ×`} onPress={() => setStar(0)} />}</View>;
  let content: React.ReactNode = null;
  if (savedOnly && !savedReady) content = <StatePanel title={t('loading')} busy />;
  else if (savedOnly && savedReady && saved.length === 0) content = <StatePanel title={t('savedEmpty')} body={t('savedBody')} />;
  else if (!criteria) content = <View style={{ gap: 14 }}><StatePanel title={t('datesRequired')} body={t('datesRequiredBody')} /><Button title={t('search')} onPress={edit} /></View>;
  else if (loading) content = <StatePanel title={t('loading')} busy />;
  else if (error) content = <ApiState error={error} retry={() => recheck(value => value + 1)} />;
  else if (filtered.length === 0) content = <View style={{ gap: 14 }}><StatePanel title={t('noResults')} body={t(savedOnly ? 'savedNoAvailability' : 'noResultsBody')} />{star > 0 && <Button title={t('clear')} variant="secondary" onPress={() => setStar(0)} />}</View>;
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader back={!savedOnly} /><EnvironmentBanner /><FlatList data={content ? [] : filtered.slice(0, limit)} keyExtractor={item => String(item.hid)} contentContainerStyle={ui.page} renderItem={({ item }) => <HotelCard hotel={item} />} ItemSeparatorComponent={() => <View style={{ height: 18 }} />} ListHeaderComponent={header} ListEmptyComponent={content || undefined} ListFooterComponent={!content && limit < filtered.length ? <View style={{ paddingTop: 18 }}><Button variant="secondary" title={`${t('loadMore')} (${Math.min(20, filtered.length - limit)})`} onPress={() => setLimit(limit + 20)} /></View> : undefined} refreshing={loading && hotels.length > 0} onRefresh={criteria ? () => recheck(value => value + 1) : undefined} />
    <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => showSheet(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#102A4380' }}><SafeAreaView edges={['bottom']} style={{ padding: 22, gap: 18, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#fff', direction: 'ltr' }} accessibilityViewIsModal><Row style={{ justifyContent: 'space-between' }}><Txt kind="heading">{t('filters')} / {t('sort')}</Txt><Button compact variant="quiet" title={t('close')} onPress={() => showSheet(false)} /></Row><Txt kind="label">{t('sort')}</Txt>{(['recommended','lowPrice','highPrice'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: sort === value }} onPress={() => { setSort(value); setLimit(20); }} style={{ padding: 14, borderRadius: 13, backgroundColor: sort === value ? colors.softBlue : colors.background }}><Txt>{`${sort === value ? '●' : '○'}  ${t(value)}`}</Txt></Pressable>)}<Txt kind="label">{t('stars')}</Txt><Row style={{ flexWrap: 'wrap' }}>{[0,1,2,3,4,5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: star === value }} onPress={() => { setStar(value); setLimit(20); }} style={{ minHeight: 48, minWidth: 48, padding: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: star === value ? colors.softBlue : colors.background }}><Txt kind="label">{value || t('allStars')}</Txt></Pressable>)}</Row><Button title={t('apply')} onPress={() => showSheet(false)} /><Button variant="quiet" title={t('clear')} onPress={() => { setStar(0); setSort('recommended'); setLimit(20); }} /></SafeAreaView></View></Modal>
  </SafeAreaView>;
}
