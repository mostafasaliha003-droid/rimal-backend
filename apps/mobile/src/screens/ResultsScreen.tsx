import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, ApiError, authSession } from '../api';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import HotelCard from '../components/HotelCard';
import ApiState from '../components/ApiState';
import { Button, Field, Row, StatePanel, Txt } from '../components/Primitives';
import { hotelSearchPlan } from '../components/foundationContracts';
import { activeResultFilters, beginResultRefresh, copyResultFilters, decideResults, emptyResultFilters,
  resultContextKey, stayNights, type ResultFilters, type ResultSnapshot, type ResultSort } from '../components/resultsDecisionModel';
import { resultsCopy } from '../components/resultsCopy';

function FilterChip({ text, label, clear }: { text: string; label: string; clear: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${text}: ${label}`} onPress={clear}
    style={{ minHeight: 48, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, backgroundColor: colors.softBlue, borderWidth: 1, borderColor: colors.border }}>
    <Txt kind="small" style={{ color: colors.blueStrong }}>{text} ×</Txt>
  </Pressable>;
}

export default function ResultsScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { criteria, destinationName, saved, savedReady, savedError, comparisonItems, clearComparison } = useAppState();
  const { t, language } = useLanguage(), L = resultsCopy(language), router = useRouter();
  const { status: authStatus, sessionRevision } = useAuth();
  const { width, fontScale } = useWindowDimensions();
  const columns = width >= 760 && fontScale <= 1.3 ? 2 : 1;
  const columnWidth = (Math.min(width, 880) - 40 - 18) / 2;
  const [snapshot, setSnapshot] = useState<ResultSnapshot>({ context: '', hotels: [], pending: false, error: null });
  const [refresh, recheck] = useState(0), [paging, setPaging] = useState({ context: '', limit: 20 });
  const [appliedState, setAppliedState] = useState<{ context: string; value: ResultFilters }>({ context: '', value: emptyResultFilters() });
  const [draft, setDraft] = useState<ResultFilters>(emptyResultFilters), [sheetContext, setSheetContext] = useState<string | null>(null);
  const generation = useRef(0), inFlight = useRef<AbortController | null>(null), currentContext = useRef('');
  const requestSavedIds = savedOnly ? saved : null, requestSavedReady = !savedOnly || savedReady;
  const plan = useMemo(() => requestSavedReady ? hotelSearchPlan(criteria, language, requestSavedIds) : null,
    [criteria, language, requestSavedIds, requestSavedReady]);
  const context = resultContextKey(plan?.key, language, authStatus, sessionRevision);
  const enabled = plan !== null && authStatus !== 'loading';
  const sameContext = enabled && snapshot.context === context;
  const hotels = useMemo(() => sameContext ? snapshot.hotels : [], [sameContext, snapshot.hotels]);
  const error = sameContext ? snapshot.error : null;
  const pending = enabled && (!sameContext || snapshot.pending);
  const refreshing = pending && hotels.length > 0;
  const defaults = useMemo(() => emptyResultFilters(), []);
  const applied = appliedState.context === context ? appliedState.value : defaults;
  const decision = useMemo(() => decideResults(hotels, applied, criteria?.currency || ''), [hotels, applied, criteria?.currency]);
  const preview = useMemo(() => decideResults(hotels, draft, criteria?.currency || ''), [hotels, draft, criteria?.currency]);
  const activeCount = activeResultFilters(applied), limit = paging.context === context ? paging.limit : 20;
  const sheet = sheetContext === context;
  const setLimit = (value: number) => setPaging({ context, limit: value });
  const apply = (value: ResultFilters) => { setAppliedState({ context, value: copyResultFilters(value) }); setLimit(20); };
  const openFilters = () => { setDraft(copyResultFilters(applied)); setSheetContext(context); };
  const refreshResults = () => { inFlight.current?.abort(); ++generation.current; setSnapshot(previous => beginResultRefresh(previous, context)); recheck(value => value + 1); };
  useEffect(() => {
    currentContext.current = context;
    if (!plan || authStatus === 'loading') return;
    const controller = new AbortController(), stamp = ++generation.current;
    inFlight.current = controller;
    const current = () => !controller.signal.aborted && stamp === generation.current && currentContext.current === context
      && authSession.getRevision() === sessionRevision && authSession.getSnapshot().status === authStatus;
    api.searchHotels(plan.criteria, controller.signal).then(hotels => {
      if (current()) setSnapshot({ context, hotels, pending: false, error: null });
    }).catch(error => {
      if (!current()) return;
      const denied = error instanceof ApiError && (error.kind === 'auth' || error.kind === 'membership');
      setSnapshot(previous => ({ context, hotels: !denied && previous.context === context ? previous.hotels : [], pending: false, error }));
    });
    return () => { controller.abort(); if (inFlight.current === controller) inFlight.current = null; };
  }, [plan, context, refresh, authStatus, sessionRevision]);
  const edit = () => router.push('/');
  const nights = stayNights(criteria), roomCount = criteria?.guests.length || 0;
  const header = <View style={{ gap: 15, paddingBottom: 18 }}>
    <Txt kind="title" accessibilityRole="header">{t(savedOnly ? 'saved' : 'results')}</Txt>
    {savedOnly && <Txt kind="small">{t('savedBody')}</Txt>}
    {criteria && <Pressable accessibilityRole="button"
      onPress={edit} style={[ui.card, { padding: 16, gap: 7, backgroundColor: colors.softBlue }]}>
      {!savedOnly && <Txt kind="heading">{destinationName}</Txt>}
      <Txt style={{ writingDirection: 'ltr' }}>{criteria.checkin} → {criteria.checkout}</Txt>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="small">{nights !== null ? `${L.stayContext(nights, roomCount)} · ` : ''}{L.guests(criteria.guests.reduce((sum, room) => sum + room.adults + room.children.length, 0))} · {criteria.currency}</Txt><Txt kind="label" style={{ color: colors.blueStrong }}>{t('searchAgain')} ↗</Txt></Row>
    </Pressable>}
    {savedError && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('savedError')}</Txt>}
    {hotels.length > 0 && <>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="label">{L.results(decision.hotels.length, hotels.length)}</Txt><Button compact variant="secondary" title={`${t('filters')}${activeCount ? ` · ${activeCount}` : ''} / ${t('sort')}`} onPress={openFilters}/></Row>
      <Txt kind="small">{t(applied.sort)}</Txt>
      {activeCount > 0 && <Row style={{ flexWrap: 'wrap' }}>
        {!!applied.name.trim() && <FilterChip text={applied.name.trim()} label={`${L.removeName}: ${applied.name}`} clear={() => apply({ ...applied, name: '' })}/>}
        {decision.budget.amount !== null && <FilterChip text={L.budgetChip(decision.budget.amount, criteria?.currency || '')} label={L.removeBudget} clear={() => apply({ ...applied, maxBudget: '' })}/>}
        {applied.stars.map(star => <FilterChip key={star} text={star ? `${star} ${t('stars')}` : L.unknownStars} label={L.removeStar(star)} clear={() => apply({ ...applied, stars: applied.stars.filter(value => value !== star) })}/>)}
        <Button compact variant="quiet" title={L.clearAll} onPress={() => apply(emptyResultFilters())}/>
      </Row>}
      {decision.unknownPriceCount > 0 && <Txt kind="small">{decision.budget.amount !== null ? L.budgetExcluded(decision.unknownPriceCount) : L.unknownPrice(decision.unknownPriceCount)}</Txt>}
      {refreshing && <View accessibilityLiveRegion="polite"><Txt kind="label">{L.refreshing}</Txt><Txt kind="small">{L.oldPrices}</Txt></View>}
      {!!error && <View style={[ui.card, { backgroundColor: colors.softGold }]}><Txt accessibilityRole="alert">{L.refreshFailed}</Txt><Button compact variant="secondary" title={L.refresh} onPress={refreshResults}/></View>}
    </>}
  </View>;
  let content: React.ReactNode = null;
  if (savedOnly && !savedReady || authStatus === 'loading') content = <StatePanel title={t('loading')} busy/>;
  else if (savedOnly && saved.length === 0) content = <StatePanel title={t('savedEmpty')} body={t('savedBody')}/>;
  else if (!criteria) content = <View style={{ gap: 14 }}><StatePanel title={t('datesRequired')} body={t('datesRequiredBody')}/><Button title={t('search')} onPress={edit}/></View>;
  else if (pending && !hotels.length) content = <StatePanel title={t('loading')} busy/>;
  else if (error && !hotels.length) content = <ApiState error={error} retry={refreshResults}/>;
  else if (!decision.hotels.length) content = <View style={{ gap: 14 }}><StatePanel title={hotels.length ? L.noMatch : t('noResults')} body={hotels.length ? L.noMatchBody : t(savedOnly ? 'savedNoAvailability' : 'noResultsBody')}/>{hotels.length > 0 && <><Button title={L.clearAll} variant="secondary" onPress={() => apply(emptyResultFilters())}/><Button title={t('filters')} variant="quiet" onPress={openFilters}/></>}<Button title={t('searchAgain')} variant="quiet" onPress={edit}/></View>;
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back={!savedOnly}/><EnvironmentBanner/>
    <FlatList key={`results-${columns}`} numColumns={columns} columnWrapperStyle={columns === 2 ? { gap: 18 } : undefined}
      data={content ? [] : decision.hotels.slice(0, limit)} keyExtractor={hotel => String(hotel.hid)} contentContainerStyle={ui.page}
      renderItem={({ item }) => <View style={{ width: columns === 2 ? columnWidth : '100%' }}><HotelCard hotel={item} comparisonDisabled={refreshing || Boolean(error)}/></View>}
      ItemSeparatorComponent={() => <View style={{ height: 18 }}/>} ListHeaderComponent={header} ListEmptyComponent={content || undefined}
      ListFooterComponent={!content && limit < decision.hotels.length ? <View style={{ paddingTop: 18 }}><Button variant="secondary" title={`${t('loadMore')} (${Math.min(20, decision.hotels.length - limit)})`} onPress={() => setLimit(limit + 20)}/></View> : undefined}
      refreshing={refreshing} onRefresh={enabled ? refreshResults : undefined}/>
    {comparisonItems.length > 0 && <View style={{ padding: 14, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <View style={{ width: '100%', maxWidth: 880, alignSelf: 'center', gap: 7 }}><Txt kind="label">{L.compareTitle(comparisonItems.length)}</Txt><Txt kind="small" numberOfLines={2}>{comparisonItems.map(item => item.name).join(' · ')}</Txt>
        <Row style={{ flexWrap: 'wrap' }}><Pressable accessibilityRole="button" accessibilityLabel={`${L.compareCta(comparisonItems.length)}: ${comparisonItems.map(item => item.name).join(', ')}`}
          accessibilityState={{ disabled: comparisonItems.length < 2 }} disabled={comparisonItems.length < 2} onPress={() => router.push('/compare')}
          style={{ minHeight: 48, padding: 13, borderRadius: 14, backgroundColor: colors.navy, opacity: comparisonItems.length < 2 ? .5 : 1 }}><Txt kind="label" style={{ color: '#fff' }}>{L.compareCta(comparisonItems.length)}</Txt></Pressable><Button compact variant="quiet" title={L.clearCompare} onPress={clearComparison}/></Row>
        {comparisonItems.length < 2 && <Txt kind="small">{L.compareNeedTwo}</Txt>}
      </View>
    </View>}
    <Modal visible={sheet} transparent animationType="slide" accessibilityLabel={L.filtersTitle} onRequestClose={() => setSheetContext(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#102A4380' }}>
        <Pressable accessible={false} onPress={() => setSheetContext(null)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}/>
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal
          style={{ maxHeight: '92%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface, direction: 'ltr' }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 18 }}>
            <Row style={{ justifyContent: 'space-between' }}><Txt kind="heading" accessibilityRole="header">{L.filtersTitle}</Txt><Button compact variant="quiet" title={L.cancel} onPress={() => setSheetContext(null)}/></Row>
            <Field label={L.name} placeholder={L.nameHint} value={draft.name} maxLength={120} autoCorrect={false} onChangeText={name => setDraft(value => ({ ...value, name }))}/>
            <Field label={`${L.budget} · ${criteria?.currency || ''}`} placeholder={L.budgetHint} value={draft.maxBudget} maxLength={30} keyboardType="decimal-pad" ltr
              error={preview.budget.valid ? undefined : L.budgetError} onChangeText={maxBudget => setDraft(value => ({ ...value, maxBudget }))}/>
            <Txt kind="small">{L.budgetHelp}</Txt>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('sort')} style={{ gap: 9 }}><Txt kind="label">{t('sort')}</Txt>
              {(['recommended', 'lowPrice', 'highPrice'] as ResultSort[]).map(sort => <Pressable key={sort} accessibilityRole="radio" accessibilityLabel={t(sort)} aria-checked={draft.sort === sort} accessibilityState={{ checked: draft.sort === sort }}
                onPress={() => setDraft(value => ({ ...value, sort }))} style={{ minHeight: 48, padding: 13, borderRadius: 13, backgroundColor: draft.sort === sort ? colors.softBlue : colors.background }}><Txt>{`${draft.sort === sort ? '●' : '○'}  ${t(sort)}`}</Txt></Pressable>)}
            </View>
            <View style={{ gap: 10 }}><Txt kind="label">{L.stars}</Txt><Button compact variant="secondary" title={L.allStars} onPress={() => setDraft(value => ({ ...value, stars: [] }))}/>
              <Row style={{ flexWrap: 'wrap' }}>{[5, 4, 3, 2, 1, 0].map(star => {
                const selected = draft.stars.includes(star), count = preview.facetCounts[star];
                return <Pressable key={star} accessibilityRole="checkbox" aria-checked={selected} accessibilityState={{ checked: selected }}
                  accessibilityLabel={star ? L.starChoice(star, count) : L.unknownChoice(count)}
                  onPress={() => setDraft(value => ({ ...value, stars: selected ? value.stars.filter(item => item !== star) : [...value.stars, star] }))}
                  style={{ minHeight: 48, padding: 13, borderWidth: 1, borderColor: selected ? colors.blueStrong : colors.border, borderRadius: 13, backgroundColor: selected ? colors.softBlue : colors.surface }}><Txt kind="label">{selected ? '✓ ' : ''}{star ? `${star} ★` : L.unknownStars} · {count}</Txt></Pressable>;
              })}</Row>
            </View>
            <Row style={{ flexWrap: 'wrap' }}><Button variant="quiet" title={L.resetDraft} onPress={() => setDraft(emptyResultFilters())}/><Button title={L.apply(preview.hotels.length)} disabled={!preview.budget.valid} onPress={() => {
              if (currentContext.current !== sheetContext || !preview.budget.valid) return;
              apply(draft); setSheetContext(null);
            }}/></Row>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}
